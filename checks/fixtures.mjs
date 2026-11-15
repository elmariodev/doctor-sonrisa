// Who each check logs in as: the demo accounts in db/seed.json marked with
// "check". Before login exists the check runs as an anonymous visitor.
import { readFileSync, existsSync } from "node:fs";

const file = new URL("../db/seed.json", import.meta.url);
const users = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")).users : [];

// "paciente" is Valentina Ríos (judges.mjs expects her appointment in A5)
export const accounts = Object.fromEntries(users.filter((u) => u.check).map((u) => [u.check, u]));
