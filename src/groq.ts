// Calls Groq's OpenAI-compatible chat API. The key never leaves the Worker.
export type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
export type Message = { role: "system" | "user" | "assistant" | "tool"; content: string | null; tool_calls?: ToolCall[]; tool_call_id?: string };

type GroqResponse = {
  choices: { message: Message }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  error?: { message?: string };
};

export class UpstreamRateLimit extends Error {
  constructor(public detail: string, public retryAfter: number) { super(detail); }
}

// Every call goes through the budget: reserved before, tokens counted after
export async function groq(key: string, body: Record<string, unknown>, budget?: { reserve(m: string): Promise<void>; spent(m: string, t: number): Promise<void> }) {
  const model = String(body.model);
  await budget?.reserve(model);
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ reasoning_effort: "low", include_reasoning: false, ...body }),
  });
  const data = await res.json<GroqResponse>().catch((): Partial<GroqResponse> => ({}));
  if (res.status === 429) throw new UpstreamRateLimit(data.error?.message || "rate limit", Number(res.headers.get("retry-after")) || 10);
  if (!res.ok) throw new Error(`Groq ${res.status}: ${data.error?.message || "error"}`);
  await budget?.spent(model, data.usage?.total_tokens || 0);
  return data as GroqResponse;
}
