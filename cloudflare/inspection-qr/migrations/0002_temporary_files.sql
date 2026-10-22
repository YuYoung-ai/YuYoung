CREATE TABLE IF NOT EXISTS qr_file_heads (
  object_key TEXT PRIMARY KEY,
  version TEXT NOT NULL,
  parts INTEGER NOT NULL,
  size INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS qr_file_parts (
  object_key TEXT NOT NULL,
  version TEXT NOT NULL,
  part INTEGER NOT NULL,
  bytes BLOB NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(object_key,version,part)
);
CREATE INDEX IF NOT EXISTS qr_file_parts_created ON qr_file_parts(created_at);
