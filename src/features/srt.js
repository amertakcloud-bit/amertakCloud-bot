import { AppError } from "../errors.js";

// Audio / voice / video → .srt with Gemini (REST, in memory). Needs GEMINI_API_KEY on the server.
const PROMPT = `You are a professional subtitle transcriber.
Transcribe ALL the speech in this media, in the language that is spoken (Khmer stays Khmer script, do not translate).
Return ONLY a JSON array of subtitle cues in time order: [{"start": seconds, "end": seconds, "text": "..."}].
Rules: times are seconds from the very start of the media (decimals allowed); each cue is one short phrase of at most 42 characters
and lasts 1 to 7 seconds; never overlap cues; skip music and silence; do not invent words; fix obvious punctuation.`;

export const srtTime = (sec) => {
  const ms = Math.max(0, Math.round(sec * 1000));
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
};

// Cleans model output: numbers only, sorted, no overlaps, sensible lengths.
export function normalizeCues(raw) {
  const cues = (Array.isArray(raw) ? raw : [])
    .map((c) => ({ start: Number(c?.start), end: Number(c?.end), text: String(c?.text ?? "").replace(/\s+/g, " ").trim() }))
    .filter((c) => Number.isFinite(c.start) && c.text && c.start >= 0)
    .sort((a, b) => a.start - b.start);
  for (let i = 0; i < cues.length; i++) {
    const c = cues[i], next = cues[i + 1];
    if (!Number.isFinite(c.end) || c.end <= c.start) c.end = c.start + Math.min(7, Math.max(1.2, c.text.length * 0.08));
    if (c.end - c.start > 10) c.end = c.start + 10;
    if (next && c.end > next.start) c.end = Math.max(c.start + 0.2, next.start - 0.02);
  }
  return cues.filter((c) => c.end > c.start);
}
export const buildSrt = (cues) => cues.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`).join("\n");

export function createSrtService({ key, model, base = "https://generativelanguage.googleapis.com", fetchImpl = fetch }) {
  return {
    available: Boolean(key),
    async transcribe(buffer, mime) {
      if (!key) throw new AppError("GEMINI_API_KEY is not set", "NO_KEY");
      const res = await fetchImpl(`${base}/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ inline_data: { mime_type: mime || "audio/mpeg", data: buffer.toString("base64") } }, { text: PROMPT }] }],
          generationConfig: {
            temperature: 0,
            responseMimeType: "application/json",
            responseSchema: { type: "ARRAY", items: { type: "OBJECT", properties: { start: { type: "NUMBER" }, end: { type: "NUMBER" }, text: { type: "STRING" } }, required: ["start", "end", "text"] } },
          },
        }),
        signal: AbortSignal.timeout(170000),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 429) throw new AppError("Gemini is busy (rate limit)", "RATE_LIMIT");
      if (!res.ok) throw new AppError(data?.error?.message || `Gemini error ${res.status}`, "GEMINI_ERROR");
      const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
      let parsed;
      try { parsed = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, "")); } catch { throw new AppError("The AI answer could not be read", "BAD_AI_JSON"); }
      const cues = normalizeCues(parsed);
      if (!cues.length) throw new AppError("No speech found", "NO_SPEECH");
      return { cues, srt: buildSrt(cues) };
    },
  };
}
