import test from "node:test";
import assert from "node:assert/strict";
import { createBot } from "../src/bot.js";
import { VOICES } from "../src/features/edgeTts.js";
import { cbq, cfgFor, fakeTg, looseState, msg, silentLog } from "./helpers.js";

async function make(over = {}, deps = {}) {
  const tg = fakeTg();
  const cfg = cfgFor(over);
  const bot = createBot({ cfg, tg, state: await looseState(), log: silentLog, tts: async () => Buffer.from("ID3-mp3"), ...deps });
  return { tg, bot, cfg };
}

test("/start shows the welcome with a 3-row inline menu and two Web App buttons", async () => {
  const { tg, bot } = await make();
  await bot.handleUpdate({ message: msg("/start") });
  const m = tg.last("sendMessage");
  assert.match(m.params.text, /Dara/);
  const rows = m.params.reply_markup.inline_keyboard;
  assert.equal(rows.length, 3);
  assert.equal(rows[2].length, 2);
  assert.ok(rows[2].every((b) => b.web_app?.url.startsWith("https://site.test")));
  assert.equal(rows[2][1].web_app.url, "https://site.test/plans"); // token sale page
  const labels = rows.flat().map((b) => b.text).join(" ");
  for (const w of ["TTS", "Downloader", ".srt", "QR", "Web App", "Token"]) assert.match(labels, new RegExp(w));
});

test("in a group the Web App buttons become plain link buttons (Telegram rejects web_app there)", async () => {
  const { tg, bot } = await make();
  await bot.handleUpdate({ message: msg("/menu", { chat: { id: -100, type: "supergroup" } }) });
  const rows = tg.last("sendMessage").params.reply_markup.inline_keyboard;
  assert.ok(rows[2].every((b) => b.url && !b.web_app));
});

test("TTS: pick the tool, send text, get an mp3 with the same 3-row layout; voice toggle works", async () => {
  const seen = [];
  const { tg, bot } = await make({}, { tts: async (text, o) => { seen.push([text, o.voice]); return Buffer.from("ID3x"); } });
  await bot.handleUpdate({ callback_query: cbq("m:tts") });
  assert.match(tg.last("sendMessage").params.text, /Piseth/);
  await bot.handleUpdate({ message: msg("សួស្តីពិភពលោក") });
  const up = tg.last("sendAudio");
  assert.equal(up.files.audio.type, "audio/mpeg");
  assert.equal(up.files.audio.data.toString(), "ID3x");
  assert.equal(up.params.reply_markup.inline_keyboard.length, 3);
  await bot.handleUpdate({ callback_query: cbq("v:sreymom") });
  await bot.handleUpdate({ message: msg("hello") });
  assert.deepEqual(seen, [["សួស្តីពិភពលោក", "piseth"], ["hello", "sreymom"]]);
  assert.ok(tg.all("deleteMessage").length >= 2); // the "working…" notice is removed
});

test("TTS: too long text is refused; a Microsoft outage gives a friendly message (no crash)", async () => {
  const { tg, bot } = await make({}, { tts: async () => { const e = new Error("TTS_UNAVAILABLE"); e.detail = "HTTP 403"; throw e; } });
  await bot.handleUpdate({ message: msg("/tts " + "ក".repeat(300)) });
  assert.match(tg.last("sendMessage").params.text, /វែងពេក/);
  await bot.handleUpdate({ message: msg("/tts សួស្តី") });
  assert.match(tg.last("sendMessage").params.text, /Microsoft/);
});

test("Downloader: link → format buttons → file is sent as video / audio", async () => {
  const fetched = [];
  const site = {
    resolve: async (u) => { fetched.push(u); return { title: "Funny <cat>", formats: [{ id: "v1", label: "HD", kind: "video", ext: "mp4", token: "TV" }, { id: "a1", label: "Audio only", kind: "audio", ext: "mp3", token: "TA" }] }; },
    fetchFile: async (token) => ({ buffer: Buffer.from("file-" + token), size: 9 }),
  };
  const { tg, bot } = await make({}, { site });
  await bot.handleUpdate({ message: msg("look https://www.tiktok.com/@a/video/1 wow") });
  assert.deepEqual(fetched, ["https://www.tiktok.com/@a/video/1"]);
  const kb = tg.last("sendMessage").params.reply_markup.inline_keyboard;
  assert.equal(kb[0][0].callback_data, "d:0");
  assert.match(tg.last("sendMessage").params.text, /Funny &lt;cat&gt;/); // HTML-escaped
  await bot.handleUpdate({ callback_query: cbq("d:0") });
  assert.equal(tg.last("sendVideo").files.video.data.toString(), "file-TV");
  await bot.handleUpdate({ callback_query: cbq("d:1") });
  assert.equal(tg.last("sendAudio").files.audio.data.toString(), "file-TA");
});

