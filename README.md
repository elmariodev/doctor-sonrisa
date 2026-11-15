# Doctor Sonrisa

A website chat for a fictional dental clinic, built in layers so it cannot
be broken, on free tiers only. It answers visitors from the clinic's own
documents, shows logged-in patients their own appointments and nothing
else, refuses off-topic work, and stops before anyone spends the free
quota.

Every layer is a git tag, from `cp-0` (the broken bot) to `cp-7`. The
attacks that each layer fixes are in `checks/checks.json`, and the devlog
in `devlog/index.html` shows what broke and how it was fixed.

> `cp-0` puts the API key in the page on purpose, to show the problem.
> Never deploy `cp-0`, and revoke any key you used with it.

## How it works

```
browser ── /api/chat ──> Worker ("the gate")
                          1. who is it?        session cookie -> guest, user or admin
                          2. too many?         15 messages/hour per IP, Groq budget per minute and day
                          3. on topic?         gpt-oss-20b answers {"en_tema": true|false}
                          4. agent             gpt-oss-120b with the tools of that role only
                                                 info_negocio    everyone   RAG over docs/clinica
                                                 mis_citas       user       patient id from the session
                                                 agendar         user       patient id from the session
                                                 buscar_paciente admin
                          5. log               D1, one row per message
```

The model never decides who you are. Data tools take no patient id from
the model, and a tool outside the role never runs.

## Stack and free limits

| Piece | Role | Free limit |
| --- | --- | --- |
| Groq `openai/gpt-oss-120b` | Agent | 30 requests and 8,000 tokens a minute, 1,000 requests and 200,000 tokens a day |
| Groq `openai/gpt-oss-20b` | Topic filter | same as above, counted apart |
| Cloudflare Workers | The gate | 100,000 requests a day |
| Workers AI `@cf/baai/bge-m3` | Embeddings | 10,000 neurons a day |
| Vectorize | RAG index | 30M queried dimensions a month |
| D1 | Patients, appointments, sessions, counters, logs | 5M rows read a day |

Groq limits are from the free plan's limits page and may change. The gate's
budget (`src/limits.ts`) stays a little below them.

## Run it locally

Needs Node, pnpm and a Cloudflare account (free) for Workers AI and
Vectorize, which run remotely even in development.

```bash
pnpm install
cp .dev.vars.example .dev.vars        # put your Groq key here
pnpm exec wrangler login
pnpm exec wrangler vectorize create doctor-sonrisa --dimensions=1024 --metric=cosine
pnpm cli db:setup                     # local D1 tables and demo data
pnpm cli docs:load                    # docs/clinica -> Vectorize
pnpm dev                              # http://localhost:8787
pnpm evals --cp cp-7                  # run every attack, writes devlog/evals.js
```

Demo accounts are in `db/seed.json` (fictional data, test passwords).

Developer CLI (the bot never calls it):

| Command | What it does |
| --- | --- |
| `pnpm cli db:setup [--remote]` | Create the tables and load the demo data |
| `pnpm cli docs:load` | Split the documents into paragraphs, embed them, store them |
| `pnpm cli docs:search "<question>"` | What the RAG finds for a question |
| `pnpm cli docs:tokens` | What all documents would cost pasted in the prompt |
| `pnpm cli logs [--chat <id>] [--last N]` | Read conversations from the log |

## Deploy on free tiers

```bash
pnpm exec wrangler d1 create doctor-sonrisa     # paste its id in wrangler.jsonc
pnpm cli db:setup --remote                      # then replace the demo accounts
pnpm exec wrangler secret put GROQ_API_KEY
pnpm exec wrangler deploy
```

Before real use:

- Replace the demo patients and accounts in `db/seed.json` with your own
  process for creating accounts. Do not keep test passwords.
- Turn on Zero Data Retention in the Groq console (Settings, Data
  Controls), so Groq keeps no copy of what patients write.
- The per-visitor limit trusts `CF-Connecting-IP`, which Cloudflare sets in
  production. Do not put another proxy in front without changing that.
- Logs keep messages for 30 days. Patients' messages are personal data: say
  so in your privacy notice.

## Make it yours

- Clinic facts: edit `docs/clinica/*.md` and run `pnpm cli docs:load`.
- What the bot is allowed to talk about: `src/filter.ts`.
- Roles and tools: `src/tools.ts`.
- Limits: `src/limits.ts`.
- Attacks: add one to `checks/checks.json` and its rule to `checks/judges.mjs`.
