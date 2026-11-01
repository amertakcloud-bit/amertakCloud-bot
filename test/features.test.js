import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { EventEmitter } from "node:events";
import * as edge from "../src/features/edgeTts.js";
import { buildSrt, createSrtService, normalizeCues, srtTime } from "../src/features/srt.js";
import { createSite } from "../src/features/site.js";
import { createTelegram, TelegramError } from "../src/telegram.js";
import { loadConfig } from "../src/config.js";

// ───────── Edge TTS ─────────
class FakeWs extends EventEmitter {
  static log = [];
  static script = (ws) => { // default: answer with two audio frames and turn.end
    const frame = (s) => { const head = Buffer.from("X-RequestId:1\r\nPath:audio\r\n"); const h = Buffer.alloc(2); h.writeUInt16BE(head.length); return Buffer.concat([h, head, Buffer.from(s)]); };
    ws.emit("message", frame("AA"), true); ws.emit("message", frame("BB"), true); ws.emit("message", Buffer.from("Path:turn.end\r\n"), false);
  };
  constructor(url, opts) { super(); this.url = url; this.opts = opts; this.sent = []; FakeWs.log.push(this); setImmediate(() => { this.emit("open"); FakeWs.script(this); }); }
  send(d) { this.sent.push(String(d)); }
  terminate() {}
}

test("Sec-MS-GEC is a stable 64-char upper-case SHA-256 within a 5-minute window and sent with the right headers", async () => {
  const t = Date.UTC(2026, 10, 1, 8, 0, 10);
  assert.match(edge.secMsGec(t), /^[0-9A-F]{64}$/);
  assert.equal(edge.secMsGec(t), edge.secMsGec(t + 200000));
  assert.notEqual(edge.secMsGec(t), edge.secMsGec(t + 400000));
  edge.deps.WebSocketImpl = FakeWs; FakeWs.log.length = 0;
  const audio = await edge.synthesizeEdge({ text: "សួស្តី & <hi>", voice: "km-KH-SreymomNeural" });
  assert.equal(audio.toString(), "AABB");
  const ws = FakeWs.log[0];
  assert.match(ws.url, /Sec-MS-GEC=[0-9A-F]{64}&Sec-MS-GEC-Version=1-143\./);
  assert.match(ws.opts.headers.Origin, /^chrome-extension:/);
  const ssml = ws.sent.find((s) => s.includes("Path:ssml"));
  assert.match(ssml, /voice name='km-KH-SreymomNeural'/);
  assert.match(ssml, /សួស្តី &amp; &lt;hi&gt;/); // XML-escaped
  assert.match(ws.sent[0], /audio-24khz-48kbitrate-mono-mp3/);
});

test("Edge TTS: HTTP 403 → retried once with Microsoft's clock; other errors surface", async () => {
  edge.deps.WebSocketImpl = FakeWs; FakeWs.log.length = 0;
  let n = 0;
  const orig = FakeWs.script;
  FakeWs.script = (ws) => { if (n++ === 0) ws.emit("unexpected-response", {}, { statusCode: 403, headers: { date: new Date(Date.now() + 3600e3).toUTCString() } }); else orig(ws); };
  assert.equal((await edge.synthesizeEdge({ text: "a" })).toString(), "AABB");
  assert.equal(FakeWs.log.length, 2);
  assert.notEqual(FakeWs.log[0].url.match(/Sec-MS-GEC=(\w+)/)[1], FakeWs.log[1].url.match(/Sec-MS-GEC=(\w+)/)[1]); // new token from the corrected clock
  FakeWs.script = (ws) => ws.emit("error", new Error("ECONNRESET"));
  await assert.rejects(edge.synthesizeEdge({ text: "a" }), /ECONNRESET/);
  FakeWs.script = (ws) => { /* never answers */ };
  await assert.rejects(edge.synthesizeEdge({ text: "a", timeout: 40 }), /timeout/);
  FakeWs.script = orig;
});

