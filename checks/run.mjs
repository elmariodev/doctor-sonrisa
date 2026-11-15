// Runs every check in checks/checks.json against the code as it is and
// writes devlog/evals.js (the run of this checkpoint replaces its last run).
//
//   pnpm evals --cp cp-2 [--only A1,A5] [--clip A2] [--shot A5] [--dry]
//
// --only runs some checks and does not write evals.js; --clip records a
// clip of a check and --shot keeps its picture even when it passes.
//
// Chat checks drive the real page in a browser, like a visitor. A7 looks
// for the Groq key in what the browser downloads. A6 floods the bot the
// way a script would, without cookies. Failed chat checks leave a picture
// in devlog/media/<cp>-<check>.png (1920x1080 at device scale 2).
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, rmSync, readdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { chromium } from "playwright";
import { judges } from "./judges.mjs";
import { accounts } from "./fixtures.mjs";

const BASE = "http://localhost:8787";
const ROOT = new URL("../", import.meta.url).pathname;
const MEDIA = `${ROOT}devlog/media/`;
const EVALS = `${ROOT}devlog/evals.js`;
const KEY_RE = /gsk_[A-Za-z0-9]{20,}/;

const args = Object.fromEntries(process.argv.slice(2).join(" ").split("--").filter(Boolean)
  .map((a) => { const [k, ...v] = a.trim().split(/\s+/); return [k, v.join(" ") || true]; }));
const CP = args.cp;
if (!CP || CP === true) throw new Error("Usage: pnpm evals --cp <id>");
const only = typeof args.only === "string" ? args.only.split(",") : null;
const clips = typeof args.clip === "string" ? args.clip.split(",") : [];
const shotsFor = typeof args.shot === "string" ? args.shot.split(",") : [];

