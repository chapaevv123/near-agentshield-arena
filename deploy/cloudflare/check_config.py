"""Verify the isolated D1 check uses the reviewed release database and schema."""

import tomllib
from pathlib import Path

root = Path(__file__).resolve().parent
release = tomllib.loads((root / "wrangler.toml").read_text(encoding="utf-8"))
check = tomllib.loads((root / "wrangler.check.toml").read_text(encoding="utf-8"))
release_db = release["d1_databases"][0]
check_db = check["d1_databases"][0]
assert release_db == check_db, "local D1 check binding differs from release binding"
assert check.get("assets") is None, "local D1 check must not publish assets"
assert (root / "migrations" / "0001_initial.sql").read_bytes() == (root / "schema.sql").read_bytes(), "migration differs from schema"
print("CLOUDFLARE_CHECK_CONFIG_PASS")
