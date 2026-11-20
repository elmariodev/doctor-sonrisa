import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSession, login, logout } from "../src/auth";
import { NOW, account, testDb } from "./d1";

const withCookie = (token?: string) =>
  new Request("http://localhost/api/me", token ? { headers: { Cookie: `other=1; ds_session=${token}` } } : {});

const sha256 = async (s: string) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join("");

describe("auth", () => {
  let db: D1Database;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    db = testDb();
  });
  afterEach(() => vi.useRealTimers());

  it("logs in with a seed account, ignoring case and spaces in the email", async () => {
    const u = account("u-valentina");
    const ok = await login(db, `  ${u.email.toUpperCase()} `, u.password);
    expect(ok).toMatchObject({ name: u.name, role: "user" });
    expect(ok!.token).toMatch(/^[0-9a-f]{64}$/);
  });

  it("refuses a wrong password and an unknown email", async () => {
    const u = account("u-valentina");
    expect(await login(db, u.email, "wrong-password")).toBeNull();
    expect(await login(db, "nadie@ejemplo.test", u.password)).toBeNull();
  });

  it("stores only a hash of the session token", async () => {
    const u = account("u-juan");
    const { token } = (await login(db, u.email, u.password))!;
    const rows = (await db.prepare("SELECT token_hash FROM sessions").all<{ token_hash: string }>()).results;
    expect(rows).toEqual([{ token_hash: await sha256(token) }]);
  });

  it("maps a session cookie to the role and patient of its account", async () => {
    const patient = account("u-valentina");
    const admin = account("u-doctora");
    const p = (await login(db, patient.email, patient.password))!;
    const a = (await login(db, admin.email, admin.password))!;
    expect(await getSession(withCookie(p.token), db)).toEqual({ role: "user", userId: "u-valentina", name: patient.name, patientId: "p-002" });
    expect(await getSession(withCookie(a.token), db)).toEqual({ role: "admin", userId: "u-doctora", name: admin.name, patientId: null });
  });

  it("treats no cookie, an unknown token and an expired session as a guest", async () => {
    expect(await getSession(withCookie(), db)).toEqual({ role: "guest" });
    expect(await getSession(withCookie("f".repeat(64)), db)).toEqual({ role: "guest" });

    const u = account("u-juan");
    const { token } = (await login(db, u.email, u.password))!;
    vi.setSystemTime(NOW.getTime() + 8 * 24 * 60 * 60 * 1000); // sessions last 7 days
    expect(await getSession(withCookie(token), db)).toEqual({ role: "guest" });
  });

  it("logs out by deleting the session", async () => {
    const u = account("u-juan");
    const { token } = (await login(db, u.email, u.password))!;
    await logout(withCookie(token), db);
    expect(await getSession(withCookie(token), db)).toEqual({ role: "guest" });
  });
});
