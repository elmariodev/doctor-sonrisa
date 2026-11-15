-- One row per chat message: what came in, what went out, and what the gate
-- did. The visitor is a short hash of the IP, never the IP itself. Rows
-- older than 30 days are deleted.
CREATE TABLE logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  visitor TEXT NOT NULL,
  role TEXT NOT NULL,
  user_id TEXT,
  message TEXT NOT NULL,
  reply TEXT,
  outcome TEXT NOT NULL,
  tools TEXT,
  sources TEXT,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  ms INTEGER
);
CREATE INDEX logs_chat ON logs(chat_id, id);
CREATE INDEX logs_at ON logs(at);