test("Edge TTS: long text is split at sentence ends, joined in order, and falls back to the website", async () => {
  const parts = edge.splitText("សួស្តី។ ខ្ញុំឈ្មោះដារា។ Hello world. " + "x".repeat(50), 30);
  assert.ok(parts.length >= 3 && parts.every((p) => p.length <= 30));
  assert.deepEqual(edge.splitText("   "), []);
  edge.deps.WebSocketImpl = FakeWs;
  FakeWs.log.length = 0;
  const mp3 = await edge.speak("សួស្តី។ លាហើយ។", { voice: "sreymom" });
  assert.equal(mp3.toString(), "AABB"); // short text = one request
  const long = await edge.speak("ក".repeat(1500), { voice: "piseth" });
  assert.equal(long.toString(), "AABB".repeat(3)); // 1500 chars → 3 pieces, joined in order
  // Microsoft refuses everywhere → the website's /api/tts is used
  FakeWs.script = (ws) => ws.emit("unexpected-response", {}, { statusCode: 403, headers: {} });
  let body;
  const fetchImpl = async (url, o) => { body = JSON.parse(o.body); return new Response(Buffer.from("SITE-MP3"), { status: 200 }); };
  assert.equal((await edge.speak("hi", { voice: "sreymom", site: "https://s.test", fetchImpl })).toString(), "SITE-MP3");
  assert.deepEqual([body.provider, body.voice], ["edge", "Sreymom"]);
  await assert.rejects(edge.speak("hi", { site: "https://s.test", fetchImpl: async () => new Response("no", { status: 502 }) }), /TTS_UNAVAILABLE/);
  await assert.rejects(edge.speak("   "), /EMPTY_TEXT/);
});

// ───────── SRT ─────────
test("SRT: timestamps, cue clean-up and the Gemini request/response", async () => {
  assert.equal(srtTime(3661.5), "01:01:01,500");
  const cues = normalizeCues([{ start: 5, end: 3, text: " late " }, { start: 0, end: 4, text: "a  b" }, { start: "x", text: "bad" }, { start: 2, end: 2.5, text: "" }]);
  assert.deepEqual(cues.map((c) => c.text), ["a b", "late"]);
  assert.ok(cues[0].end <= cues[1].start); // overlap trimmed
  assert.ok(cues[1].end > cues[1].start); // invalid end repaired
  assert.equal(buildSrt(cues).split("\n")[0], "1");
  let req;
  const fetchImpl = async (url, o) => { req = { url, body: JSON.parse(o.body), headers: o.headers }; return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '```json\n[{"start":0,"end":2,"text":"សួស្តី"}]\n```' }] } }] }), { status: 200 }); };
  const svc = createSrtService({ key: "KEY", model: "gem-model", base: "http://g.test", fetchImpl });
  const out = await svc.transcribe(Buffer.from("AUDIO"), "audio/ogg");
  assert.match(out.srt, /00:00:00,000 --> 00:00:02,000\nសួស្តី/);
  assert.equal(req.url, "http://g.test/v1beta/models/gem-model:generateContent");
  assert.equal(req.headers["x-goog-api-key"], "KEY"); // key in a header, never in the URL
  assert.equal(req.body.contents[0].parts[0].inline_data.data, Buffer.from("AUDIO").toString("base64"));
  assert.equal(req.body.generationConfig.responseMimeType, "application/json");
  const fail = (status, body) => createSrtService({ key: "k", model: "m", fetchImpl: async () => new Response(JSON.stringify(body), { status }) });
  await assert.rejects(fail(429, {}).transcribe(Buffer.from("x")), (e) => e.code === "RATE_LIMIT");
  await assert.rejects(fail(500, { error: { message: "boom" } }).transcribe(Buffer.from("x")), /boom/);
  await assert.rejects(fail(200, { candidates: [{ content: { parts: [{ text: "not json" }] } }] }).transcribe(Buffer.from("x")), (e) => e.code === "BAD_AI_JSON");
  await assert.rejects(fail(200, { candidates: [{ content: { parts: [{ text: "[]" }] } }] }).transcribe(Buffer.from("x")), (e) => e.code === "NO_SPEECH");
  await assert.rejects(createSrtService({ key: "", model: "m" }).transcribe(Buffer.from("x")), (e) => e.code === "NO_KEY");
});

// ───────── website client + Telegram client against real local HTTP servers ─────────
const serve = (handler) => new Promise((resolve) => { const s = http.createServer(handler); s.listen(0, "127.0.0.1", () => resolve({ s, url: `http://127.0.0.1:${s.address().port}` })); });
const readBody = (req) => new Promise((r) => { const c = []; req.on("data", (d) => c.push(d)); req.on("end", () => r(Buffer.concat(c))); });

