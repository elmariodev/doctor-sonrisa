// The gate ("el portero"): the only thing that talks to Groq. It holds the
// key as a secret, reads the session cookie to know who is writing, asks
// the topic filter, and only then runs the agent with the tools of that role.
// It also counts messages per visitor and Groq calls and tokens per minute
// and day, and writes every message and its outcome to the log.
import { UpstreamRateLimit, type Message } from "./groq";
import { getSession, login, logout, sessionCookie, clearCookie } from "./auth";
import { runAgent } from "./agent";
import { onTopic, OFF_TOPIC_REPLY } from "./filter";
import { countVisitor, budget, Busy } from "./limits";
import { writeLog, visitorHash, type LogEntry } from "./logs";

export interface Env {
  GROQ_API_KEY: string;
  DB: D1Database;
  AI: Ai;
  VECTORIZE: VectorizeIndex;
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

const ROLE_NAME = { guest: "invitado", user: "paciente", admin: "admin" } as const;

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const { pathname } = new URL(request.url);
    const route = `${request.method} ${pathname}`;

    if (route === "GET /api/me") {
      const s = await getSession(request, env.DB);
      return json({ role: s.role, roleName: ROLE_NAME[s.role], name: s.name || null });
    }

    if (route === "POST /api/login") {
      const body: any = await request.json().catch(() => ({}));
      if (typeof body.email !== "string" || typeof body.password !== "string") return json({ error: "bad_request" }, 400);
      const ok = await login(env.DB, body.email, body.password);
      if (!ok) return json({ error: "login", message: "Correo o contraseña incorrectos." }, 401);
      return json({ role: ok.role, roleName: ROLE_NAME[ok.role], name: ok.name }, 200, { "Set-Cookie": sessionCookie(ok.token) });
    }

    if (route === "POST /api/logout") {
      await logout(request, env.DB);
      return json({ ok: true }, 200, { "Set-Cookie": clearCookie() });
    }

    if (route === "POST /api/chat") {
      const body: any = await request.json().catch(() => null);
      const history = readHistory(body);
      if (!history) return json({ error: "bad_request" }, 400);
      const session = await getSession(request, env.DB);
      // Who is the visitor: the IP Cloudflare saw (a client cannot set it in production)
      const ip = request.headers.get("CF-Connecting-IP") || "local";
      const chatId = typeof body.chatId === "string" && /^[a-z0-9-]{8,64}$/i.test(body.chatId) ? body.chatId : crypto.randomUUID();
      const t0 = Date.now();
      // Every outcome is logged after the response is sent
      const done = (res: Response, entry: Partial<LogEntry> & { outcome: LogEntry["outcome"] }) => {
        ctx.waitUntil((async () => writeLog(env.DB, {
          chatId, visitor: await visitorHash(ip), role: session.role, userId: session.userId,
          message: history[history.length - 1].content || "", ms: Date.now() - t0, ...entry,
        }))().catch((e) => console.error("log", e)));
        return res;
      };

      const quota = await countVisitor(env.DB, ip);
      if (!quota.ok) {
        return done(json({ error: "limit", message: "Llegaste al límite de mensajes por ahora. Si necesitas algo urgente, llámanos al 601 555 0100.", retryAfter: quota.retryAfter }, 429, { "Retry-After": String(quota.retryAfter) }), { outcome: "limit" });
      }
      const spend = budget(env.DB);
      try {
        const ok = await onTopic(env.GROQ_API_KEY, history, spend);
        const filterMs = Date.now() - t0;
        if (!ok) return done(json({ reply: OFF_TOPIC_REPLY, filtered: true, chatId, timing: { filterMs } }), { outcome: "off_topic", reply: OFF_TOPIC_REPLY });
        const { reply, tools, sources, usage } = await runAgent(env, session, history, spend);
        return done(json({ reply, tools, sources, usage, chatId, timing: { filterMs, agentMs: Date.now() - t0 - filterMs } }), { outcome: "ok", reply, tools, sources, usage });
      } catch (e) {
        if (e instanceof Busy) {
          return done(json({ error: "busy", message: "Hay muchos mensajes en este momento. Intenta en un minuto.", retryAfter: e.retryAfter }, 429, { "Retry-After": String(e.retryAfter) }), { outcome: "busy" });
        }
        if (e instanceof UpstreamRateLimit) {
          return done(json({ error: "upstream_rate_limit", detail: e.detail, retryAfter: e.retryAfter }, 429, { "Retry-After": String(e.retryAfter) }), { outcome: "upstream_rate_limit" });
        }
        console.error(e);
        return done(json({ error: "server" }, 500), { outcome: "error" });
      }
    }

    return json({ error: "not_found" }, 404);
  },
} satisfies ExportedHandler<Env>;
