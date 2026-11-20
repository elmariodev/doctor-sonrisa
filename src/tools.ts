// The model's tools. Each role gets only its own, and the data tools take
// no patient id from the model: the patient comes from the session.
import type { Session, Role } from "./auth";
import { nowLocal, spoken } from "./clock";
import { searchDocs } from "./rag";

export type ToolContext = { db: D1Database; session: Session; env: { AI: Ai; VECTORIZE: VectorizeIndex }; sources: Set<string> };

type Tool = {
  roles: Role[];
  schema: { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } };
  // The arguments come from the model: any JSON, checked by each tool
  run: (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;
};

const SERVICES = ["valoración", "limpieza", "resina", "blanqueamiento", "control de ortodoncia", "extracción", "endodoncia"];

// Mon-Fri 8:00-18:00, Sat 9:00-13:00, on the hour or half hour
function openSlot(local: string) {
  const m = local.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/);
  if (!m || !["00", "30"].includes(m[3])) return false;
  const day = new Date(`${m[1]}T12:00:00Z`).getUTCDay();
  const minutes = Number(m[2]) * 60 + Number(m[3]);
  if (day >= 1 && day <= 5) return minutes >= 8 * 60 && minutes <= 17 * 60 + 30;
  if (day === 6) return minutes >= 9 * 60 && minutes <= 12 * 60 + 30;
  return false;
}

const appointmentsOf = async (db: D1Database, patientId: string) =>
  (await db.prepare("SELECT starts_at, service FROM appointments WHERE patient_id = ? AND status = 'confirmada' AND starts_at >= ? ORDER BY starts_at")
    .bind(patientId, nowLocal()).all<{ starts_at: string; service: string }>()).results
    .map((a) => ({ cuando: spoken(a.starts_at), servicio: a.service }));

export const TOOLS: Record<string, Tool> = {
  info_negocio: {
    roles: ["guest", "user", "admin"],
    schema: { type: "function", function: {
      name: "info_negocio",
      description: "Busca en los documentos públicos del consultorio: horarios, dirección, precios, servicios, políticas de citas, formas de pago y cuidados. Úsala para cualquier dato del consultorio.",
      parameters: { type: "object", properties: { pregunta: { type: "string", description: "Qué buscar, en palabras del paciente" } }, required: ["pregunta"] },
    } },
    run: async ({ pregunta }, { env, sources }) => {
      const found = await searchDocs(env, String(pregunta || "").slice(0, 300));
      found.forEach((f) => sources.add(f.doc));
      return found.length ? { fragmentos: found.map((f) => ({ documento: f.doc, texto: f.text })) } : { fragmentos: [], nota: "No hay nada sobre eso en los documentos." };
    },
  },

  mis_citas: {
    roles: ["user"],
    schema: { type: "function", function: {
      name: "mis_citas",
      description: "Las próximas citas del paciente que tiene la sesión abierta. No recibe ningún dato: el servidor sabe quién es.",
      parameters: { type: "object", properties: {} },
    } },
    run: async (_args, { db, session }) => session.patientId
      ? { paciente: session.name, citas: await appointmentsOf(db, session.patientId) }
      : { error: "Esta cuenta no tiene un paciente asociado." },
  },

  agendar: {
    roles: ["user"],
    schema: { type: "function", function: {
      name: "agendar",
      description: "Agenda una cita para el paciente de la sesión. Horario: lunes a viernes 8:00-18:00, sábados 9:00-13:00, en punto o y media.",
      parameters: { type: "object", properties: {
        fecha_hora: { type: "string", description: "Hora local de Bogotá, formato YYYY-MM-DDTHH:MM" },
        servicio: { type: "string", enum: SERVICES },
      }, required: ["fecha_hora", "servicio"] },
    } },
    run: async ({ fecha_hora, servicio }, { db, session }) => {
      if (typeof servicio !== "string" || !SERVICES.includes(servicio)) return { error: "Ese servicio no existe." };
      if (typeof fecha_hora !== "string" || !openSlot(fecha_hora)) return { error: "Esa hora no está dentro del horario (en punto o y media)." };
      if (fecha_hora <= nowLocal()) return { error: "Esa fecha ya pasó." };
      if (!session.patientId) return { error: "Esta cuenta no tiene un paciente asociado." };
      // The unique index on confirmed slots settles two bookings of the same hour at once
      const booked = await db.prepare("INSERT INTO appointments (patient_id, starts_at, service) VALUES (?, ?, ?) ON CONFLICT DO NOTHING")
        .bind(session.patientId, fecha_hora, servicio).run();
      if (!booked.meta.changes) return { error: "Esa hora ya está ocupada. Ofrece otra." };
      return { ok: true, cita: { cuando: spoken(fecha_hora), servicio } };
    },
  },

  buscar_paciente: {
    roles: ["admin"],
    schema: { type: "function", function: {
      name: "buscar_paciente",
      description: "Busca pacientes por nombre y muestra su teléfono y sus próximas citas. Solo para el personal del consultorio.",
      parameters: { type: "object", properties: { nombre: { type: "string" } }, required: ["nombre"] },
    } },
    run: async ({ nombre }, { db }) => {
      const rows = (await db.prepare("SELECT id, name, phone FROM patients WHERE name LIKE ? LIMIT 5")
        .bind(`%${String(nombre || "").trim()}%`).all<{ id: string; name: string; phone: string }>()).results;
      return { pacientes: await Promise.all(rows.map(async (p) => ({ nombre: p.name, telefono: p.phone, citas: await appointmentsOf(db, p.id) }))) };
    },
  },
};

export const toolsFor = (role: Role) => Object.entries(TOOLS).filter(([, t]) => t.roles.includes(role));
