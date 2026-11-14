// Devlog of the Doctor Sonrisa bot (video 07). The build agent fills it at
// each checkpoint. Shape:
// - project: tab (its name on the tab, short), name, kicker, oneLine (the
//   idea in one line), repo, stack
//   (each piece with its role, a note such as its free limit, and its
//   source), url (optional: shown in the fake browser around a chat).
// - chapters: how the video groups the checkpoints; each names its ids.
// - checkpoints: one per step, in order. status is "done", "now" or "todo".
//   goal: one sentence. built: what this layer added. broke: what failed,
//   with the check id that showed it. fixed: how, with the files and the
//   few lines of code that show it. media: screenshots and clips in media/.
//   numbers: each with its source (an eval run or a URL).
//   decisions: ids from the list below. build: who built it, one row per
//   model, as printed by scripts/session-usage.py (model, harness, seconds,
//   tokensIn, tokensOut, toolCalls, apiCostUsd, source).
//   hero: the check whose evidence opens the tab.
// - decisions: id, date, by ("Mario" or "agente"), text, why. status "open"
//   is a question waiting for Mario; the page does not show it.
// Everything here is shown to the audience. Mario's lines for camera go in
// script-notes.md, never here.
// - runbook: the commands to run it, label and cmd.
// The check results do not go here: the evals script writes evals.js.
window.DEVLOG = {
  project: {
    tab: "Agente",
    name: "Doctor Sonrisa",
    kicker: "Video 07",
    oneLine: "Un bot que solo tiene un prompt se rompe en 30 segundos. Este se construye por capas, gratis.",
    repo: "~/Development/Claude/videos/07-doctor-sonrisa (public later: github.com/elmariodev/doctor-sonrisa)",
    url: "doctorsonrisa.example",
    stack: [
      { name: "Groq · gpt-oss-120b", role: "El agente", note: "30 req/min · 8K tokens/min", source: "console.groq.com/settings/limits" },
      { name: "Groq · gpt-oss-20b", role: "El filtro de tema", note: "30 req/min · 8K tokens/min", source: "console.groq.com/settings/limits" },
      { name: "Cloudflare Workers", role: "El portero (/api/chat)", note: "100.000 peticiones/día", source: "developers.cloudflare.com/workers/platform/pricing/" },
      { name: "Workers AI · bge-m3", role: "Embeddings del RAG", note: "10.000 neurons/día", source: "developers.cloudflare.com/workers-ai/platform/pricing/" },
      { name: "Vectorize", role: "Índice del RAG", note: "30M dimensiones consultadas/mes", source: "developers.cloudflare.com/vectorize/platform/pricing/" },
      { name: "D1", role: "Citas, sesiones y logs", note: "5M filas leídas/día", source: "developers.cloudflare.com/d1/platform/pricing/" },
    ],
  },
  chapters: [
    { n: 1, title: "El bot roto", checkpoints: ["cp-0"] },
    { n: 2, title: "El portero", checkpoints: ["cp-1", "cp-2"] },
    { n: 3, title: "Que no se salga del tema ni invente", checkpoints: ["cp-3", "cp-4"] },
    { n: 4, title: "Que no lo revienten, y cómo sabes que funciona", checkpoints: ["cp-5", "cp-6", "cp-7"] },
  ],
  checkpoints: [
    { id: "cp-0", title: "El bot roto", status: "todo", goal: "El bot como lo hace casi todo el mundo: un prompt con todo adentro.", built: [], broke: [], fixed: [], media: [], numbers: [], decisions: [], build: [] },
    { id: "cp-1", title: "El portero", status: "todo", goal: "Mover la llamada al modelo a un servidor que el navegador no ve.", built: [], broke: [], fixed: [], media: [], numbers: [], decisions: [], build: [] },
    { id: "cp-2", title: "Login y roles", status: "todo", goal: "Que el servidor sepa quién escribe, y le dé al modelo solo las herramientas de su rol.", built: [], broke: [], fixed: [], media: [], numbers: [], decisions: [], build: [] },
    { id: "cp-3", title: "Filtro de tema", status: "todo", goal: "Un modelo chico revisa cada mensaje antes del agente y dice sí o no.", built: [], broke: [], fixed: [], media: [], numbers: [], decisions: [], build: [] },
    { id: "cp-4", title: "RAG", status: "todo", goal: "Que responda con los documentos de la clínica, no de memoria.", built: [], broke: [], fixed: [], media: [], numbers: [], decisions: [], build: [] },
    { id: "cp-5", title: "Límite de mensajes", status: "todo", goal: "Un tope de mensajes por visitante.", built: [], broke: [], fixed: [], media: [], numbers: [], decisions: [], build: [] },
    { id: "cp-6", title: "Evals", status: "todo", goal: "Todos los ataques, pasa o falla, en una corrida.", built: [], broke: [], fixed: [], media: [], numbers: [], decisions: [], build: [] },
    { id: "cp-7", title: "Logs y ZDR", status: "todo", goal: "Ver qué pasó en cada chat, sin que el proveedor guarde nada.", built: [], broke: [], fixed: [], media: [], numbers: [], decisions: [], build: [] },
  ],
  decisions: [
    { id: "D001", date: "2026-11-14", by: "Mario", text: "Un consultorio dental ficticio, Doctor Sonrisa, con chat en su web.", why: "Un negocio que todos entienden, con datos privados de verdad (citas)." },
    { id: "D002", date: "2026-11-14", by: "Mario", text: "Solo Groq, plan gratis, con ZDR.", why: "Gratis y no entrena con lo que le mandas." },
    { id: "D003", date: "2026-11-14", by: "Mario", text: "Tres roles: invitado, paciente y admin.", why: "El ataque 'dame las citas de tal persona' solo se para con roles." },
    { id: "D004", date: "2026-11-14", by: "Mario", text: "RAG con bge-m3 de Workers AI y un índice de Vectorize.", why: "Groq no tiene modelos de embeddings, y Cloudflare no entrena con lo que procesa." },
  ],
  runbook: [],
};
