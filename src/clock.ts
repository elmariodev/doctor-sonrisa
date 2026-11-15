// The clinic's clock: America/Bogota, "YYYY-MM-DDTHH:MM"
const TZ = "America/Bogota";

export function nowLocal() {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date()).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

// "2026-11-18T10:30" -> "miércoles 18 de noviembre de 2026, 10:30"
export function spoken(local: string) {
  const [d, t] = local.split("T");
  const date = new Date(`${d}T12:00:00Z`);
  const day = new Intl.DateTimeFormat("es-CO", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(date);
  return t ? `${day}, ${t}` : day;
}