test("website client: QR png, video resolve, size-limited download", async () => {
  const seen = [];
  const { s, url } = await serve(async (req, res) => {
    const body = await readBody(req);
    seen.push([req.method, req.url, body.toString()]);
    if (req.url === "/api/qr") { res.writeHead(200, { "content-type": "image/png" }); return res.end(Buffer.from("PNGDATA")); }
    if (req.url === "/api/video/resolve") { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify({ success: true, data: { title: "T", formats: [{ id: "v", token: "TOK" }] } })); }
    if (req.url.startsWith("/api/video/download?token=small")) { res.writeHead(200, { "content-length": "4" }); return res.end("data"); }
    if (req.url.startsWith("/api/video/download?token=big")) { res.writeHead(200, { "content-length": "999999" }); return res.end("x"); }
    res.writeHead(422, { "content-type": "application/json" }); res.end(JSON.stringify({ success: false, message: "nope", code: "UNSUPPORTED_SITE" }));
  });
  const site = createSite({ site: url });
  assert.equal((await site.qr("https://a.b/c")).buffer.toString(), "PNGDATA");
  assert.equal(JSON.parse(seen[0][2]).type, "url");
  await site.qr("plain text");
  assert.equal(JSON.parse(seen[1][2]).type, "text");
  assert.equal((await site.resolve("https://t.co/x")).formats[0].token, "TOK");
  assert.equal((await site.fetchFile("small", 100)).buffer.toString(), "data");
  await assert.rejects(site.fetchFile("big", 100), (e) => e.code === "TOO_LARGE");
  seen.length = 0;
  const bad = createSite({ site: url, fetchImpl: (u, o) => fetch(u.replace("/resolve", "/other"), o) });
  await assert.rejects(bad.resolve("https://youtube.com/x"), (e) => e.code === "UNSUPPORTED_SITE" && /nope/.test(e.message));
  s.close();
});

test("Telegram client: JSON calls, multipart uploads, file download, API errors", async () => {
  const got = [];
  const { s, url } = await serve(async (req, res) => {
    const body = await readBody(req);
    got.push({ url: req.url, type: req.headers["content-type"], body });
    if (req.url.includes("/file/")) { res.writeHead(200); return res.end("FILEBYTES"); }
    res.writeHead(200, { "content-type": "application/json" });
    if (req.url.endsWith("/getFile")) return res.end(JSON.stringify({ ok: true, result: { file_path: "voice/a.oga", file_size: 9 } }));
    if (req.url.endsWith("/boom")) return res.end(JSON.stringify({ ok: false, error_code: 400, description: "Bad Request: nope" }));
    res.end(JSON.stringify({ ok: true, result: { message_id: 1 } }));
  });
  const tg = createTelegram({ token: "123:ABC", apiBase: url });
  assert.deepEqual(await tg.call("sendMessage", { chat_id: 1, text: "hi" }), { message_id: 1 });
  assert.equal(got[0].url, "/bot123:ABC/sendMessage");
  assert.deepEqual(JSON.parse(got[0].body), { chat_id: 1, text: "hi" });
  await tg.upload("sendDocument", { chat_id: 1, reply_markup: { inline_keyboard: [[{ text: "a", callback_data: "b" }]] } }, { document: { data: Buffer.from("hello"), name: "x.srt", type: "text/plain" } });
  assert.match(got[1].type, /^multipart\/form-data; boundary=/);
  const raw = got[1].body.toString();
  assert.match(raw, /name="chat_id"\r\n\r\n1/);
  assert.match(raw, /name="reply_markup"\r\n\r\n\{"inline_keyboard"/); // objects are JSON-encoded
  assert.match(raw, /name="document"; filename="x.srt"/);
  assert.equal((await tg.download("fid")).buffer.toString(), "FILEBYTES");
  await assert.rejects(tg.call("boom"), (e) => e instanceof TelegramError && e.code === 400 && /nope/.test(e.message));
  await assert.rejects(tg.download("fid", { maxBytes: 3 }), /FILE_TOO_BIG/);
  s.close();
});

test("config: Render settings → webhook mode; local → polling; secrets are sanitised", () => {
  const c = loadConfig({ BOT_TOKEN: " 1:A ", RENDER_EXTERNAL_URL: "https://bot.onrender.com/", PORT: "10000", WEBHOOK_SECRET: "ab+/c$d" });
  assert.deepEqual([c.token, c.polling, c.externalUrl, c.port, c.secret], ["1:A", false, "https://bot.onrender.com", 10000, "abcd"]);
  assert.equal(c.site, "https://amertakcloud.vercel.app");
  assert.equal(c.plansUrl, "https://amertakcloud.vercel.app/plans");
  const local = loadConfig({ BOT_TOKEN: "1:A" });
  assert.equal(local.polling, true);
  assert.match(local.secret, /^[0-9a-f]{48}$/);
  assert.equal(loadConfig({ BOT_TOKEN: "x", RENDER_EXTERNAL_URL: "https://b.com", USE_POLLING: "true" }).polling, true);
});
