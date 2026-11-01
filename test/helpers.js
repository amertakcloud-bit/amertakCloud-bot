// Test doubles: a recording Telegram client and fake website / Gemini.
export function fakeTg() {
  const calls = [];
  const files = new Map();
  const tg = {
    calls,
    files,
    async call(method, params = {}) {
      calls.push({ method, params, kind: "json" });
      if (method === "sendMessage") return { message_id: calls.length };
      if (method === "getMe") return { username: "amertak_test_bot" };
      return true;
    },
    async upload(method, params, f) {
      calls.push({ method, params, files: f, kind: "upload" });
      return { message_id: calls.length };
    },
    async download(fileId) {
      const f = files.get(fileId);
      if (!f) throw new Error("no file");
      return { buffer: f.buffer, path: f.path || "voice/file_1.oga" };
    },
    last: (m) => [...calls].reverse().find((c) => c.method === m),
    all: (m) => calls.filter((c) => c.method === m),
  };
  return tg;
}
export const cfgFor = (over = {}) => ({
  token: "T", apiBase: "http://x", site: "https://site.test", webAppUrl: "https://site.test", plansUrl: "https://site.test/plans", topupUrl: "https://site.test/topup",
  port: 0, polling: false, externalUrl: "https://bot.onrender.com", secret: "sekret", geminiKey: "k", geminiModel: "m", geminiBase: "http://gemini.test",
  srtDailyLimit: 2, maxTtsChars: 200, maxUploadBytes: 49 * 1024 * 1024, ...over,
});
export const msg = (text, over = {}) => ({ message_id: 1, chat: { id: 10, type: "private" }, from: { id: 7, first_name: "Dara" }, text, ...over });
export const cbq = (data, over = {}) => ({ id: "q1", from: { id: 7, first_name: "Dara" }, message: { message_id: 5, chat: { id: 10, type: "private" } }, data, ...over });
export const silentLog = { log() {}, error() {} };
// state that never rate-limits, so tests can fire updates back to back
export const looseState = async () => { const { createState } = await import("../src/state.js"); const s = createState(); s.allow = () => true; return s; };
