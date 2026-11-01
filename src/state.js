// Per-chat memory (RAM only; Render's disk is ephemeral). Entries expire after 1 hour of silence.
const TTL = 60 * 60 * 1000;

export function createState(now = () => Date.now()) {
  const chats = new Map();
  const daily = new Map(); // `${userId}:${yyyy-mm-dd}` → count
  const lastHit = new Map();

  const gc = () => { const t = now(); for (const [k, v] of chats) if (t - v.at > TTL) chats.delete(k); };
  const day = () => new Date(now()).toISOString().slice(0, 10);

  return {
    get(chatId) {
      if (chats.size > 2000) gc();
      let s = chats.get(chatId);
      if (!s || now() - s.at > TTL) { s = { mode: null, voice: "piseth", formats: null, at: now() }; chats.set(chatId, s); }
      s.at = now();
      return s;
    },
    // soft flood guard: false when the same user acts again within `ms`
    allow(userId, ms = 700) {
      const t = now(), prev = lastHit.get(userId) || 0;
      if (lastHit.size > 5000) lastHit.clear();
      if (t - prev < ms) return false;
      lastHit.set(userId, t);
      return true;
    },
    used(userId) { return daily.get(`${userId}:${day()}`) || 0; },
    use(userId) {
      if (daily.size > 20000) daily.clear();
      const k = `${userId}:${day()}`;
      daily.set(k, (daily.get(k) || 0) + 1);
    },
  };
}
