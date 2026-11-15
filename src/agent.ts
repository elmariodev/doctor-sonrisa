// The agent: gpt-oss-120b with the tools of the session's role, a few rounds at most.
import { groq, type Message } from "./groq";
import { systemPrompt } from "./prompt";
import { TOOLS, toolsFor } from "./tools";
import type { Session } from "./auth";

export async function runAgent(key: string, db: D1Database, session: Session, history: Message[]) {
  const allowed = toolsFor(session.role);
  const messages: Message[] = [{ role: "system", content: systemPrompt(session) }, ...history];
  const used: string[] = [];
  for (let round = 0; round < 4; round++) {
    const data = await groq(key, {
      model: "openai/gpt-oss-120b",
      messages,
      max_completion_tokens: 800,
      ...(allowed.length ? { tools: allowed.map(([, t]) => t.schema), tool_choice: "auto" } : {}),
    });
    const msg = data.choices[0].message;
    if (!msg.tool_calls?.length) return { reply: msg.content || "", tools: used };
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
        result ??= await tool.run(args, { db, session });
      }
      used.push(name);
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }
  return { reply: "No pude completar eso. ¿Me lo dices de otra forma?", tools: used };
}
