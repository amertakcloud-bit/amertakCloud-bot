import { createHash, randomUUID } from "node:crypto";

// Microsoft Edge "read aloud" neural voices over WebSocket (in memory — nothing touches the disk).
// Includes the Sec-MS-GEC token Microsoft requires (clients without it get HTTP 403).
export const VOICES = {
  piseth: { id: "km-KH-PisethNeural", label: "Piseth", gender: "male" },
  sreymom: { id: "km-KH-SreymomNeural", label: "Sreymom", gender: "female" },
};
const TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const CHROME = ["143.0.3650.75", "130.0.2849.68"];
const WS_URL = "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1";
const FORMAT = "audio-24khz-48kbitrate-mono-mp3";

export function secMsGec(now = Date.now(), skewMs = 0) {
  let ticks = Math.floor((now + skewMs) / 1000) + 11644473600;
  ticks -= ticks % 300;
  return createHash("sha256").update(`${ticks * 1e7}${TOKEN}`).digest("hex").toUpperCase();
}
const esc = (t) => t.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]);
const stamp = () => new Date().toUTCString().replace(/^(\w+), (\d+) (\w+) (\d+)/, "$1 $3 $2 $4").replace("GMT", "GMT+0000 (Coordinated Universal Time)");

// Splits long text at sentence ends (។ ៕ . ! ? newline) into pieces of at most `max` characters.
export function splitText(text, max = 700) {
  const clean = String(text || "").replace(/\r/g, "").replace(/[ \t]+/g, " ").trim();
  if (!clean) return [];
  const sentences = clean.split(/(?<=[។៕?!.\n])\s*/u).filter((s) => s.trim());
  const out = [];
  let cur = "";
  const push = () => { if (cur.trim()) out.push(cur.trim()); cur = ""; };
  for (const s of sentences) {
    if (s.length > max) { // a very long sentence: cut at spaces, or hard-cut (Khmer has no spaces between words)
      push();
      for (let i = 0; i < s.length; i += max) out.push(s.slice(i, i + max).trim());
      continue;
    }
    if ((cur + " " + s).length > max) push();
    cur += (cur ? " " : "") + s;
  }
  push();
  return out.filter(Boolean);
}

export const deps = {
  WebSocketImpl: null, // injected in tests
  async connect() {
    if (deps.WebSocketImpl) return deps.WebSocketImpl;
    return (await import("ws")).default;
  },
};

// One request → MP3 Buffer. Retries once with Microsoft's clock when it answers 403 (our clock may be off).
export async function synthesizeEdge({ text, voice = VOICES.piseth.id, rate = 0, pitch = 0, volume = 0, timeout = 25000, chrome = CHROME[0] }) {
  const WebSocket = await deps.connect();
  const sign = (n) => `${n >= 0 ? "+" : ""}${Math.round(n)}`;
  const id = randomUUID().replace(/-/g, "");
  const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='km-KH'><voice name='${voice}'><prosody pitch='${sign(pitch)}Hz' rate='${sign(rate)}%' volume='${sign(volume)}%'>${esc(text)}</prosody></voice></speak>`;
  let skew = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await new Promise((resolve, reject) => {
        const major = chrome.split(".")[0];
        const ws = new WebSocket(`${WS_URL}?TrustedClientToken=${TOKEN}&Sec-MS-GEC=${secMsGec(Date.now(), skew)}&Sec-MS-GEC-Version=1-${chrome}&ConnectionId=${id}`, {
          headers: {
            Pragma: "no-cache", "Cache-Control": "no-cache",
            Origin: "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold",
            "User-Agent": `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36 Edg/${major}.0.0.0`,
            "Accept-Language": "en-US,en;q=0.9",
            Cookie: `muid=${randomUUID().replace(/-/g, "").toUpperCase()};`,
          },
        });
        const chunks = [];
        let settled = false;
        const done = (fn, v) => { if (settled) return; settled = true; clearTimeout(timer); try { ws.terminate?.(); } catch { /* closed */ } fn(v); };
        const timer = setTimeout(() => done(reject, new Error("timeout")), timeout);
        ws.on("unexpected-response", (_req, res) => { const e = new Error(`HTTP ${res.statusCode}`); e.status = res.statusCode; e.date = res.headers?.date; done(reject, e); });
        ws.on("error", (e) => done(reject, e));
        ws.on("open", () => {
          ws.send(`X-Timestamp:${stamp()}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n` +
            JSON.stringify({ context: { synthesis: { audio: { metadataoptions: { sentenceBoundaryEnabled: "false", wordBoundaryEnabled: "false" }, outputFormat: FORMAT } } } }));
          ws.send(`X-RequestId:${id}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${stamp()}Z\r\nPath:ssml\r\n\r\n${ssml}`);
        });
        ws.on("message", (data, isBinary) => {
          if (!isBinary) { if (String(data).includes("Path:turn.end")) done(resolve, Buffer.concat(chunks)); return; }
          const buf = Buffer.from(data);
          const headLen = buf.readUInt16BE(0);
          if (buf.subarray(2, 2 + headLen).toString().includes("Path:audio")) chunks.push(buf.subarray(2 + headLen));
        });
        ws.on("close", () => { if (chunks.length) done(resolve, Buffer.concat(chunks)); else done(reject, new Error("closed without audio")); });
      });
    } catch (e) {
      if (attempt === 0 && e.status === 403 && e.date) { skew = Date.parse(e.date) - Date.now(); continue; }
      throw e;
    }
  }
}

// Text of any length → one MP3 (pieces are synthesised in order and joined — MP3 frames concatenate cleanly).
// Tries each Chrome version, then the website's /api/tts (same Edge voices) as a fallback.
export async function speak(text, { voice = "piseth", site, fetchImpl = fetch, rate = 0 } = {}) {
  const v = VOICES[voice] || VOICES.piseth;
  const pieces = splitText(text);
  if (!pieces.length) throw new Error("EMPTY_TEXT");
  const parts = [];
  for (const piece of pieces) {
    const errors = [];
    let audio = null;
    for (const chrome of CHROME) {
      try { audio = await synthesizeEdge({ text: piece, voice: v.id, rate, chrome }); if (audio?.length) break; } catch (e) { errors.push(e.message); }
    }
    if (!audio?.length && site) {
      try {
        const res = await fetchImpl(`${site}/api/tts`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: piece, voice: v.label, provider: "edge", rate }), signal: AbortSignal.timeout(30000) });
        if (res.ok) audio = Buffer.from(await res.arrayBuffer()); else errors.push(`site ${res.status}`);
      } catch (e) { errors.push(`site ${e.message}`); }
    }
    if (!audio?.length) { const err = new Error("TTS_UNAVAILABLE"); err.detail = errors.join(" | "); throw err; }
    parts.push(audio);
  }
  return Buffer.concat(parts);
}
