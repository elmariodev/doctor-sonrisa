// Who is writing comes from the session cookie, never from the message.
export type Role = "guest" | "user" | "admin";
export type Session = { role: Role; userId?: string; name?: string; patientId?: string | null };

const COOKIE = "ds_session";
const DAY = 24 * 60 * 60;
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const fromHex = (s: string) => new Uint8Array(s.match(/../g)!.map((h) => parseInt(h, 16)));
const sha256 = async (s: string) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));

// PBKDF2, SHA-256, 100000 iterations (the most Workers allows); scripts/cli.mjs uses the same
async function hashPassword(password: string, salt: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  return hex(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: fromHex(salt), iterations: 100000 }, key, 256));
}

function sameText(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function readCookie(request: Request) {
  const header = request.headers.get("Cookie") || "";
  return header.split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1) || null;
}

export async function getSession(request: Request, db: D1Database): Promise<Session> {
  const token = readCookie(request);
  if (!token) return { role: "guest" };
  const row = await db.prepare(
    `SELECT u.id, u.name, u.role, u.patient_id FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ?`,
  ).bind(await sha256(token), Math.floor(Date.now() / 1000)).first<{ id: string; name: string; role: Role; patient_id: string | null }>();
  return row ? { role: row.role, userId: row.id, name: row.name, patientId: row.patient_id } : { role: "guest" };
}

export async function login(db: D1Database, email: string, password: string) {
  const user = await db.prepare("SELECT id, name, role, password_salt, password_hash FROM users WHERE email = ?")
    .bind(email.trim().toLowerCase()).first<{ id: string; name: string; role: Role; password_salt: string; password_hash: string }>();
  // Hash even when the user does not exist, so both cases take the same time
  const hash = await hashPassword(password, user?.password_salt || "00".repeat(16));
  if (!user || !sameText(hash, user.password_hash)) return null;
  const token = hex(crypto.getRandomValues(new Uint8Array(32)).buffer);
  await db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(await sha256(token), user.id, Math.floor(Date.now() / 1000) + 7 * DAY).run();
  return { token, name: user.name, role: user.role };
}

export async function logout(request: Request, db: D1Database) {
  const token = readCookie(request);
  if (token) await db.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(token)).run();
}

export const sessionCookie = (token: string) => `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${7 * DAY}`;
export const clearCookie = () => `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
