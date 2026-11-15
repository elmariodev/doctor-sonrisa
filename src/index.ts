// The gate ("el portero"): the only thing that talks to Groq. It holds the
// key as a secret, reads the session cookie to know who is writing, asks
// the topic filter, and only then runs the agent with the tools of that role.
import { UpstreamRateLimit, type Message } from "./groq";
import { getSession, login, logout, sessionCookie, clearCookie } from "./auth";
import { runAgent } from "./agent";
import { onTopic, OFF_TOPIC_REPLY } from "./filter";

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
  async fetch(request: Request, env: Env): Promise<Response> {
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
      const history = readHistory(await request.json().catch(() => null));
      if (!history) return json({ error: "bad_request" }, 400);
      const session = await getSession(request, env.DB);
      try {
        const t0 = Date.now();
        const ok = await onTopic(env.GROQ_API_KEY, history);
        const filterMs = Date.now() - t0;
        if (!ok) return json({ reply: OFF_TOPIC_REPLY, filtered: true, timing: { filterMs } });
        const { reply, tools, sources, usage } = await runAgent(env, session, history);
        return json({ reply, tools, sources, usage, timing: { filterMs, agentMs: Date.now() - t0 - filterMs } });
      } catch (e) {
        if (e instanceof UpstreamRateLimit) {
          return json({ error: "upstream_rate_limit", detail: e.detail, retryAfter: e.retryAfter }, 429, { "Retry-After": String(e.retryAfter) });
        }
        console.error(e);
        return json({ error: "server" }, 500);
      }
    }

    return json({ error: "not_found" }, 404);
  },
} satisfies ExportedHandler<Env>;
