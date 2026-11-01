import { AppError } from "../errors.js";

// Talks to the AmertakCloud website API (QR codes + video resolver/downloader live there).
export function createSite({ site, fetchImpl = fetch }) {
  async function json(path, body, timeoutMs = 25000) {
    const res = await fetchImpl(`${site}/api${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.success === false) throw new AppError(data?.message || data?.error?.message || `Website error ${res.status}`, data?.code || data?.error?.code || "SITE_ERROR");
    return data.data ?? data;
  }

  return {
    // → { buffer, text }  (PNG)
    async qr(text) {
      const isUrl = /^https?:\/\/\S+$/i.test(text.trim());
      const res = await fetchImpl(`${site}/api/qr`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(isUrl ? { type: "url", data: { url: text.trim() }, options: { size: 640 } } : { type: "text", data: { text }, options: { size: 640 } }),
        signal: AbortSignal.timeout(25000),
      });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new AppError(j?.message || `QR failed (${res.status})`, j?.code || "QR_FAILED"); }
      return { buffer: Buffer.from(await res.arrayBuffer()), isUrl };
    },
    // → { title, author, duration, formats:[{id,label,kind,ext,token}] }
    resolve: (url) => json("/video/resolve", { url }, 40000),
    // → { buffer, size }  — refuses files larger than maxBytes before reading them
    async fetchFile(token, maxBytes) {
      const res = await fetchImpl(`${site}/api/video/download?token=${encodeURIComponent(token)}`, { signal: AbortSignal.timeout(110000) });
      if (!res.ok) throw new AppError(`Download failed (${res.status})`, "DOWNLOAD_FAILED");
      const len = Number(res.headers.get("content-length")) || 0;
      if (len && len > maxBytes) { res.body?.cancel?.(); throw new AppError("File too large", "TOO_LARGE"); }
      const reader = res.body.getReader();
      const chunks = [];
      let size = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > maxBytes) { reader.cancel(); throw new AppError("File too large", "TOO_LARGE"); }
        chunks.push(value);
      }
      return { buffer: Buffer.concat(chunks), size };
    },
  };
}