test("Downloader: unsupported site and oversize files give clear messages", async () => {
  const site = {
    resolve: async () => { const e = new Error("This site is not supported"); e.code = "UNSUPPORTED_SITE"; throw e; },
    fetchFile: async () => { const e = new Error("big"); e.code = "TOO_LARGE"; throw e; },
  };
  const { tg, bot } = await make({}, { site });
  await bot.handleUpdate({ message: msg("https://youtube.com/watch?v=1") });
  assert.match(tg.last("sendMessage").params.text, /not supported/);
  // a stale button (no formats stored) just asks for a link again
  await bot.handleUpdate({ callback_query: cbq("d:0") });
  assert.match(tg.last("sendMessage").params.text, /link/);
});

test("Audio → .srt: voice message becomes a UTF-8 .srt document; daily limit and missing key are handled", async () => {
  const srt = { available: true, transcribe: async (buf, mime) => ({ cues: [{}, {}], srt: `1\n00:00:00,000 --> 00:00:01,000\nសួស្តី (${mime},${buf.length})\n` }) };
  const { tg, bot } = await make({}, { srt });
  tg.files.set("F1", { buffer: Buffer.from("OGG"), path: "voice/a.oga" });
  const voice = () => msg(undefined, { voice: { file_id: "F1", mime_type: "audio/ogg", file_size: 1000 } });
  await bot.handleUpdate({ message: voice() });
  const doc = tg.last("sendDocument");
  assert.match(doc.files.document.name, /\.srt$/);
  const body = doc.files.document.data.toString("utf8");
  assert.ok(body.startsWith("﻿1\n00:00:00,000 --> 00:00:01,000"));
  assert.match(body, /audio\/ogg,3/);
  assert.match(doc.params.caption, /2 lines/);
  await bot.handleUpdate({ message: voice() });
  await bot.handleUpdate({ message: voice() }); // limit is 2 per day
  assert.match(tg.last("sendMessage").params.text, /ប្រើគ្រប់ 2 ដង/);
  const noKey = await make({}, { srt: { available: false } });
  await noKey.bot.handleUpdate({ message: msg(undefined, { audio: { file_id: "x" } }) });
  assert.match(noKey.tg.last("sendMessage").params.text, /Gemini key/);
});

test("Audio → .srt: failed runs are not counted; big files are refused; no-speech is explained", async () => {
  let n = 0;
  const srt = { available: true, transcribe: async () => { n++; if (n === 1) { const e = new Error("x"); e.code = "NO_SPEECH"; throw e; } return { cues: [{}], srt: "1\n" }; } };
  const { tg, bot } = await make({ srtDailyLimit: 1 }, { srt });
  tg.files.set("F", { buffer: Buffer.from("x") });
  const m = () => msg(undefined, { audio: { file_id: "F", file_size: 100 } });
  await bot.handleUpdate({ message: m() });
  assert.match(tg.last("sendMessage").params.text, /រកមិនឃើញ/);
  await bot.handleUpdate({ message: m() }); // still allowed: the first run did not count
  assert.ok(tg.last("sendDocument"));
  await bot.handleUpdate({ message: msg(undefined, { audio: { file_id: "F", file_size: 30 * 1024 * 1024 } }) });
  assert.match(tg.last("sendMessage").params.text, /ប្រើគ្រប់/); // limit reached has priority over size
  const big = await make({}, { srt: { available: true, transcribe: async () => ({ cues: [], srt: "" }) } });
  await big.bot.handleUpdate({ message: msg(undefined, { audio: { file_id: "F", file_size: 30 * 1024 * 1024 } }) });
  assert.match(big.tg.last("sendMessage").params.text, /ធំពេក/);
});

test("QR: text and links become a photo", async () => {
  const asked = [];
  const site = { qr: async (t) => { asked.push(t); return { buffer: Buffer.from("PNG"), isUrl: /^http/.test(t) }; } };
  const { tg, bot } = await make({}, { site });
  await bot.handleUpdate({ callback_query: cbq("m:qr") });
  await bot.handleUpdate({ message: msg("https://amertakcloud.vercel.app") });
  await bot.handleUpdate({ message: msg("/qr hello world") });
  assert.deepEqual(asked, ["https://amertakcloud.vercel.app", "hello world"]);
  assert.equal(tg.all("sendPhoto").length, 2);
  assert.equal(tg.last("sendPhoto").files.photo.type, "image/png");
});

test("menu / help / unknown text / flooding", async () => {
  const { tg, bot } = await make();
  await bot.handleUpdate({ message: msg("hello?") }); // no mode → menu
  assert.equal(tg.last("sendMessage").params.reply_markup.inline_keyboard.length, 3);
  await bot.handleUpdate({ callback_query: cbq("help") });
  assert.match(tg.last("sendMessage").params.text, /QR/);
  // a throwing feature must never reject handleUpdate
  const bad = await make({}, { tts: async () => { throw new Error("boom"); } });
  await assert.doesNotReject(bad.bot.handleUpdate({ message: msg("/tts hi") }));
  // flood guard on the real state
  const real = createBot({ cfg: cfgFor(), tg: fakeTg(), log: silentLog });
  const before = real.state.allow(99), second = real.state.allow(99);
  assert.equal(before, true); assert.equal(second, false);
});

test("voices are the real Khmer neural voices", () => {
  assert.equal(VOICES.piseth.id, "km-KH-PisethNeural");
  assert.equal(VOICES.sreymom.id, "km-KH-SreymomNeural");
});
