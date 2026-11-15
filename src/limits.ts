// The limits that keep one visitor, or many, from spending the free quota.
// Groq's free plan for each model: 30 requests and 8,000 tokens a minute,
// 1,000 requests and 200,000 tokens a day. The gate stops a little before.
export const LIMITS = {
  perVisitor: { messages: 15, windowSec: 60 * 60 },
  perMinute: { calls: 25, tokens: 6000 },
  perDay: { calls: 900, tokens: 180000 },
};

export class Busy extends Error {
  constructor(public retryAfter: number) { super("busy"); }
}

const now = () => Math.floor(Date.now() / 1000);

async function add(db: D1Database, key: string, by: number, expiresAt: number) {
  const row = await db.prepare(
    `INSERT INTO counters (key, n, expires_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET n = n + excluded.n RETURNING n`,
  ).bind(key, by, expiresAt).first<{ n: number }>();
  return row!.n;
}

const read = async (db: D1Database, key: string) =>
  (await db.prepare("SELECT n FROM counters WHERE key = ?").bind(key).first<{ n: number }>())?.n || 0;

// One more message from this visitor in the current hour; false when over the limit
export async function countVisitor(db: D1Database, visitor: string) {
  const t = now(), w = LIMITS.perVisitor.windowSec, start = t - (t % w);
  if (Math.random() < 0.05) await db.prepare("DELETE FROM counters WHERE expires_at < ?").bind(t).run();
  const n = await add(db, `visitor:${visitor}:${start}`, 1, start + w);
  return { ok: n <= LIMITS.perVisitor.messages, retryAfter: start + w - t };
}

// The budget of Groq calls and tokens, per model, per minute and per day
export function budget(db: D1Database) {
  const keys = (model: string) => {
    const t = now(), minute = t - (t % 60), day = t - (t % 86400);
    return { t, minute, day, m: `groq:${model}:min:${minute}`, d: `groq:${model}:day:${day}` };
  };
  return {
    // Before a call: reserve it, or refuse without calling Groq
    async reserve(model: string) {
      const k = keys(model);
      const [tokMin, tokDay] = await Promise.all([read(db, `${k.m}:tokens`), read(db, `${k.d}:tokens`)]);
      if (tokDay >= LIMITS.perDay.tokens) throw new Busy(k.day + 86400 - k.t);
      if (tokMin >= LIMITS.perMinute.tokens) throw new Busy(k.minute + 60 - k.t);
      const [callsMin, callsDay] = await Promise.all([add(db, `${k.m}:calls`, 1, k.minute + 120), add(db, `${k.d}:calls`, 1, k.day + 86400 * 2)]);
      if (callsDay > LIMITS.perDay.calls) throw new Busy(k.day + 86400 - k.t);
      if (callsMin > LIMITS.perMinute.calls) throw new Busy(k.minute + 60 - k.t);
    },
    // After a call: count the tokens it used
    async spent(model: string, tokens: number) {
      const k = keys(model);
      await Promise.all([add(db, `${k.m}:tokens`, tokens, k.minute + 120), add(db, `${k.d}:tokens`, tokens, k.day + 86400 * 2)]);
    },
  };
}
export type Budget = ReturnType<typeof budget>;
