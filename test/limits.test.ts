import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Busy, LIMITS, budget, countLogin, countVisitor } from "../src/limits";
import { groq } from "../src/groq";
import { NOW, testDb } from "./d1";

describe("limits", () => {
  let db: D1Database;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    db = testDb();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("allows 15 chat messages per visitor an hour, then says no", async () => {
    expect(LIMITS.perVisitor).toEqual({ messages: 15, windowSec: 3600 });
    for (let i = 0; i < 15; i++) expect((await countVisitor(db, "1.2.3.4")).ok).toBe(true);
    const over = await countVisitor(db, "1.2.3.4");
    expect(over.ok).toBe(false);
    expect(over.retryAfter).toBeGreaterThan(0);
    expect(over.retryAfter).toBeLessThanOrEqual(3600);
    // Another visitor has its own count
    expect((await countVisitor(db, "5.6.7.8")).ok).toBe(true);
  });

  it("starts a new count in the next window", async () => {
    for (let i = 0; i < 16; i++) await countVisitor(db, "1.2.3.4");
    vi.setSystemTime(NOW.getTime() + 3600 * 1000);
    expect((await countVisitor(db, "1.2.3.4")).ok).toBe(true);
  });

  it("allows 10 login attempts per visitor in 15 minutes, then says no", async () => {
    expect(LIMITS.loginAttempts).toEqual({ attempts: 10, windowSec: 900 });
    for (let i = 0; i < 10; i++) expect((await countLogin(db, "1.2.3.4")).ok).toBe(true);
    expect((await countLogin(db, "1.2.3.4")).ok).toBe(false);
    // Login attempts and chat messages are counted apart
    expect((await countVisitor(db, "1.2.3.4")).ok).toBe(true);
  });

  it("refuses Groq calls past the per-minute budget of each model", async () => {
    const spend = budget(db);
    for (let i = 0; i < LIMITS.perMinute.calls; i++) await spend.reserve("openai/gpt-oss-120b");
    await expect(spend.reserve("openai/gpt-oss-120b")).rejects.toBeInstanceOf(Busy);
    // The filter model has its own budget
    await expect(spend.reserve("openai/gpt-oss-20b")).resolves.toBeUndefined();
  });

  it("refuses Groq calls once the minute's tokens are spent", async () => {
    const spend = budget(db);
    await spend.spent("openai/gpt-oss-120b", LIMITS.perMinute.tokens);
    await expect(spend.reserve("openai/gpt-oss-120b")).rejects.toBeInstanceOf(Busy);
  });

  it("never calls Groq when the budget says no", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const spend = budget(db);
    for (let i = 0; i < LIMITS.perMinute.calls; i++) await spend.reserve("openai/gpt-oss-120b");
    await expect(groq("test-key", { model: "openai/gpt-oss-120b", messages: [] }, spend)).rejects.toBeInstanceOf(Busy);
    expect(fetch).not.toHaveBeenCalled();
  });
});
