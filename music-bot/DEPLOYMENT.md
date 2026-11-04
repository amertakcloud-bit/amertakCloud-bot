# ការដាក់ Bot លើ Render (ជំហានម្តងមួយៗ)

## ជំហាន 1: បង្កើត Telegram Bot
1. បើក Telegram ស្វែងរក **@BotFather**
2. ផ្ញើ `/newbot` → ដាក់ឈ្មោះ និង username (ត្រូវបញ្ចប់ដោយ `bot`)
3. ចម្លង **Token** (ឧ. `123456:ABC...`) រក្សាទុក

## ជំហាន 2: បង្កើត Redis ឥតគិតថ្លៃ (Upstash)
1. ចូល https://upstash.com → Sign up
2. **Create Database** → ជ្រើស Region ជិតបំផុត → Free
3. នៅផ្ទាំង **REST API** ចម្លង:
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`

## ជំហាន 3: នាំចេញ cookies.txt ពី YouTube
> ⚠️ ប្រើ **account YouTube បន្ថែម** កុំប្រើ account ចម្បង
1. បើក Chrome ជា **Incognito** → ចូល YouTube ដោយ account បន្ថែម
2. ដំឡើង extension **"Get cookies.txt LOCALLY"**
3. នៅលើ youtube.com ចុច extension → **Export** → ទទួលបានឯកសារ `cookies.txt`
4. បិទ Incognito window (កុំប្រើ account នោះទៀតក្នុង browser)

## ជំហាន 4: ដាក់កូដលើ GitHub
1. បង្កើត repository ថ្មី (Private ក៏បាន) នៅ https://github.com
2. Upload ឯកសារទាំងអស់ក្នុង folder `music-bot` (**កុំ upload cookies.txt**)
   ```bash
   git init
   git add .
   git commit -m "init"
   git branch -M main
   git remote add origin https://github.com/USERNAME/music-bot.git
   git push -u origin main
   ```

## ជំហាន 5: Deploy លើ Render
1. ចូល https://render.com → Sign up ដោយ GitHub
2. **New +** → **Web Service** → ជ្រើស repository របស់អ្នក
3. កំណត់:
   - **Runtime / Language**: `Docker`
   - **Instance Type**: `Free`
4. ចុច **Advanced** → **Add Environment Variable**:
   | Key | Value |
   |---|---|
   | `BOT_TOKEN` | Token ពី BotFather |
   | `UPSTASH_REDIS_REST_URL` | ពី Upstash |
   | `UPSTASH_REDIS_REST_TOKEN` | ពី Upstash |
   | `MAX_SECONDS` | `600` |
5. នៅ **Secret Files** → **Add Secret File**:
   - Filename: `cookies.txt`
   - Contents: បិទភ្ជាប់ខ្លឹមសារទាំងមូលនៃ `cookies.txt`
6. ចុច **Create Web Service** រង់ចាំ build (3-6 នាទី)
7. មើល **Logs** ត្រូវឃើញ `Cookies loaded` និង `Bot started`

## ជំហាន 6: កុំឱ្យ Bot គេង (UptimeRobot)
Free tier គេងក្រោយ 15 នាទីបើគ្មាន request។
1. ចម្លង URL របស់ service (ឧ. `https://music-bot.onrender.com`)
2. ចូល https://uptimerobot.com → Sign up
3. **Add New Monitor** → Type: `HTTP(s)` → ដាក់ URL → Interval: `5 minutes`

## ជំហាន 7: សាកល្បង
1. បើក bot ក្នុង Telegram → `/start`
2. វាយ `Gmengz` → bot នឹងបង្ហាញ:
   ```
   Artist: Gmengz

   1. Angel
   2. Attention
   ...
   ```
   ជាមួយប៊ូតុង `[1] [2] [3] ...`
3. ចុចលេខ → bot ផ្ញើបទជា mp3

## ដំណោះស្រាយបញ្ហា
| បញ្ហា | ដំណោះស្រាយ |
|---|---|
| `Sign in to confirm you're not a bot` | cookies ផុតកំណត់ ឬមិនទាន់ដាក់ → នាំចេញ cookies ថ្មី ហើយ update Secret File រួច **Manual Deploy** |
| IP ត្រូវ block ខ្លាំង | ចុច **Manual Deploy → Clear build cache & deploy** ដើម្បីបាន IP ថ្មី ឬរង់ចាំ |
| Error `409 Conflict` | មាន bot ដំណើរការពីរកន្លែង (ឧ. ក្នុងកុំព្យូទ័រអ្នក) → បិទមួយ |
| Out of memory | កាត់បន្ថយ `MAX_SECONDS` (ឧ. `420`) |
| `--js-runtimes` error | ដាក់ env `YTDLP_EXTRA_ARGS` ជាតម្លៃទទេ ឬមួយចន្លោះ |
| Bot គេង | ពិនិត្យ UptimeRobot ថាដំណើរការ |

## ការថែទាំ
- **Update yt-dlp**: ចុច **Manual Deploy** (Dockerfile ទាញ version ចុងក្រោយរាល់ build) — ធ្វើរៀងរាល់ 1-2 សប្តាហ៍ ឬពេល bot ខូច
- **Refresh cookies**: រៀងរាល់ 1-2 ខែ ឬពេលមានបញ្ហា "not a bot"
- `file_id` ក្នុង Redis ធ្វើឱ្យបទដែលធ្លាប់ទាញ ផ្ញើបានភ្លាមៗ

## ចំណាំច្បាប់
ការទាញយកបទមានកម្មសិទ្ធិពី YouTube ល្មើស ToS របស់ YouTube ហើយអាចល្មើសច្បាប់រក្សាសិទ្ធិ។ ប្រើសម្រាប់ការសិក្សា ឬបទដែលអ្នកមានសិទ្ធិប៉ុណ្ណោះ។
