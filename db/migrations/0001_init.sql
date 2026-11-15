-- Patients, their appointments, the staff and patient accounts, and sessions.
-- Times are the clinic's local time (America/Bogota), "YYYY-MM-DDTHH:MM".
CREATE TABLE patients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT NOT NULL
);

CREATE TABLE appointments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id TEXT NOT NULL REFERENCES patients(id),
  starts_at TEXT NOT NULL,
  service TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'confirmada'
);
CREATE INDEX appointments_patient ON appointments(patient_id, starts_at);
CREATE UNIQUE INDEX appointments_slot ON appointments(starts_at) WHERE status = 'confirmada';

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'admin')),
  patient_id TEXT REFERENCES patients(id),
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL
);
