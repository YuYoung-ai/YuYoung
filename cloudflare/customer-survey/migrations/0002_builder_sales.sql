CREATE TABLE IF NOT EXISTS survey_sales_config(
 id INTEGER PRIMARY KEY CHECK(id=1),password_hash TEXT NOT NULL,salt TEXT NOT NULL,
 version INTEGER NOT NULL,enabled INTEGER NOT NULL DEFAULT 1,updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS survey_sales_sessions(
 token_hash TEXT PRIMARY KEY,version INTEGER NOT NULL,expires_at INTEGER NOT NULL,created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS survey_sales_session_expiry ON survey_sales_sessions(expires_at);
CREATE TABLE IF NOT EXISTS survey_directory(name TEXT PRIMARY KEY,updated_at INTEGER NOT NULL);
