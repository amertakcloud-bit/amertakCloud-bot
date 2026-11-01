// Minimal Telegram Bot API client on top of Node's built-in fetch / FormData — no dependencies, no temp files.
export class TelegramError extends Error {
  constructor(message, code, params) { super(message); this.code = code; this.params = params; }
}

export function createTelegram({ token, apiBase = "https://api.telegram.org", fetchImpl = fetch }) {
  const url = (m) => `${apiBase}/bot${token}/${m}`;

  async function parse(res) {
    let json;
    try { json = await res.json(); } catch { throw new TelegramError(`Telegram HTTP ${res.status}`, res.status); }
    if (!json.ok) throw new TelegramError(json.description || "Telegram error", json.error_code, json.parameters);
    return json.result;
  }

  // JSON call
  async function call(method, params = {}, signal) {
    const res = await fetchImpl(url(method), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(params), signal });
    return parse(res);
  }

  // multipart upload: files = { document: { data: Buffer, name, type } }
  async function upload(method, params, files, signal) {
    const form = new FormData();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) form.append(k, typeof v === "object" ? JSON.stringify(v) : String(v));
    for (const [k, f] of Object.entries(files)) form.append(k, new Blob([f.data], { type: f.type || "application/octet-stream" }), f.name || k);
    const res = await fetchImpl(url(method), { method: "POST", body: form, signal });
    return parse(res);
  }

  // Downloads a file a user sent (Telegram allows bots to download up to 20 MB). Returns a Buffer.
  async function download(fileId, { maxBytes = 20 * 1024 * 1024 } = {}) {
    const info = await call("getFile", { file_id: fileId });
    if (info.file_size && info.file_size > maxBytes) throw new TelegramError("FILE_TOO_BIG", 413);
    const res = await fetchImpl(`${apiBase}/file/bot${token}/${info.file_path}`);
    if (!res.ok) throw new TelegramError(`Download failed (${res.status})`, res.status);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) throw new TelegramError("FILE_TOO_BIG", 413);
    return { buffer: buf, path: info.file_path };
  }

  return { call, upload, download };
}
