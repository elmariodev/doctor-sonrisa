// The chat log in D1: enough to read a conversation back and to see what
// the gate did with each message. No IPs: the visitor is a short hash.
export type LogEntry = {
  chatId: string; visitor: string; role: string; userId?: string;
  message: string; reply?: string; outcome: "ok" | "off_topic" | "limit" | "busy" | "upstream_rate_limit" | "error";
  tools?: string[]; sources?: string[]; usage?: { prompt: number; completion: number }; ms: number;
};

export async function visitorHash(ip: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`doctor-sonrisa:${ip}`));
  return [...new Uint8Array(d)].slice(0, 6).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function writeLog(db: D1Database, e: LogEntry) {
  await db.prepare(
    `INSERT INTO logs (at, chat_id, visitor, role, user_id, message, reply, outcome, tools, sources, prompt_tokens, completion_tokens, ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    new Date().toISOString(), e.chatId, e.visitor, e.role, e.userId || null, e.message, e.reply || null, e.outcome,
    e.tools?.length ? JSON.stringify(e.tools) : null, e.sources?.length ? JSON.stringify(e.sources) : null,
    e.usage?.prompt ?? null, e.usage?.completion ?? null, e.ms,
  ).run();
  if (Math.random() < 0.05) {
    await db.prepare("DELETE FROM logs WHERE at < ?").bind(new Date(Date.now() - 30 * 86400000).toISOString()).run();
  }
}