const spec = JSON.parse(readFileSync(`${ROOT}checks/checks.json`, "utf8"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);

// --- server ---------------------------------------------------------------
async function up() { try { return (await fetch(BASE)).ok; } catch { return false; } }

async function startServer() {
  if (await up()) { log("Using the server already on", BASE); return null; }
  const child = spawn("pnpm", ["-s", "dev"], { cwd: ROOT, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (out += d));
  for (let i = 0; i < 120; i++) {
    if (await up()) { log("Server up"); return child; }
    await sleep(500);
  }
  process.kill(-child.pid);
  throw new Error(`The server did not start:\n${out}`);
}

// --- chat checks ----------------------------------------------------------
async function login(page, who) {
  const acc = accounts[who];
  if (!acc || !(await page.$("#login"))) return false;
  await page.fill("#email", acc.email);
  await page.fill("#password", acc.password);
  await page.click("#login button");
  await page.waitForSelector("#account:not([hidden])", { timeout: 15000 });
  return true;
}

async function ask(page, text, slow) {
  const before = await page.$$eval(".bubble.bot:not(.typing)", (b) => b.length);
  if (slow) { await page.click("#msg"); await page.keyboard.type(text, { delay: 60 }); await sleep(400); }
  else await page.fill("#msg", text);
  const t0 = Date.now();
  // What the server says besides the reply (tools used, filter, timing)
  const api = page.waitForResponse((r) => r.url().endsWith("/api/chat"), { timeout: 120000 })
    .then((r) => r.json()).catch(() => ({}));
  await page.click("#send");
  await page.waitForFunction((n) => document.querySelectorAll(".bubble.bot:not(.typing)").length > n
    && document.getElementById("chat").dataset.busy === "false", before, { timeout: 120000 });
  const last = await page.$$eval(".bubble.bot:not(.typing)", (b) => {
    const x = b[b.length - 1];
    return { text: x.textContent, error: x.dataset.error || null, retry: x.dataset.retry || "" };
  });
  const meta = await api;
  return { ...last, ms: Date.now() - t0, tools: meta.tools, filtered: meta.filtered, timing: meta.timing };
}

async function chatCheck(browser, check, { shots = true } = {}) {
  const clip = clips.includes(check.id);
  for (let attempt = 1; attempt <= 6; attempt++) {
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2, locale: "es-CO",
      ...(clip ? { recordVideo: { dir: `${MEDIA}.tmp/`, size: { width: 1920, height: 1080 } } } : {}),
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(BASE);
    const loggedIn = check.who === "invitado" ? false : await login(page, check.who);
    if (clip) await sleep(800);
    const r = await ask(page, check.text, clip);
    if (r.error === "rate" && attempt < 6) {
      const wait = Math.max(Number(r.retry) || 0, 10) * 1000 + 2000;
      log(`${check.id}: rate limited (${r.text}), retry ${attempt} in ${Math.round(wait / 1000)} s`);
      await context.close();
      await sleep(wait);
      continue;
    }
    const pass = r.error ? false : judges[check.id](r.text);
    if (clip) await sleep(2500);
    if (shots && ((!pass && !only) || shotsFor.includes(check.id))) await page.screenshot({ path: `${MEDIA}${CP}-${check.id}.png` });
    const video = clip ? page.video() : null;
    await context.close();
    if (video) {
      const tmp = await video.path();
      renameSync(tmp, `${MEDIA}${CP}-${check.id}.webm`);
      rmSync(`${MEDIA}.tmp/`, { recursive: true, force: true });
    }
    if (errors.length) log(`${check.id}: page errors`, errors);
    const result = { pass, reply: r.text, ms: r.ms };
    if (r.tools?.length) result.tools = r.tools;
    if (r.filtered) result.filtered = true;
    if (r.timing) result.timing = r.timing;
    if (check.who !== "invitado" && !loggedIn) result.note = "La página no tiene login: escribe como cualquier visitante.";
    if (r.error) result.note = `Error del chat: ${r.error}`;
    return result;
  }
}

// --- A9: one chat check many times, each in a new visitor's browser ------
async function repeatCheck(browser, check) {
  const base = spec.checks.find((c) => c.id === check.of);
  const replies = [];
  for (let i = 0; i < check.times; i++) {
    const r = await chatCheck(browser, { ...base, id: check.of }, { shots: false });
    replies.push(r);
    log(`${check.id} ${i + 1}/${check.times}: ${r.pass ? "held" : "leaked"}`);
  }
  const bad = replies.filter((r) => !r.pass);
  return {
    pass: bad.length === 0,
    reply: (bad[0] || replies[0]).reply,
    note: `${check.of} ${check.times} veces: falló ${bad.length} de ${check.times}.${bad.length ? " La respuesta de arriba es una de las que fallaron." : ""}`,
  };
}

// --- A7: the key in what the browser downloads ----------------------------
async function keyCheck(browser) {
  const html = await (await fetch(BASE)).text();
  const srcs = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => new URL(m[1], BASE).href)
    .filter((u) => u.startsWith(BASE));
  const files = [{ url: "/", body: html }];
  for (const u of srcs) files.push({ url: new URL(u).pathname, body: await (await fetch(u)).text() });
  const hit = files.find((f) => KEY_RE.test(f.body));
  if (!hit) {
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 });
    const page = await context.newPage();
    await page.goto(`view-source:${BASE}/`);
    await page.evaluate(() => {
      const line = [...document.querySelectorAll("td.line-content")].find((td) => td.textContent.includes("<script"));
      if (line) { line.scrollIntoView({ block: "center" }); line.style.background = "#d7f5e9"; }
    });
    if (!only) await page.screenshot({ path: `${MEDIA}${CP}-A7.png` });
    await context.close();
    return { pass: true, media: `media/${CP}-A7.png`, note: `Revisé ${files.map((f) => f.url).join(", ")}: no hay ninguna key de Groq.` };
  }
  const key = hit.body.match(KEY_RE)[0];
  // Picture of the page source with the key masked before the shot
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await page.goto(`view-source:${BASE}${hit.url}`);
  await page.evaluate((k) => {
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n; (n = walk.nextNode());) if (n.nodeValue.includes(k)) n.nodeValue = n.nodeValue.replace(k, "gsk_" + "•".repeat(24) + " (oculta para el video)");
    const line = [...document.querySelectorAll("td.line-content")].find((td) => td.textContent.includes("gsk_"));
    if (line) { line.scrollIntoView({ block: "center" }); line.style.background = "#fff3b0"; }
  }, key);
  const leaked = await page.evaluate(() => /gsk_[A-Za-z0-9]{20,}/.test(document.body.innerText));
  if (leaked) throw new Error("The key is still visible; no picture saved");
  if (!only) await page.screenshot({ path: `${MEDIA}${CP}-A7.png` });
  await context.close();
  return {
    pass: false, media: `media/${CP}-A7.png`,
    note: `La key está en ${hit.url === "/" ? "el HTML de la página" : hit.url}: ${key.length} caracteres que empiezan por "gsk_". Se ve con "Ver código fuente".`,
  };
}

