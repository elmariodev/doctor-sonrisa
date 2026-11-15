// Run by checks/run.mjs before the checks: the demo data is loaded again
// and the counters start at zero, so each run starts from the same state.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

const root = new URL("../", import.meta.url).pathname;
if (existsSync(`${root}db/migrations`)) {
  execFileSync("pnpm", ["-s", "cli", "db:setup"], { cwd: root, stdio: "ignore" });
  if (existsSync(`${root}db/migrations/0002_limits.sql`)) {
    execFileSync("pnpm", ["-s", "exec", "wrangler", "d1", "execute", "DB", "--local", "--command", "DELETE FROM counters"], { cwd: root, stdio: "ignore" });
  }
}
