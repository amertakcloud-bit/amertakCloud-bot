const http = require("http");
const fs = require("fs");
const { spawn, execFile } = require("child_process");
const { Bot, InputFile, InlineKeyboard } = require("grammy");
const { Redis } = require("@upstash/redis");

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) throw new Error("Missing BOT_TOKEN");

const MAX_SECONDS = parseInt(process.env.MAX_SECONDS || "600", 10); // 10 min
const EXTRA = (process.env.YTDLP_EXTRA_ARGS || "--js-runtimes node").split(" ").filter(Boolean);

// ---------- Cache (Upstash Redis, fallback to memory) ----------
const redis = process.env.UPSTASH_REDIS_REST_URL
  ? new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN })
  : null;
const mem = new Map();
const cget = async (k) => (redis ? await redis.get(k) : mem.get(k) ?? null);
const cset = async (k, v, ttl) => {
  if (redis) return ttl ? redis.set(k, v, { ex: ttl }) : redis.set(k, v);
  mem.set(k, v);
};

// ---------- Cookies (copy to writable path; yt-dlp updates the file) ----------
let cookieArgs = [];
const SECRET = "/etc/secrets/cookies.txt";
if (fs.existsSync(SECRET)) {
  fs.copyFileSync(SECRET, "/app/cookies.txt");
  cookieArgs = ["--cookies", "/app/cookies.txt"];
  console.log("Cookies loaded");
}
const baseArgs = [...cookieArgs, ...EXTRA, "--no-warnings"];

// ---------- Queue (1 job at a time, RAM 512MB) ----------
let chain = Promise.resolve();
const enqueue = (fn) => {
  const p = chain.then(fn, fn);
  chain = p.catch(() => {});
  return p;
};

// ---------- Search ----------
function search(query) {
  return new Promise((resolve, reject) => {
    execFile(
      "yt-dlp",
      [...baseArgs, `ytsearch10:${query}`, "--flat-playlist", "--dump-json"],
      { maxBuffer: 20 * 1024 * 1024, timeout: 60000 },
      (err, stdout, stderr) => {
        if (err) return reject(new Error(stderr || err.message));
        const items = stdout
          .split("\n")
          .filter(Boolean)
          .map((l) => JSON.parse(l))
          .filter((v) => !v.duration || v.duration <= MAX_SECONDS)
          .slice(0, 8)
          .map((v) => ({ id: v.id, title: v.title, channel: v.channel || v.uploader || "", duration: v.duration || 0 }));
        resolve(items);
      }
    );
  });
}

// ---------- Download: yt-dlp -> ffmpeg -> Buffer (no files) ----------
function downloadMp3(id) {
  return new Promise((resolve, reject) => {
    const y = spawn("yt-dlp", [...baseArgs, "-f", "bestaudio", "--no-playlist", "-q", "-o", "-", `https://www.youtube.com/watch?v=${id}`]);
    const f = spawn("ffmpeg", ["-loglevel", "error", "-i", "pipe:0", "-vn", "-b:a", "128k", "-f", "mp3", "pipe:1"]);
    const chunks = [];
    let err = "";
    y.stdout.pipe(f.stdin);
    f.stdin.on("error", () => {});
    f.stdout.on("data", (c) => chunks.push(c));
    y.stderr.on("data", (d) => (err += d));
    f.stderr.on("data", (d) => (err += d));
    const timer = setTimeout(() => { y.kill(); f.kill(); }, 180000);
    f.on("close", (code) => {
      clearTimeout(timer);
      const buf = Buffer.concat(chunks);
      if (code === 0 && buf.length > 0) resolve(buf);
      else reject(new Error(err.slice(-400) || "download failed"));
    });
  });
}

const fmt = (s) => (s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : "");

// ---------- Bot ----------
const bot = new Bot(BOT_TOKEN);

bot.command("start", (ctx) =>
  ctx.reply("សួស្តី! 🎵 វាយឈ្មោះបទ ឬឈ្មោះតារាចម្រៀង ដើម្បីស្វែងរក។")
);

bot.on("message:text", async (ctx) => {
  const query = ctx.message.text.trim();
  if (query.startsWith("/")) return;
  const wait = await ctx.reply("🔎 កំពុងស្វែងរក...");
  try {
    const items = await enqueue(() => search(query));
    if (!items.length) return ctx.api.editMessageText(ctx.chat.id, wait.message_id, "រកមិនឃើញទេ 😕");

    for (const it of items) await cset(`v:${it.id}`, it, 86400);

    let text = `Artist: ${query}\n\n`;
    items.forEach((it, i) => {
      text += `${i + 1}. ${it.title} ${it.duration ? `(${fmt(it.duration)})` : ""}\n`;
    });
    text += "\n👇 ចុចលេខដើម្បីទាញយក";

    const kb = new InlineKeyboard();
    items.forEach((it, i) => {
      kb.text(String(i + 1), `dl:${it.id}`);
      if ((i + 1) % 4 === 0) kb.row();
    });
    await ctx.api.editMessageText(ctx.chat.id, wait.message_id, text, { reply_markup: kb });
  } catch (e) {
    console.error(e);
    await ctx.api.editMessageText(ctx.chat.id, wait.message_id, "❌ ស្វែងរកមិនបាន សូមព្យាយាមម្តងទៀត។");
  }
});

bot.callbackQuery(/^dl:(.+)$/, async (ctx) => {
  const id = ctx.match[1];
  await ctx.answerCallbackQuery({ text: "កំពុងរៀបចំ..." });
  const meta = (await cget(`v:${id}`)) || { title: id, channel: "" };

  try {
    const cachedFileId = await cget(`f:${id}`);
    if (cachedFileId) return await ctx.replyWithAudio(cachedFileId);

    const wait = await ctx.reply(`⏳ កំពុងទាញយក: ${meta.title}`);
    const buf = await enqueue(() => downloadMp3(id));
    const sent = await ctx.replyWithAudio(new InputFile(buf, `${meta.title}.mp3`), {
      title: meta.title,
      performer: meta.channel,
      duration: meta.duration || undefined,
    });
    await cset(`f:${id}`, sent.audio.file_id);
    await ctx.api.deleteMessage(ctx.chat.id, wait.message_id).catch(() => {});
  } catch (e) {
    console.error(e);
    await ctx.reply("❌ ទាញយកមិនបាន (YouTube អាច block)។ សូមព្យាយាមម្តងទៀត។");
  }
});

bot.catch((e) => console.error("Bot error:", e.error || e));

// ---------- Health server for Render ----------
http
  .createServer((req, res) => {
    res.writeHead(200);
    res.end("ok");
  })
  .listen(process.env.PORT || 3000);

bot.start({ drop_pending_updates: true });
console.log("Bot started");
