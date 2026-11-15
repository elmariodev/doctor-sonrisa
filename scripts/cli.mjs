// The developer's CLI. The bot never calls it.
//
//   pnpm cli db:setup        create the local D1 tables and load the demo data
//   pnpm cli docs:load       split docs/clinica into paragraphs, embed them, store them in Vectorize
//   pnpm cli docs:search "<q>"  what the RAG finds for a question
//   pnpm cli docs:tokens     what all the documents would cost pasted in the prompt
//   pnpm cli evals --cp <id> run the checks (same as pnpm evals)
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { pbkdf2Sync, randomBytes } from "node:crypto";

const ROOT = new URL("../", import.meta.url).pathname;
const [cmd, ...rest] = process.argv.slice(2);
const wrangler = (...a) => execFileSync("pnpm", ["-s", "exec", "wrangler", ...a], { cwd: ROOT, stdio: "inherit" });
const q = (v) => (v === null || v === undefined ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);

// Same parameters as src/auth.ts: PBKDF2, SHA-256, 100000 iterations
export function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  return { salt, hash: pbkdf2Sync(password, Buffer.from(salt, "hex"), 100000, 32, "sha256").toString("hex") };
}

const EMBED_MODEL = "@cf/baai/bge-m3";
const DOCS = `${ROOT}docs/clinica/`;
const MAX_CHUNKS = 50;

// One chunk per paragraph, with the document title in front for context
function chunks() {
  const out = [];
  for (const file of readdirSync(DOCS).filter((f) => f.endsWith(".md")).sort()) {
    const text = readFileSync(DOCS + file, "utf8");
    const title = text.match(/^#\s+(.+)$/m)?.[1] || file;
    const paras = text.split(/\n\s*\n/).map((p) => p.trim()).filter((p) => p && !p.startsWith("#"));
    paras.forEach((p, i) => out.push({ id: `${file}#${i}`, doc: file, text: `${title}. ${p}` }));
  }
  return out;
}

// Cloudflare bindings from wrangler.jsonc; AI and Vectorize are remote
async function platform() {
  const { getPlatformProxy } = await import("wrangler");
  return getPlatformProxy();
}

const embed = async (env, texts) => (await env.AI.run(EMBED_MODEL, { text: texts })).data;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const commands = {
  "db:setup"() {
    const seed = JSON.parse(readFileSync(`${ROOT}db/seed.json`, "utf8"));
    const sql = ["DELETE FROM sessions;", "DELETE FROM users;", "DELETE FROM appointments;", "DELETE FROM patients;"];
    for (const p of seed.patients) sql.push(`INSERT INTO patients VALUES (${q(p.id)}, ${q(p.name)}, ${q(p.phone)}, ${q(p.email)});`);
    for (const a of seed.appointments) sql.push(`INSERT INTO appointments (patient_id, starts_at, service) VALUES (${q(a.patient_id)}, ${q(a.starts_at)}, ${q(a.service)});`);
    for (const u of seed.users) {
      const { salt, hash } = hashPassword(u.password);
      sql.push(`INSERT INTO users VALUES (${q(u.id)}, ${q(u.email)}, ${q(u.name)}, ${q(u.role)}, ${q(u.patient_id)}, ${q(salt)}, ${q(hash)});`);
    }
    mkdirSync(`${ROOT}.wrangler/tmp`, { recursive: true });
    writeFileSync(`${ROOT}.wrangler/tmp/seed.sql`, sql.join("\n") + "\n");
    wrangler("d1", "migrations", "apply", "DB", "--local");
    wrangler("d1", "execute", "DB", "--local", "--file", ".wrangler/tmp/seed.sql");
  },
  async "docs:load"() {
    const list = chunks();
    const { env, dispose } = await platform();
    try {
      const vectors = [];
      for (let i = 0; i < list.length; i += 20) {
        const batch = list.slice(i, i + 20);
        const values = await embed(env, batch.map((c) => c.text));
        batch.forEach((c, k) => vectors.push({ id: c.id, values: values[k], metadata: { doc: c.doc, text: c.text } }));
      }
      await env.VECTORIZE.upsert(vectors);
      // Paragraphs that no longer exist (a document got shorter)
      const keep = new Set(list.map((c) => c.id));
      const stale = [...new Set(list.map((c) => c.doc))].flatMap((d) => Array.from({ length: MAX_CHUNKS }, (_, i) => `${d}#${i}`)).filter((id) => !keep.has(id));
      for (let i = 0; i < stale.length; i += 100) await env.VECTORIZE.deleteByIds(stale.slice(i, i + 100));
      console.log(`${vectors.length} paragraphs from ${new Set(list.map((c) => c.doc)).size} documents sent to Vectorize. Waiting until they show up in searches...`);
      const t0 = Date.now();
      const last = vectors[vectors.length - 1];
      for (;;) {
        const res = await env.VECTORIZE.query(last.values, { topK: 1 });
        if (res.matches[0]?.id === last.id) break;
        if (Date.now() - t0 > 180000) throw new Error("Not searchable after 3 minutes");
        await sleep(5000);
      }
      console.log(`Searchable after ${Math.round((Date.now() - t0) / 1000)} s.`);
    } finally { await dispose(); }
  },
  async "docs:search"() {
    const q = rest.join(" ");
    const { env, dispose } = await platform();
    try {
      const [values] = await embed(env, [q]);
      const res = await env.VECTORIZE.query(values, { topK: 3, returnMetadata: "all" });
      console.log(`"${q}"`);
      for (const m of res.matches) console.log(`  ${m.score.toFixed(3)}  ${m.metadata.doc}  ${m.metadata.text.slice(0, 110)}...`);
    } finally { await dispose(); }
  },
  async "docs:tokens"() {
    // One real call to Groq with every document pasted in the system prompt; prompt_tokens is the answer
    const key = readFileSync(`${ROOT}.dev.vars`, "utf8").match(/^GROQ_API_KEY=(.+)$/m)[1].trim().replace(/^["']|["']$/g, "");
    const all = chunks().map((c) => c.text).join("\n\n");
    const call = async (system) => (await (await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "openai/gpt-oss-120b", messages: [{ role: "system", content: system }, { role: "user", content: "Hola" }], max_completion_tokens: 1 }),
    })).json()).usage.prompt_tokens;
    const base = await call("Eres el asistente de un consultorio dental.");
    const full = await call(`Eres el asistente de un consultorio dental.\n\n${all}`);
    console.log(JSON.stringify({ documents: full - base, paragraphs: chunks().length }));
  },
  evals() {
    execFileSync("node", ["checks/run.mjs", ...rest], { cwd: ROOT, stdio: "inherit" });
  },
};

if (!commands[cmd]) {
  console.log(`Commands: ${Object.keys(commands).join(", ")}`);
  process.exit(cmd ? 1 : 0);
}
await commands[cmd]();
