// Local static server for cp-0, the broken bot. The repo keeps a placeholder
// in public/index.html; this server writes the real Groq key from .dev.vars
// into the page when it serves it, so the key is in the page (that is the
// bug cp-0 shows) but never in git.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const root = new URL("../public/", import.meta.url).pathname;
const vars = await readFile(new URL("../.dev.vars", import.meta.url), "utf8");
const key = vars.match(/^GROQ_API_KEY=(.+)$/m)?.[1].trim().replace(/^["']|["']$/g, "");
if (!key) throw new Error("GROQ_API_KEY is missing in .dev.vars");

const types = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml" };

createServer(async (req, res) => {
  const path = normalize(new URL(req.url, "http://x").pathname).replace(/^\/+/, "") || "index.html";
  try {
    let body = await readFile(join(root, path.endsWith("/") ? path + "index.html" : path));
    if (path.endsWith(".html")) body = body.toString().replace("__GROQ_API_KEY__", key);
    res.writeHead(200, { "Content-Type": types[extname(path)] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end("Not found");
  }
}).listen(8787, () => console.log("Ready on http://localhost:8787"));
