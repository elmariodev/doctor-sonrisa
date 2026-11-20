// A small D1 over Node's built-in SQLite, with the real migrations and the
// demo data of db/seed.json. Only the calls the Worker makes: prepare, bind,
// first, all and run.
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { pbkdf2Sync, randomBytes } from "node:crypto";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");

class Statement {
  constructor(private db: DatabaseSync, private sql: string, private params: SQLInputValue[] = []) {}
  bind(...params: unknown[]) {
    return new Statement(this.db, this.sql, params as SQLInputValue[]);
  }
  async first<T>() {
    return (this.db.prepare(this.sql).get(...this.params) ?? null) as T | null;
  }
  async all<T>() {
    return { success: true, results: this.db.prepare(this.sql).all(...this.params) as T[], meta: {} };
  }
  async run() {
    const r = this.db.prepare(this.sql).run(...this.params);
    return { success: true, results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
  }
}

export class TestD1 {
  readonly sqlite = new DatabaseSync(":memory:");
  prepare(sql: string) {
    return new Statement(this.sqlite, sql);
  }
}

type Seed = {
  patients: { id: string; name: string; phone: string; email: string }[];
  appointments: { patient_id: string; starts_at: string; service: string }[];
  users: { id: string; email: string; name: string; role: string; patient_id: string | null; password: string }[];
};

export const seed: Seed = JSON.parse(readFileSync(join(ROOT, "db/seed.json"), "utf8"));

// A fresh database: every migration in order, then the demo data, hashed as scripts/cli.mjs does
export function testDb() {
  const d1 = new TestD1();
  const dir = join(ROOT, "db/migrations");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    d1.sqlite.exec(readFileSync(join(dir, file), "utf8"));
  }
  const insert = (sql: string, ...values: SQLInputValue[]) => d1.sqlite.prepare(sql).run(...values);
  for (const p of seed.patients) insert("INSERT INTO patients VALUES (?, ?, ?, ?)", p.id, p.name, p.phone, p.email);
  for (const a of seed.appointments) insert("INSERT INTO appointments (patient_id, starts_at, service) VALUES (?, ?, ?)", a.patient_id, a.starts_at, a.service);
  for (const u of seed.users) {
    const salt = randomBytes(16).toString("hex");
    const hash = pbkdf2Sync(u.password, Buffer.from(salt, "hex"), 100000, 32, "sha256").toString("hex");
    insert("INSERT INTO users VALUES (?, ?, ?, ?, ?, ?, ?)", u.id, u.email, u.name, u.role, u.patient_id, salt, hash);
  }
  return d1 as unknown as D1Database;
}

export const account = (id: string) => seed.users.find((u) => u.id === id)!;

// Monday 16 November 2026, 12:00 in Bogota: the seed's appointments are ahead
export const NOW = new Date("2026-11-16T12:00:00-05:00");
