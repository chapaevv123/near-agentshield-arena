CREATE TABLE IF NOT EXISTS challenges (
  nonce_hash TEXT PRIMARY KEY, owner TEXT NOT NULL, message TEXT NOT NULL,
  recipient TEXT NOT NULL, origin TEXT NOT NULL, expires_at INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, owner TEXT NOT NULL, origin TEXT NOT NULL,
  public_key TEXT NOT NULL, expires_at INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS observed_payments (
  owner TEXT NOT NULL, payment_id TEXT NOT NULL, observed_at INTEGER NOT NULL,
  PRIMARY KEY(owner, payment_id)
);
CREATE TABLE IF NOT EXISTS rate_limits (
  bucket INTEGER NOT NULL, scope TEXT NOT NULL, subject_hash TEXT NOT NULL,
  hits INTEGER NOT NULL, PRIMARY KEY(bucket, scope, subject_hash)
);
