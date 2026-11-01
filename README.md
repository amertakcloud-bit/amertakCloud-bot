# AmertakCloud Telegram Bot

Bot ភាសាខ្មែរសម្រាប់ https://amertakcloud.vercel.app — Node.js ≥ 20, **dependency តែមួយ (`ws`)**, គ្មានការសរសេរ file ទៅ disk (ត្រូវនឹង Render)។

| ប៊ូតុង | មុខងារ |
|---|---|
| 🎙 TTS | អត្ថបទ → សំឡេងខ្មែរ Microsoft Edge (Piseth / Sreymom) ជា mp3 |
| 📥 Downloader | TikTok, Pinterest, link ឯកសារផ្ទាល់ (ប្រើ API របស់ website) |
| 📝 សំឡេង → .srt | ផ្ញើ audio / voice / video → ឯកសារ `.srt` (Gemini) |
| 🔳 QR Code | អត្ថបទ ឬ link → រូប QR |
| 🌐 Web App | បើក website ក្នុង Telegram |
| 💰 ទិញ Token | បើកទំព័រ `/plans` ក្នុង Telegram Web App |

ម៉ឺនុយមាន **៣ ជួរ** ក្រោមសារ ហើយ menu button ក្បែរប្រអប់វាយអក្សរក៏បើក website ដែរ។

## ១) បង្កើត bot
1. Telegram → **@BotFather** → `/newbot` → ចម្លង **BOT_TOKEN**។
2. មិនចាំបាច់ `/setdomain` ទេ ព្រោះប្រើ inline Web App buttons។

## ២) Deploy លើ Render
1. Push folder នេះទៅ GitHub (root នៃ repo = folder នេះ ដែលមាន `package.json`)។
2. Render → **New → Web Service** (ឬ **Blueprint** — វាអានពី `render.yaml`)។
   - Runtime: **Node** · Build: `npm install --omit=dev` · Start: `npm start`
   - Health check path: `/health`
3. **Environment**៖

   | Key | តម្លៃ |
   |---|---|
   | `BOT_TOKEN` | token ពី BotFather (**ចាំបាច់**) |
   | `GEMINI_API_KEY` | សម្រាប់ 📝 សំឡេង → .srt (https://aistudio.google.com/apikey) |
   | `SITE_URL` | `https://amertakcloud.vercel.app` (default មានស្រាប់) |
   | `WEBHOOK_SECRET` | string វែងសម្ងាត់ (Blueprint បង្កើតឱ្យស្វ័យប្រវត្តិ) |
   | `SRT_DAILY_LIMIT` | ចំនួន .srt ក្នុងមួយថ្ងៃ/អ្នកប្រើ (default 5) ការពារ key របស់អ្នក |
4. Deploy។ Render ដាក់ `RENDER_EXTERNAL_URL` ឱ្យស្វ័យប្រវត្តិ — bot នឹង `setWebhook` ខ្លួនឯង។ ក្នុង log ត្រូវឃើញ `Webhook set`។

> **Render Free** ដេកក្រោយ 15 នាទីគ្មានអ្នកប្រើ — សារដំបូងអាចយឺត ~50 វិនាទី។ ដើម្បីកុំឱ្យដេក ដាក់ monitor (ឧ. UptimeRobot) ping `https://<service>.onrender.com/health` រៀងរាល់ 5 នាទី។

## ដំណើរការក្នុងកុំព្យូទ័រ
```bash
npm install
BOT_TOKEN=123:ABC GEMINI_API_KEY=... npm start   # គ្មាន RENDER_EXTERNAL_URL → long polling
npm test
```

## ដែនកំណត់
- Telegram៖ bot ផ្ញើ file ≤ 50MB និងទាញ file ≤ 20MB។ 📝 .srt ទទួល file ≤ ~14MB។
- Downloader ដូច website៖ YouTube / Facebook / Instagram / X ទប់ស្កាត់ — គាំទ្រ TikTok, Pinterest និង link ឯកសារផ្ទាល់។
- 📝 .srt ប្រើ Gemini key របស់ **អ្នកគ្រប់គ្រង bot** (មានកំណត់ក្នុងមួយថ្ងៃ)។ Token ក្នុង website មិនត្រូវបានភ្ជាប់នឹងគណនី Telegram ទេ — ទិញ token តាម 💰 Web App ហើយប្រើលើ website។
- សំឡេង Microsoft អាចត្រូវ block លើ IP ខ្លះ — bot សាកម្តងទៀត រួចប្រើ `/api/tts` របស់ website ជា fallback។
- ក្នុង group ប៊ូតុង Web App ប្តូរជា link ធម្មតា (Telegram មិនអនុញ្ញាត web_app ក្រៅ chat ឯកជន)។
