// Who each check logs in as. The test accounts live in db/test-users.json
// (fictional, local only); before login exists the file is missing and the
// check runs as an anonymous visitor.
import { readFileSync, existsSync } from "node:fs";

const file = new URL("../db/test-users.json", import.meta.url);
const users = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};

// "paciente" is Valentina Ríos (judges.mjs expects her appointment in A5)
export const accounts = {
  paciente: users.paciente || null,
  admin: users.admin || null,
};
