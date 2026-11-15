// The gate ("el portero"): the only thing that talks to Groq. It holds the
// key as a secret, so the browser never sees it.
import { groq, UpstreamRateLimit, type Message } from "./groq";
import { SYSTEM_PROMPT } from "./prompt";

export interface Env {
  GROQ_API_KEY: string;
}

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...headers } });

// Only plain user and assistant turns from the browser, short and few
function readHistory(body: any): Message[] | null {
  const list = body?.messages;
  if (!Array.isArray(list) || list.length === 0 || list.length > 20) return null;
  const clean = list.map((m: any) => ({ role: m?.role, content: m?.content }));
  const ok = clean.every((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.length <= 1000);
  return ok && clean[clean.length - 1].role === "user" ? clean : null;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== "/api/chat") return json({ error: "not_found" }, 404);
    if (request.method !== "POST") return json({ error: "method" }, 405);

    const history = readHistory(await request.json().catch(() => null));
    if (!history) return json({ error: "bad_request" }, 400);

    try {
      const data = await groq(env.GROQ_API_KEY, {
        model: "openai/gpt-oss-120b",
        messages: [{ role: "system", content: SYSTEM_PROMPT }, ...history],
        max_completion_tokens: 800,
      });
      return json({ reply: data.choices[0].message.content });
    } catch (e) {
      if (e instanceof UpstreamRateLimit) {
        return json({ error: "upstream_rate_limit", detail: e.detail, retryAfter: e.retryAfter }, 429, { "Retry-After": String(e.retryAfter) });
      }
      console.error(e);
      return json({ error: "server" }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
