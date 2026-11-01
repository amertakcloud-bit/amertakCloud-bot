import { randomBytes } from "node:crypto";

// All settings come from environment variables (set in the Render dashboard). Nothing is written to disk.
const env = process.env;
const trim = (s) => String(s ?? "").trim();
const noSlash = (s) => trim(s).replace(/\/+$/, "");

export function loadConfig(e = env) {
  const site = noSlash(e.SITE_URL) || "https://amertakcloud.vercel.app";
  const external = noSlash(e.WEBHOOK_URL) || noSlash(e.RENDER_EXTERNAL_URL);
  return {
    token: trim(e.BOT_TOKEN),
    apiBase: noSlash(e.TELEGRAM_API_BASE) || "https://api.telegram.org",
    site,
    // pages opened as Telegram Web Apps
    webAppUrl: noSlash(e.WEBAPP_URL) || site,
    plansUrl: noSlash(e.PLANS_URL) || `${site}/plans`,
    topupUrl: noSlash(e.TOPUP_URL) || `${site}/topup`,
    port: Number(e.PORT) || 3000,
    polling: trim(e.USE_POLLING).toLowerCase() === "true" || !external,
    externalUrl: external,
    secret: trim(e.WEBHOOK_SECRET).replace(/[^A-Za-z0-9_-]/g, "") || randomBytes(24).toString("hex"),
    geminiKey: trim(e.GEMINI_API_KEY),
    geminiModel: trim(e.GEMINI_SRT_MODEL) || "gemini-3.8-flash",
    geminiBase: noSlash(e.GEMINI_API_BASE) || "https://generativelanguage.googleapis.com",
    srtDailyLimit: Number(e.SRT_DAILY_LIMIT) > 0 ? Number(e.SRT_DAILY_LIMIT) : 5,
    maxTtsChars: Number(e.MAX_TTS_CHARS) > 0 ? Number(e.MAX_TTS_CHARS) : 2500,
    maxUploadBytes: 49 * 1024 * 1024, // Telegram bots can upload files up to 50 MB
  };
}
