import http from "node:http";
import { timingSafeEqual } from "node:crypto";
import { pathToFileURL } from "node:url";
import { loadConfig } from "./config.js";
import { createTelegram } from "./telegram.js";
import { createBot } from "./bot.js";

const MAX_BODY = 1024 * 1024;
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); };

export async function start(cfg = loadConfig(), { tg = createTelegram({ token: cfg.token, apiBase: cfg.apiBase }), log = console } = {}) {
  if (!cfg.token) throw new Error("BOT_TOKEN is not set (Render → Environment).");
  const bot = createBot({ cfg, tg, log });
  const hookPath = `/telegram/${cfg.secret}`;
  const pending = new Set(); // updates still being processed (so a shutdown can wait for them)

  const server = http.createServer((req, res) => {
    const path = (req.url || "/").split("?")[0];
    if (req.method === "GET" && (path === "/" || path === "/health")) { res.writeHead(200, { "content-type": "text/plain" }); return res.end("AmertakCloud bot is running"); }
    if (req.method === "POST" && path === hookPath) {
      if (!same(req.headers["x-telegram-bot-api-secret-token"] || "", cfg.secret)) { res.writeHead(403); return res.end(); }
      let size = 0; const chunks = [];
      req.on("data", (c) => { size += c.length; if (size > MAX_BODY) { res.writeHead(413); res.end(); req.destroy(); } else chunks.push(c); });
      req.on("end", () => {
        res.writeHead(200); res.end("ok"); // answer Telegram at once; work continues in the background
        try {
          const p = bot.handleUpdate(JSON.parse(Buffer.concat(chunks).toString("utf8")));
          pending.add(p); p.finally(() => pending.delete(p));
        } catch (e) { log.error("bad update", e.message); }
      });
      return;
    }
    res.writeHead(404); res.end();
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(cfg.port, "0.0.0.0", resolve); });
  log.log(`HTTP listening on :${server.address().port}`);

  const me = await tg.call("getMe");
  log.log(`Bot @${me.username} ready (${cfg.polling ? "polling" : "webhook"})`);
  // buttons: the menu button next to the text box opens the website as a Web App
  await tg.call("setChatMenuButton", { menu_button: { type: "web_app", text: "🌐 AmertakCloud", web_app: { url: cfg.webAppUrl } } }).catch((e) => log.error("menu button:", e.message));
  await tg.call("setMyCommands", { commands: [
    { command: "start", description: "ចាប់ផ្តើម / ម៉ឺនុយ" }, { command: "tts", description: "អត្ថបទ → សំឡេង" }, { command: "download", description: "ទាញយកវីដេអូ" },
    { command: "srt", description: "សំឡេង → .srt" }, { command: "qr", description: "បង្កើត QR" }, { command: "help", description: "ជំនួយ" } ] }).catch((e) => log.error("commands:", e.message));

  let stop = () => {};
  if (cfg.polling) {
    await tg.call("deleteWebhook", { drop_pending_updates: false });
    let offset = 0, alive = true;
    const ac = new AbortController();
    stop = () => { alive = false; ac.abort(); };
    (async () => {
      while (alive) {
        try {
          const updates = await tg.call("getUpdates", { offset, timeout: 25, allowed_updates: ["message", "callback_query"] }, ac.signal);
          for (const u of updates) { offset = u.update_id + 1; const p = bot.handleUpdate(u); pending.add(p); p.finally(() => pending.delete(p)); }
        } catch (e) { if (!alive) break; log.error("polling:", e.message); await new Promise((r) => setTimeout(r, 3000)); }
      }
    })();
  } else {
    await tg.call("setWebhook", { url: `${cfg.externalUrl}${hookPath}`, secret_token: cfg.secret, allowed_updates: ["message", "callback_query"], max_connections: 20 });
    log.log(`Webhook set → ${cfg.externalUrl}/telegram/***`);
  }

  return { server, bot, stop: async () => { stop(); await Promise.allSettled([...pending]); await new Promise((r) => server.close(r)); } };
}

// run when started directly (npm start)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  start().then((app) => {
    const bye = () => app.stop().finally(() => process.exit(0));
    process.on("SIGTERM", bye); process.on("SIGINT", bye);
  }).catch((e) => { console.error("Startup failed:", e.message); process.exit(1); });
  process.on("unhandledRejection", (e) => console.error("unhandledRejection", e));
}
