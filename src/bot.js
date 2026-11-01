import { speak, VOICES } from "./features/edgeTts.js";
import { createSrtService } from "./features/srt.js";
import { createSite } from "./features/site.js";
import { createState } from "./state.js";
import { T, afterMenu, esc, formatKeyboard, mainMenu } from "./menu.js";

const URL_RE = /https?:\/\/[^\s<>"']+/i;

// Web-app buttons only work in private chats — in groups they become plain link buttons.
function forChat(kb, isPrivate) {
  if (isPrivate) return kb;
  return { inline_keyboard: kb.inline_keyboard.map((row) => row.map((b) => (b.web_app ? { text: b.text, url: b.web_app.url } : b))) };
}

export function createBot({ cfg, tg, site = createSite({ site: cfg.site }), srt = createSrtService({ key: cfg.geminiKey, model: cfg.geminiModel, base: cfg.geminiBase }), state = createState(), tts = speak, log = console }) {
  const menu = mainMenu(cfg);

  const send = (chatId, text, kb, isPrivate = true) =>
    tg.call("sendMessage", { chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true, ...(kb ? { reply_markup: forChat(kb, isPrivate) } : {}) });
  const typing = (chatId, action = "typing") => tg.call("sendChatAction", { chat_id: chatId, action }).catch(() => {});

  async function showMenu(chatId, name, isPrivate, welcome = false) {
    return send(chatId, welcome ? T.welcome(esc(name)) : T.menuHint, menu, isPrivate);
  }

  async function setMode(chatId, userId, mode, isPrivate) {
    const s = state.get(chatId);
    s.mode = mode;
    s.formats = null;
    const text = { tts: T.ttsAsk(VOICES[s.voice].label), dl: T.dlAsk, srt: T.srtAsk(Math.max(0, cfg.srtDailyLimit - state.used(userId))), qr: T.qrAsk }[mode];
    const kb = mode === "tts" ? afterMenu(cfg, "tts") : { inline_keyboard: [[{ text: "🏠 ម៉ឺនុយ", callback_data: "menu" }]] };
    return send(chatId, text, kb, isPrivate);
  }

  // ───────── features ─────────
  async function doTts(chat, text) {
    if (text.length > cfg.maxTtsChars) return send(chat.id, T.tooLong(cfg.maxTtsChars), null, chat.private);
    const s = state.get(chat.id);
    const wait = await send(chat.id, T.working.tts);
    typing(chat.id, "record_voice");
    try {
      const audio = await tts(text, { voice: s.voice, site: cfg.site });
      if (audio.length > cfg.maxUploadBytes) throw new Error("big");
      await tg.upload("sendAudio", { chat_id: chat.id, caption: T.caption.tts, title: "AmertakCloud TTS", performer: VOICES[s.voice].label, reply_markup: forChat(afterMenu(cfg, "tts"), chat.private) }, { audio: { data: audio, name: `khmer-${s.voice}.mp3`, type: "audio/mpeg" } });
    } catch (e) {
      log.error?.("[tts]", e.message, e.detail || "");
      await send(chat.id, e.message === "TTS_UNAVAILABLE" ? T.ttsDown : T.error, afterMenu(cfg, "tts"), chat.private);
    } finally {
      tg.call("deleteMessage", { chat_id: chat.id, message_id: wait.message_id }).catch(() => {});
    }
  }

  async function doResolve(chat, url) {
    const wait = await send(chat.id, T.working.dl);
    typing(chat.id);
    try {
      const info = await site.resolve(url);
      if (!info.formats?.length) throw new Error("no formats");
      state.get(chat.id).formats = { title: info.title, items: info.formats };
      await send(chat.id, T.pickFormat(esc(info.title || "Video")), formatKeyboard(info.formats), chat.private);
    } catch (e) {
      log.error?.("[resolve]", e.message);
      await send(chat.id, `⚠️ ${esc(e.code === "UNSUPPORTED_SITE" || e.code === "INVALID_URL" || e.code === "SITE_ERROR" ? e.message : T.error)}`, afterMenu(cfg, "dl"), chat.private);
    } finally {
      tg.call("deleteMessage", { chat_id: chat.id, message_id: wait.message_id }).catch(() => {});
    }
  }

  async function doDownload(chat, index) {
    const f = state.get(chat.id).formats;
    const item = f?.items?.[index];
    if (!item) return send(chat.id, T.dlAsk, afterMenu(cfg, "dl"), chat.private);
    const wait = await send(chat.id, T.working.dlGet);
    typing(chat.id, item.kind === "audio" ? "upload_voice" : "upload_video");
    try {
      const { buffer } = await site.fetchFile(item.token, cfg.maxUploadBytes);
      const name = `${String(f.title || "video").replace(/[\\/:*?"<>|]+/g, " ").trim().slice(0, 60) || "video"}.${item.ext || "mp4"}`;
      const kb = forChat(afterMenu(cfg, "dl"), chat.private);
      if (item.kind === "audio") await tg.upload("sendAudio", { chat_id: chat.id, title: f.title, reply_markup: kb }, { audio: { data: buffer, name, type: "audio/mpeg" } });
      else if ((item.ext || "mp4") === "mp4") await tg.upload("sendVideo", { chat_id: chat.id, supports_streaming: true, caption: esc(f.title || ""), parse_mode: "HTML", reply_markup: kb }, { video: { data: buffer, name, type: "video/mp4" } });
      else await tg.upload("sendDocument", { chat_id: chat.id, reply_markup: kb }, { document: { data: buffer, name, type: "application/octet-stream" } });
    } catch (e) {
      log.error?.("[download]", e.message);
      await send(chat.id, e.code === "TOO_LARGE" ? T.tooBig : T.error, afterMenu(cfg, "dl"), chat.private);
    } finally {
      tg.call("deleteMessage", { chat_id: chat.id, message_id: wait.message_id }).catch(() => {});
    }
  }

  async function doSrt(chat, user, msg) {
    if (!srt.available) return send(chat.id, T.noKey, afterMenu(cfg, "srt"), chat.private);
    const media = msg.audio || msg.voice || msg.video || msg.video_note || msg.document;
    if (!media) return send(chat.id, T.needFile, null, chat.private);
    if (state.used(user.id) >= cfg.srtDailyLimit) return send(chat.id, T.limit(cfg.srtDailyLimit), afterMenu(cfg, "srt"), chat.private);
    if (media.file_size && media.file_size > 14 * 1024 * 1024) return send(chat.id, T.fileTooBig, afterMenu(cfg, "srt"), chat.private);
    const wait = await send(chat.id, T.working.srt);
    typing(chat.id, "upload_document");
    try {
      const { buffer, path } = await tg.download(media.file_id, { maxBytes: 14 * 1024 * 1024 });
      const mime = media.mime_type || (msg.voice ? "audio/ogg" : msg.video || msg.video_note ? "video/mp4" : /\.mp3$/i.test(path) ? "audio/mpeg" : /\.(m4a|aac)$/i.test(path) ? "audio/mp4" : /\.wav$/i.test(path) ? "audio/wav" : "audio/mpeg");
      const { cues, srt: text } = await srt.transcribe(buffer, mime);
      state.use(user.id); // counted only after a successful result
      const base = String(media.file_name || "subtitles").replace(/\.[^.]+$/, "").replace(/[^\wក-៿ -]+/g, "_").slice(0, 60) || "subtitles";
      await tg.upload("sendDocument", { chat_id: chat.id, caption: `${T.caption.srt} · ${cues.length} lines`, reply_markup: forChat(afterMenu(cfg, "srt"), chat.private) }, { document: { data: Buffer.from("﻿" + text, "utf8"), name: `${base}.srt`, type: "application/x-subrip" } });
    } catch (e) {
      log.error?.("[srt]", e.code || "", e.message);
      const m = e.message === "FILE_TOO_BIG" ? T.fileTooBig : e.code === "NO_SPEECH" ? T.noSpeech : e.code === "RATE_LIMIT" ? T.busy : T.error;
      await send(chat.id, m, afterMenu(cfg, "srt"), chat.private);
    } finally {
      tg.call("deleteMessage", { chat_id: chat.id, message_id: wait.message_id }).catch(() => {});
    }
  }

  async function doQr(chat, text) {
    if (text.length > 1000) return send(chat.id, T.tooLong(1000), null, chat.private);
    const wait = await send(chat.id, T.working.qr);
    typing(chat.id, "upload_photo");
    try {
      const { buffer } = await site.qr(text);
      await tg.upload("sendPhoto", { chat_id: chat.id, caption: T.caption.qr, reply_markup: forChat(afterMenu(cfg, "qr"), chat.private) }, { photo: { data: buffer, name: "qr.png", type: "image/png" } });
    } catch (e) {
      log.error?.("[qr]", e.message);
      await send(chat.id, T.error, afterMenu(cfg, "qr"), chat.private);
    } finally {
      tg.call("deleteMessage", { chat_id: chat.id, message_id: wait.message_id }).catch(() => {});
    }
  }

  // ───────── updates ─────────
  async function onMessage(msg) {
    const chat = { id: msg.chat.id, private: msg.chat.type === "private" };
    const user = msg.from || { id: msg.chat.id };
    if (user.is_bot) return;
    if (!state.allow(user.id)) return;
    const text = (msg.text || msg.caption || "").trim();
    const cmd = /^\/(\w+)(?:@\w+)?(?:\s+([\s\S]*))?$/.exec(text);
    const s = state.get(chat.id);

    if (cmd) {
      const [, name, arg] = cmd;
      switch (name.toLowerCase()) {
        case "start": return showMenu(chat.id, user.first_name, chat.private, true);
        case "menu": return showMenu(chat.id, user.first_name, chat.private);
        case "help": return send(chat.id, T.help, menu, chat.private);
        case "tts": s.mode = "tts"; if (arg?.trim()) return doTts(chat, arg.trim()); return setMode(chat.id, user.id, "tts", chat.private);
        case "download": case "dl": s.mode = "dl"; if (URL_RE.test(arg || "")) return doResolve(chat, URL_RE.exec(arg)[0]); return setMode(chat.id, user.id, "dl", chat.private);
        case "srt": return setMode(chat.id, user.id, "srt", chat.private);
        case "qr": s.mode = "qr"; if (arg?.trim()) return doQr(chat, arg.trim()); return setMode(chat.id, user.id, "qr", chat.private);
        default: return showMenu(chat.id, user.first_name, chat.private);
      }
    }

    // a file always means "audio → srt" (even without choosing the mode first)
    if (msg.audio || msg.voice || msg.video || msg.video_note || (msg.document && /^(audio|video)\//.test(msg.document.mime_type || ""))) {
      s.mode = "srt";
      return doSrt(chat, user, msg);
    }
    if (!text) return;
    // a link with no mode chosen is most likely a download
    if (!s.mode && URL_RE.test(text)) s.mode = "dl";
    switch (s.mode) {
      case "tts": return doTts(chat, text);
      case "dl": { const m = URL_RE.exec(text); return m ? doResolve(chat, m[0]) : send(chat.id, T.dlAsk, null, chat.private); }
      case "qr": return doQr(chat, text);
      case "srt": return send(chat.id, T.needFile, null, chat.private);
      default: return showMenu(chat.id, user.first_name, chat.private);
    }
  }

  async function onCallback(q) {
    const msg = q.message;
    const chat = { id: msg?.chat?.id ?? q.from.id, private: (msg?.chat?.type ?? "private") === "private" };
    tg.call("answerCallbackQuery", { callback_query_id: q.id }).catch(() => {});
    if (!state.allow(q.from.id, 350)) return;
    const data = String(q.data || "");
    if (data === "menu") { state.get(chat.id).mode = null; return showMenu(chat.id, q.from.first_name, chat.private); }
    if (data === "help") return send(chat.id, T.help, menu, chat.private);
    if (data.startsWith("m:")) {
      const mode = data.slice(2);
      if (["tts", "dl", "srt", "qr"].includes(mode)) return setMode(chat.id, q.from.id, mode, chat.private);
    }
    if (data.startsWith("v:")) {
      const v = data.slice(2);
      if (VOICES[v]) { const s = state.get(chat.id); s.voice = v; s.mode = "tts"; return send(chat.id, T.ttsAsk(VOICES[v].label), afterMenu(cfg, "tts"), chat.private); }
    }
    if (data.startsWith("d:")) return doDownload(chat, Number(data.slice(2)));
  }

  async function handleUpdate(update) {
    try {
      if (update.message) await onMessage(update.message);
      else if (update.callback_query) await onCallback(update.callback_query);
    } catch (e) {
      log.error?.("[update]", e.message);
    }
  }

  return { handleUpdate, state };
}
