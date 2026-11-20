# Doctor Sonrisa

A website chat for a fictional dental clinic on Cloudflare Workers and
Groq, built in layers so it cannot be broken, on free tiers only. The
README explains what it does and how to run it; this file is for whoever
changes the code.

## Where things are

- `src/index.ts`: the gate, the only code that talks to Groq. Order per
  message: session -> limits -> topic filter -> agent -> log.
- `src/auth.ts`: login, PBKDF2 passwords and sessions in D1.
- `src/limits.ts`: messages per visitor, login attempts and the Groq budget
  per minute and day.
- `src/filter.ts`: the topic filter (`openai/gpt-oss-20b`, JSON yes or no).
- `src/agent.ts`, `src/prompt.ts`, `src/tools.ts`: the agent
  (`openai/gpt-oss-120b`) and the tools of each role.
- `src/rag.ts`: search over `docs/clinica` in Vectorize (`@cf/baai/bge-m3`).
- `src/logs.ts`: one row per message in D1.
- `src/groq.ts`: the Groq client; `src/clock.ts`: the clinic's date and time.
- `public/`: the clinic's page and the chat (static assets).
- `db/migrations/`, `db/seed.json`: tables and fictional demo data.
- `scripts/cli.mjs`: the developer CLI (`pnpm cli ...`). The bot never calls it.
- `test/`: the key-free tests (`pnpm test`), on a D1 over `node:sqlite`
  (`test/d1.ts`) with Groq mocked.
- `checks/`: the attacks (`checks.json`), their rules (`judges.mjs`) and
  the runner (`run.mjs`, `pnpm evals`).
- `devlog/`: the page that tells how each layer was built, in Spanish.

## Rules

- The model never decides who the user is. The role comes from the
  session cookie; data tools take the patient id from the session, never
  from the model's arguments; a tool outside the role never runs.
- Patient data never goes in the prompt or in the RAG index.
- If the filter fails or answers something unexpected, the message does not pass.
- Secrets go in `.dev.vars` (git-ignored) or `wrangler secret put`, never in
  a tracked file, a screenshot or a clip.
- Fictional data only: no real names, phones or emails.
- pnpm only, exact versions (`savePrefix: ""` in `pnpm-workspace.yaml`).
- English in code, comments, docs and commits. What the visitor reads (the
  page, the bot's replies, `docs/clinica`) and the devlog are in Spanish.

## Changing behavior

- A new way to break the bot gets a check in `checks/checks.json` and its
  rule in `checks/judges.mjs` before the fix.
- `pnpm typecheck` and `pnpm test` need no key or login, and CI runs them.
  A change to a rule gets a test there too. After changing `wrangler.jsonc`,
  run `pnpm cf-typegen`.
- `pnpm evals --cp <tag>` calls Groq for real and spends quota. It also
  rewrites `devlog/evals.js` and pictures in `devlog/media/`; use `--only`
  to run some checks without writing them.
- Git tags `cp-0` to `cp-7` are the layers. Do not move them. `cp-0` puts
  the API key in the page on purpose: never deploy it.
