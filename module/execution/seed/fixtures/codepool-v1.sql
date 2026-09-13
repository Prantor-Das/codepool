CREATE TABLE IF NOT EXISTS sandbox_probe (
  id TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT INTO sandbox_probe (id, value)
VALUES ('codepool-sandbox-v1', 'deterministic')
ON CONFLICT (id) DO UPDATE SET value = EXCLUDED.value;
