// The chat widget. It only talks to our own server (/api/chat): no key,
// no prompt and no patient data in the browser.
const history = [];
const chat = document.getElementById("chat");
const msgs = document.getElementById("msgs");
const input = document.getElementById("msg");

// Escape the text, then show **bold** as bold (the model writes Markdown)
const render = (text) => text
  .replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]))
  .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");

function bubble(text, who, extra = {}) {
  const b = document.createElement("div");
  b.className = `bubble ${who}`;
  b.innerHTML = render(text);
  for (const [k, v] of Object.entries(extra)) b.dataset[k] = v;
  msgs.appendChild(b);
  msgs.scrollTop = msgs.scrollHeight;
  return b;
}

document.getElementById("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text || chat.dataset.busy === "true") return;
  input.value = "";
  bubble(text, "user");
  history.push({ role: "user", content: text });
  chat.dataset.busy = "true";
  const typing = bubble("Escribiendo...", "bot typing");
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: history.slice(-20) }),
    });
    const data = await res.json().catch(() => ({}));
    typing.remove();
    if (res.ok) {
      history.push({ role: "assistant", content: data.reply });
      bubble(data.reply, "bot");
      if (data.sources?.length) {
        const src = document.createElement("div");
        src.className = "sources";
        src.textContent = `Fuente: ${data.sources.join(", ")}`;
        msgs.appendChild(src);
      }
    } else {
      history.pop();
      if (res.status === 429) bubble(data.message || "Hay muchos mensajes en este momento. Intenta en un minuto.", "bot", { error: data.error === "upstream_rate_limit" ? "rate" : "limit", retry: data.retryAfter || "" });
      else bubble("Algo falló. Intenta de nuevo.", "bot", { error: "server" });
    }
  } catch {
    typing.remove();
    history.pop();
    bubble("No hay conexión. Intenta de nuevo.", "bot", { error: "network" });
  }
  chat.dataset.busy = "false";
  input.focus();
});
