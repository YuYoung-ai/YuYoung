CREATE TABLE IF NOT EXISTS qr_sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  owner TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','signing','signed','revoked')),
  filename TEXT NOT NULL,
  document_no TEXT NOT NULL,
  document_hash TEXT NOT NULL,
  placements TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  retain_until INTEGER NOT NULL,
  download_until INTEGER,
  signer TEXT,
  signed_at INTEGER,
  sign_id TEXT,
  sign_hash TEXT,
  lease_until INTEGER
);
CREATE INDEX IF NOT EXISTS qr_sessions_retention ON qr_sessions(retain_until);
CREATE INDEX IF NOT EXISTS qr_sessions_owner ON qr_sessions(owner,created_at);
