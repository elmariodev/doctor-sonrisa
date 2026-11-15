// The agent: gpt-oss-120b with the tools of the session's role, a few rounds at most.
import { groq, type Message } from "./groq";
import { systemPrompt } from "./prompt";
import { TOOLS, toolsFor } from "./tools";
import type { Session } from "./auth";
import type { Env } from "./index";
import type { Budget } from "./limits";

export async function runAgent(env: Env, session: Session, history: Message[], budget?: Budget) {
  const allowed = toolsFor(session.role);
  const messages: Message[] = [{ role: "system", content: systemPrompt(session) }, ...history];
  const used: string[] = [];
  const sources = new Set<string>();
  const usage = { prompt: 0, completion: 0, calls: 0 };
  for (let round = 0; round < 4; round++) {
    const data = await groq(env.GROQ_API_KEY, {
      model: "openai/gpt-oss-120b",
      messages,
      max_completion_tokens: 800,
      ...(allowed.length ? { tools: allowed.map(([, t]) => t.schema), tool_choice: "auto" } : {}),
    }, budget);
    usage.prompt += data.usage?.prompt_tokens || 0;
    usage.completion += data.usage?.completion_tokens || 0;
    usage.calls++;
    const msg = data.choices[0].message;
    if (!msg.tool_calls?.length) return { reply: msg.content || "", tools: used, sources: [...sources], usage };
    messages.push({ role: "assistant", content: msg.content || null, tool_calls: msg.tool_calls });
    for (const call of msg.tool_calls) {
      const name = call.function?.name;
      const tool = TOOLS[name];
      let result: unknown;
      // The role check lives here, in code: a tool outside the role never runs
      if (!tool || !tool.roles.includes(session.role)) result = { error: "Herramienta no disponible para este usuario." };
      else {
        let args = {};
        try { args = JSON.parse(call.function.arguments || "{}"); } catch { result = { error: "Argumentos inválidos." }; }
        result ??= await tool.run(args, { db: env.DB, session, env, sources });
      }
      used.push(name);
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }
  return { reply: "No pude completar eso. ¿Me lo dices de otra forma?", tools: used, sources: [...sources], usage };
}
