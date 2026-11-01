import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { start } from "../src/index.js";
import { cfgFor, fakeTg, silentLog } from "./helpers.js";

const post = (url, body, headers = {}) => fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

test("webhook mode: sets the webhook + menu button, checks the secret, answers 200 at once, serves /health", async () => {
  const tg = fakeTg();
  const app = await start(cfgFor({ port: 0 }), { tg, log: silentLog });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const hook = tg.last("setWebhook").params;
  assert.equal(hook.url, "https://bot.onrender.com/telegram/sekret");
  assert.equal(hook.secret_token, "sekret");
  assert.deepEqual(hook.allowed_updates, ["message", "callback_query"]);
  assert.equal(tg.last("setChatMenuButton").params.menu_button.type, "web_app");
  assert.ok(tg.last("setMyCommands").params.commands.some((c) => c.command === "tts"));
  assert.equal((await fetch(`${base}/health`)).status, 200);
  assert.equal((await fetch(`${base}/`)).status, 200);
  assert.equal((await fetch(`${base}/nope`)).status, 404);
  const update = { update_id: 1, message: { chat: { id: 1, type: "private" }, from: { id: 2, first_name: "A" }, text: "/start" } };
  assert.equal((await post(`${base}/telegram/sekret`, update)).status, 403); // no secret header
  assert.equal((await post(`${base}/telegram/sekret`, update, { "x-telegram-bot-api-secret-token": "wrong!" })).status, 403);
  assert.equal((await post(`${base}/telegram/other`, update, { "x-telegram-bot-api-secret-token": "sekret" })).status, 404);
  assert.equal((await post(`${base}/telegram/sekret`, update, { "x-telegram-bot-api-secret-token": "sekret" })).status, 200);
  assert.equal((await fetch(`${base}/telegram/sekret`, { method: "POST", headers: { "x-telegram-bot-api-secret-token": "sekret" }, body: "{not json" })).status, 200); // never crashes
  await app.stop(); // waits for the update that was in flight
  assert.ok(tg.all("sendMessage").length >= 1);
});

test("polling mode: reads updates, advances the offset, deletes any old webhook", async () => {
  const tg = fakeTg();
  let served = 0;
  const offsets = [];
  tg.call = async function (method, params = {}, signal) {
    tg.calls.push({ method, params });
    if (method === "getMe") return { username: "b" };
    if (method === "sendMessage") return { message_id: 1 };
    if (method === "getUpdates") {
      offsets.push(params.offset);
      if (served++ === 0) return [{ update_id: 41, message: { chat: { id: 1, type: "private" }, from: { id: 2, first_name: "A" }, text: "/start" } }];
      await new Promise((r, j) => { const t = setTimeout(r, 2000); signal?.addEventListener("abort", () => { clearTimeout(t); j(new Error("aborted")); }); }).catch(() => {});
      return [];
    }
    return true;
  };
  const app = await start(cfgFor({ port: 0, polling: true }), { tg, log: silentLog });
  await new Promise((r) => setTimeout(r, 300));
  assert.ok(tg.calls.some((c) => c.method === "deleteWebhook"));
  assert.equal(tg.calls.filter((c) => c.method === "setWebhook").length, 0);
  assert.deepEqual(offsets.slice(0, 2), [0, 42]);
  assert.ok(tg.calls.some((c) => c.method === "sendMessage"));
  await app.stop();
});

test("startup without BOT_TOKEN fails with a clear message", async () => {
  await assert.rejects(start(cfgFor({ token: "" }), { tg: fakeTg(), log: silentLog }), /BOT_TOKEN/);
});

// the exact thing Render runs: `npm start` → node src/index.js, against a fake Telegram server
test("real process (node src/index.js) boots, registers the webhook and answers /health", async () => {
  const calls = [];
  const api = http.createServer(async (req, res) => {
    const c = []; for await (const d of req) c.push(d);
    calls.push([req.url, Buffer.concat(c).toString()]);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, result: req.url.endsWith("/getMe") ? { username: "bot" } : true }));
  });
  api.listen(0, "127.0.0.1"); await once(api, "listening");
  const child = spawn(process.execPath, ["src/index.js"], {
    cwd: new URL("..", import.meta.url).pathname,
    env: { PATH: process.env.PATH, BOT_TOKEN: "1:T", TELEGRAM_API_BASE: `http://127.0.0.1:${api.address().port}`, RENDER_EXTERNAL_URL: "https://bot.onrender.com", PORT: "38457", WEBHOOK_SECRET: "abc123" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = ""; child.stdout.on("data", (d) => (out += d)); child.stderr.on("data", (d) => (out += d));
  for (let i = 0; i < 60 && !/Webhook set/.test(out); i++) await new Promise((r) => setTimeout(r, 100));
  try {
    assert.match(out, /Webhook set/, out);
    assert.equal((await fetch("http://127.0.0.1:38457/health")).status, 200);
    const set = calls.find(([u]) => u.endsWith("/setWebhook"));
    assert.equal(JSON.parse(set[1]).url, "https://bot.onrender.com/telegram/abc123");
    assert.ok(calls.some(([u]) => u.endsWith("/setChatMenuButton")));
  } finally { child.kill("SIGTERM"); api.close(); }
  const [code] = await once(child, "exit");
  assert.ok(code === 0 || code === null, `exit ${code}`);
});
