// Khmer texts + inline keyboards. The main menu is exactly 3 rows under the message.
export const T = {
  welcome: (name) => `សួស្តី ${name || "មិត្ត"}! 👋\nសូមស្វាគមន៍មកកាន់ <b>AmertakCloud Bot</b>\n\nជ្រើសរើសមុខងារខាងក្រោម៖`,
  menuHint: "ជ្រើសរើសមុខងារខាងក្រោម៖",
  ttsAsk: (voice) => `🎙 <b>អត្ថបទទៅសំឡេង (Microsoft Edge)</b>\nសំឡេងបច្ចុប្បន្ន៖ <b>${voice}</b>\n\nផ្ញើអត្ថបទមកខ្ញុំ ខ្ញុំនឹងបម្លែងជាសំឡេងខ្មែរ។`,
  dlAsk: "📥 <b>ទាញយកវីដេអូ</b>\nផ្ញើ link មកខ្ញុំ (TikTok, Pinterest ឬ link ឯកសារផ្ទាល់)។",
  srtAsk: (left) => `📝 <b>សំឡេង → .srt</b>\nផ្ញើឯកសារសំឡេង / voice / វីដេអូ (ធំបំផុត ~14MB) មកខ្ញុំ។\nនៅសល់ថ្ងៃនេះ៖ <b>${left}</b> ដង`,
  qrAsk: "🔳 <b>បង្កើត QR Code</b>\nផ្ញើអត្ថបទ ឬ link មកខ្ញុំ។",
  working: { tts: "កំពុងបង្កើតសំឡេង…", dl: "កំពុងស្វែងរកវីដេអូ…", dlGet: "កំពុងទាញយក…", srt: "កំពុងបម្លែងជា .srt (អាចចំណាយពេល 1–2 នាទី)…", qr: "កំពុងបង្កើត QR…" },
  tooLong: (n) => `អត្ថបទវែងពេក (អតិបរមា ${n} តួអក្សរ)។`,
  notText: "សូមផ្ញើជាអត្ថបទ។",
  pickFormat: (title) => `✅ <b>${title}</b>\nជ្រើសរើសទម្រង់៖`,
  tooBig: "ឯកសារធំជាង 50MB មិនអាចផ្ញើតាម Telegram បានទេ។ សូមបើកក្នុងគេហទំព័រ។",
  needFile: "សូមផ្ញើឯកសារសំឡេង វីដេអូ ឬ voice។",
  fileTooBig: "ឯកសារធំពេក។ សូមផ្ញើតូចជាង ~14MB។",
  noKey: "មុខងារនេះមិនទាន់បើក (អ្នកគ្រប់គ្រងមិនទាន់ដាក់ Gemini key)។",
  limit: (n) => `អ្នកបានប្រើគ្រប់ ${n} ដងសម្រាប់ថ្ងៃនេះ។ សម្រាប់ប្រើច្រើនជាងនេះ សូមបើក Web App ហើយទិញ token។`,
  noSpeech: "រកមិនឃើញសំឡេងនិយាយក្នុងឯកសារនេះទេ។",
  busy: "ប្រព័ន្ធកំពុងមមាញឹក សូមព្យាយាមម្តងទៀតក្នុងមួយនាទី។",
  error: "មានបញ្ហា 😢 សូមព្យាយាមម្តងទៀត។",
  ttsDown: "សេវាសំឡេង Microsoft មិនឆ្លើយតបទេ សូមព្យាយាមម្តងទៀត។",
  caption: { tts: "🎙 សំឡេងរបស់អ្នក", srt: "📝 ឯកសារ .srt របស់អ្នក", qr: "🔳 QR Code របស់អ្នក" },
  help: "មុខងារ៖\n🎙 TTS — អត្ថបទទៅសំឡេងខ្មែរ\n📥 Downloader — ទាញយកវីដេអូ\n📝 សំឡេង → .srt\n🔳 QR Code\n💰 ទិញ token តាម Web App\n\nពាក្យបញ្ជា៖ /start /menu /tts /download /srt /qr /help",
};

const cb = (text, data) => ({ text, callback_data: data });

// 3 rows under the message
export function mainMenu({ webAppUrl, plansUrl }) {
  return {
    inline_keyboard: [
      [cb("🎙 TTS", "m:tts"), cb("📥 Downloader", "m:dl")],
      [cb("📝 សំឡេង → .srt", "m:srt"), cb("🔳 QR Code", "m:qr")],
      [{ text: "🌐 Web App", web_app: { url: webAppUrl } }, { text: "💰 ទិញ Token", web_app: { url: plansUrl } }],
    ],
  };
}

// result messages keep the same 3-row layout, with a "back" style first row
export function afterMenu(cfg, mode) {
  const again = { tts: "🎙 TTS ម្តងទៀត", dl: "📥 ទាញយកថ្មី", srt: "📝 ឯកសារថ្មី", qr: "🔳 QR ថ្មី" }[mode];
  const extra = mode === "tts"
    ? [cb("👨 Piseth", "v:piseth"), cb("👩 Sreymom", "v:sreymom")]
    : [cb(again, `m:${mode}`)];
  return {
    inline_keyboard: [
      extra,
      [cb("🏠 ម៉ឺនុយ", "menu"), { text: "🌐 Web App", web_app: { url: cfg.webAppUrl } }],
      [{ text: "💰 ទិញ Token", web_app: { url: cfg.plansUrl } }, cb("❓ ជំនួយ", "help")],
    ],
  };
}

export function formatKeyboard(formats) {
  const rows = formats.slice(0, 8).map((f, i) => [cb(`${f.kind === "audio" ? "🎵" : "🎬"} ${f.label}${f.ext ? ` · ${f.ext}` : ""}`, `d:${i}`)]);
  rows.push([cb("🏠 ម៉ឺនុយ", "menu")]);
  return { inline_keyboard: rows };
}

export const esc = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
