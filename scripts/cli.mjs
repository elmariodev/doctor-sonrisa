// The developer's CLI. The bot never calls it.
//
//   pnpm cli db:setup        create the local D1 tables and load the demo data
//   pnpm cli evals --cp <id> run the checks (same as pnpm evals)
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
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
  evals() {
    execFileSync("node", ["checks/run.mjs", ...rest], { cwd: ROOT, stdio: "inherit" });
  },
};

if (!commands[cmd]) {
  console.log(`Commands: ${Object.keys(commands).join(", ")}`);
  process.exit(cmd ? 1 : 0);
}
await commands[cmd]();
