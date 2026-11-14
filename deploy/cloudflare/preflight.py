"""Read-only release gate. Never creates a D1 database or deploys a Worker."""
import os
import re
import sys
import tomllib
import uuid
from pathlib import Path


root = Path(__file__).resolve().parents[2]
config = tomllib.loads(Path(__file__).with_name("wrangler.toml").read_text(encoding="utf-8"))
errors = []
database = config.get("d1_databases", [{}])[0]
database_id = database.get("database_id", "")
if database.get("database_name") != "agentshield-lite" or database_id != "7de64b16-19fd-4c65-85d9-458e6be4ce01":
    errors.append("D1 name/UUID differs from the owner-provided database")
if database.get("migrations_dir") != "migrations":
    errors.append("D1 migrations_dir must be migrations")
try:
    if uuid.UUID(database_id).int == 0:
        errors.append("D1 database_id must be nonzero")
except (ValueError, TypeError):
    errors.append("D1 database_id is not an approved UUID")
if config.get("workers_dev") is not True:
    errors.append("workers_dev must be enabled")
if config.get("assets", {}).get("directory") != "../../app/dist-showcase":
    errors.append("Worker assets must be the production app/dist-showcase")
dist = root / "app" / "dist-showcase"
if not (dist / "index.html").is_file() or not (dist / "app" / "index.html").is_file():
    errors.append("production frontend build is missing")
if any("mock-meteor" in path.name.lower() for path in dist.rglob("*")):
    errors.append("mock Meteor asset in production bundle")
migration = Path(__file__).with_name("migrations") / "0001_initial.sql"
if not migration.is_file() or migration.read_bytes() != Path(__file__).with_name("schema.sql").read_bytes():
    errors.append("versioned D1 migration differs from reviewed schema.sql")
if "--vercel" in sys.argv:
    url = os.environ.get("VITE_AGENTSHIELD_WORKER_URL", "")
    if not re.fullmatch(r"https://[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev/?", url):
        errors.append("approved workers.dev URL missing for Vercel")
if errors:
    print("CLOUD_RELEASE_NO_GO: " + "; ".join(errors))
    raise SystemExit(1)
print("CLOUD_RELEASE_PREFLIGHT_PASS: local configuration and assets only")