// --- A6: 500 messages in a row, like a script -----------------------------
async function floodCheck(html) {
  const stolen = html.match(KEY_RE)?.[0];
  const total = 500, t0 = Date.now();
  let sent = 0, reached = 0, cut = 0, upstream = null, other = 0;
  for (; sent < total;) {
    sent++;
    let res, body;
    if (stolen) {
      // cp-0: the script uses the key it read from the page, straight to Groq
      res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${stolen}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "openai/gpt-oss-120b", messages: [{ role: "user", content: "Hola" }], reasoning_effort: "low", max_completion_tokens: 800 }),
      });
      body = await res.json().catch(() => ({}));
      if (res.status === 429) upstream = { at: sent, msg: body.error?.message || "" };
      else if (res.ok) reached++;
      else other++;
    } else {
      res = await fetch(`${BASE}/api/chat`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", content: "Hola" }] }),
      });
      body = await res.json().catch(() => ({}));
      if (res.ok) reached++;
      else if (body.error === "upstream_rate_limit") upstream = { at: sent, msg: body.detail || "" };
      else if (res.status === 429) cut++;
      else other++;
    }
    if (upstream) break;
    if (sent % 25 === 0) log(`A6: ${sent} sent, ${reached} reached the model, ${cut} cut`);
  }
  const s = ((Date.now() - t0) / 1000).toFixed(1);
  const which = /tokens per minute/i.test(upstream?.msg || "") ? "tokens por minuto" : /requests per minute/i.test(upstream?.msg || "") ? "peticiones por minuto" : /per day/i.test(upstream?.msg || "") ? "cuota del día" : "límite";
  const how = stolen ? "con la key que leyó de la página, directo a Groq" : "a /api/chat, sin cookies";
  if (upstream) {
    return {
      pass: false, measured: { sent, reached, cut, seconds: Number(s), limit: which },
      note: `Mandó ${sent} mensajes en ${s} s, ${how}. ${reached} llegaron al modelo y en el ${upstream.at} Groq respondió 429 (${which}): la cuota gratis se acabó y el bot dejó de responder a todos.`,
    };
  }
  return {
    pass: cut > 0 && reached + cut + other === total,
    measured: { sent, reached, cut, seconds: Number(s) },
    note: `Mandó ${sent} mensajes en ${s} s, ${how}. ${reached} llegaron al modelo; el portero cortó ${cut}${other ? ` y ${other} fallaron` : ""}. Groq nunca respondió 429.`,
  };
}

// --- main -----------------------------------------------------------------
mkdirSync(MEDIA, { recursive: true });
const server = await startServer();
const browser = await chromium.launch();
const results = {};
try {
  if (existsSync(`${ROOT}scripts/before-evals.mjs`)) await import(`${ROOT}scripts/before-evals.mjs`);
  const html = await (await fetch(BASE)).text();
  if (!only) await (async () => {
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 });
    const page = await context.newPage();
    await page.goto(BASE);
    await page.screenshot({ path: `${MEDIA}${CP}-pagina.png` });
    await context.close();
  })();
  for (const check of spec.checks) {
    if (only && !only.includes(check.id)) continue;
    log(`${check.id} ${check.text}`);
    const r = check.kind === "chat" ? await chatCheck(browser, check)
      : check.kind === "repeat" ? await repeatCheck(browser, check)
      : check.kind === "key" ? await keyCheck(browser)
      : await floodCheck(html);
    results[check.id] = r;
    log(`${check.id} ${r.pass ? "PASS" : "FAIL"}`, r.reply ? JSON.stringify(r.reply).slice(0, 300) : r.note);
  }
} finally {
  await browser.close();
  if (server) { try { process.kill(-server.pid); } catch {} }
}

if (args.dry || only) { log("Partial run: devlog/evals.js not written"); process.exit(0); }

const prev = existsSync(EVALS) ? JSON.parse(readFileSync(EVALS, "utf8").replace(/^[\s\S]*?window\.DEVLOG_EVALS = /, "").replace(/;\s*$/, "")) : { runs: [] };
const now = new Date();
const at = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Bogota", dateStyle: "short", timeStyle: "short" }).format(now);
const run = { checkpoint: CP, at, model: "openai/gpt-oss-120b", results };
const order = spec.checks.map((c) => c.id);
const runs = [...prev.runs.filter((r) => r.checkpoint !== CP), run].sort((a, b) => a.checkpoint.localeCompare(b.checkpoint));
const out = { label: spec.label, checks: spec.checks.map(({ kind, of, times, ...c }) => c), runs };
writeFileSync(EVALS, `// Written by checks/run.mjs ("pnpm evals --cp <id>"). Do not edit by hand.\nwindow.DEVLOG_EVALS = ${JSON.stringify(out, null, 2)};\n`);
log(`devlog/evals.js written: ${order.map((id) => `${id} ${results[id]?.pass ? "✓" : "✗"}`).join("  ")}`);
