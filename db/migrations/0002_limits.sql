-- Counters for the message limits: per visitor, and Groq calls and tokens
-- per minute and per day. Each key names its window; old ones expire.
CREATE TABLE counters (
  key TEXT PRIMARY KEY,
  n INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
