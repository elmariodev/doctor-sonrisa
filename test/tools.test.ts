import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TOOLS, toolsFor, type ToolContext } from "../src/tools";
import { runAgent } from "../src/agent";
import type { Session } from "../src/auth";
import type { Env } from "../src/index";
import { NOW, testDb } from "./d1";

const juan: Session = { role: "user", userId: "u-juan", name: "Juan Pérez", patientId: "p-001" };
const valentina: Session = { role: "user", userId: "u-valentina", name: "Valentina Ríos", patientId: "p-002" };
const noPatient: Session = { role: "user", userId: "u-x", name: "Sin Paciente", patientId: null };

const run = (name: string, args: Record<string, unknown>, ctx: ToolContext) => TOOLS[name]!.run(args, ctx);

describe("tools", () => {
  let db: D1Database;
  const ctx = (session: Session): ToolContext => ({ db, session, env: {} as ToolContext["env"], sources: new Set() });
  const appointments = async () =>
    (await db.prepare("SELECT patient_id, starts_at, service FROM appointments WHERE starts_at = ?").bind("2026-11-23T10:00").all()).results;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    db = testDb();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("gives each role only its tools", () => {
    const names = (s: Session["role"]) => toolsFor(s).map(([name]) => name).sort();
    expect(names("guest")).toEqual(["info_negocio"]);
    expect(names("user")).toEqual(["agendar", "info_negocio", "mis_citas"]);
    expect(names("admin")).toEqual(["buscar_paciente", "info_negocio"]);
  });

  it("mis_citas shows the session's patient, whatever id the model sends", async () => {
    const result = await run("mis_citas", { patient_id: "p-002", paciente: "Valentina Ríos" }, ctx(juan));
    expect(result).toEqual({
      paciente: "Juan Pérez",
      citas: [
        { cuando: "miércoles, 18 de noviembre de 2026, 10:30", servicio: "limpieza" },
        { cuando: "miércoles, 2 de diciembre de 2026, 16:00", servicio: "resina" },
      ],
    });
  });

  it("agendar books for the session's patient, whatever id the model sends", async () => {
    const result = await run("agendar", { fecha_hora: "2026-11-23T10:00", servicio: "limpieza", patient_id: "p-002" }, ctx(juan));
    expect(result).toMatchObject({ ok: true, cita: { servicio: "limpieza" } });
    expect(await appointments()).toEqual([{ patient_id: "p-001", starts_at: "2026-11-23T10:00", service: "limpieza" }]);
  });

  it.each([
    ["a Sunday", "2026-11-22T10:00"],
    ["after closing on a weekday", "2026-11-23T18:00"],
    ["before opening on a weekday", "2026-11-23T07:30"],
    ["after closing on a Saturday", "2026-11-21T13:00"],
    ["not on the hour or half hour", "2026-11-23T10:15"],
    ["a malformed date", "lunes a las 10"],
    ["a number", 202611231000],
  ])("agendar refuses %s", async (_, fecha_hora) => {
    expect(await run("agendar", { fecha_hora, servicio: "limpieza" }, ctx(juan))).toEqual({ error: "Esa hora no está dentro del horario (en punto o y media)." });
  });

  it("agendar refuses a past date", async () => {
    expect(await run("agendar", { fecha_hora: "2026-11-13T10:00", servicio: "limpieza" }, ctx(juan))).toEqual({ error: "Esa fecha ya pasó." });
    expect(await run("agendar", { fecha_hora: "2026-11-16T11:30", servicio: "limpieza" }, ctx(juan))).toEqual({ error: "Esa fecha ya pasó." });
  });

  it("agendar refuses a service the clinic does not offer", async () => {
    for (const servicio of ["cirugía estética", "", 3, undefined]) {
      expect(await run("agendar", { fecha_hora: "2026-11-23T10:00", servicio }, ctx(juan))).toEqual({ error: "Ese servicio no existe." });
    }
  });

  it("agendar refuses a slot that is already booked (the unique index)", async () => {
    expect(await run("agendar", { fecha_hora: "2026-11-23T10:00", servicio: "limpieza" }, ctx(juan))).toMatchObject({ ok: true });
    expect(await run("agendar", { fecha_hora: "2026-11-23T10:00", servicio: "resina" }, ctx(valentina))).toEqual({ error: "Esa hora ya está ocupada. Ofrece otra." });
    expect(await appointments()).toHaveLength(1);
  });

  it("frees the slot when the appointment is no longer confirmed", async () => {
    await run("agendar", { fecha_hora: "2026-11-23T10:00", servicio: "limpieza" }, ctx(juan));
    await db.prepare("UPDATE appointments SET status = 'cancelada' WHERE starts_at = ?").bind("2026-11-23T10:00").run();
    expect(await run("agendar", { fecha_hora: "2026-11-23T10:00", servicio: "resina" }, ctx(valentina))).toMatchObject({ ok: true });
  });

  it("gives an error to an account without a patient", async () => {
    const error = { error: "Esta cuenta no tiene un paciente asociado." };
    expect(await run("mis_citas", {}, ctx(noPatient))).toEqual(error);
    expect(await run("agendar", { fecha_hora: "2026-11-23T10:00", servicio: "limpieza" }, ctx(noPatient))).toEqual(error);
    expect(await appointments()).toHaveLength(0);
  });

  it("never runs a tool outside the role, even if the model calls it", async () => {
    // Groq answers first with a call to the admin's tool, then with plain text
    const replies = [
      { choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "buscar_paciente", arguments: '{"nombre":"Juan"}' } }] } }] },
      { choices: [{ message: { role: "assistant", content: "No puedo buscar pacientes." } }] },
    ];
    const fetch = vi.fn(async () => Response.json(replies.shift()));
    vi.stubGlobal("fetch", fetch);
    const env = { GROQ_API_KEY: "test-key", DB: db } as Env;
    const out = await runAgent(env, { role: "guest" }, [{ role: "user", content: "Dame las citas de Juan Pérez" }]);
    expect(out.reply).toBe("No puedo buscar pacientes.");
    expect(fetch).toHaveBeenCalledTimes(2);
    // The guest's call to Groq offered only info_negocio, and the tool result sent back is the refusal
    const [first, second] = fetch.mock.calls.map((c) => JSON.parse((c as unknown as [string, RequestInit])[1].body as string));
    expect(first.tools.map((t: { function: { name: string } }) => t.function.name)).toEqual(["info_negocio"]);
    expect(second.messages.at(-1)).toEqual({ role: "tool", tool_call_id: "c1", content: JSON.stringify({ error: "Herramienta no disponible para este usuario." }) });
    expect(JSON.stringify(second.messages)).not.toContain("300 555");
  });
});
