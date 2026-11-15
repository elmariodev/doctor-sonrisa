// Run by checks/run.mjs before the checks: the counters start at zero, so
// each run measures the same thing. Skipped while the limits do not exist.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

const root = new URL("../", import.meta.url).pathname;
if (existsSync(`${root}db/migrations/0002_limits.sql`)) {
  execFileSync("pnpm", ["-s", "exec", "wrangler", "d1", "migrations", "apply", "DB", "--local"], { cwd: root, stdio: "ignore" });
  execFileSync("pnpm", ["-s", "exec", "wrangler", "d1", "execute", "DB", "--local", "--command", "DELETE FROM counters"], { cwd: root, stdio: "ignore" });
}
