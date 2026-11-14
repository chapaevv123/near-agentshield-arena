"""Fail on likely private key material in source and release artifacts.

This is a conservative local gate, not a substitute for dedicated secret scanning.
"""
from pathlib import Path
import re
import os

ROOT = Path(__file__).resolve().parents[1]
SKIP = {".git", "node_modules", "target", "dist", "__pycache__", ".edge-smoke", ".venv-audit", ".venv", ".cargo-home"}
TEXT = {".py", ".ps1", ".ts", ".tsx", ".js", ".mjs", ".json", ".jsonl", ".md", ".html", ".css", ".toml", ".yml", ".yaml"}
PATTERNS = [
    re.compile(r"-----BEGIN (?:OPENSSH |EC |RSA )?PRIVATE KEY-----"),
    re.compile(r'"(?:private_key|secret_key|seed_phrase|mnemonic)"\s*:\s*"(?!<|\*|REDACTED)[^"\s]{20,}"', re.I),
    re.compile(r"ed25519:[1-9A-HJ-NP-Za-km-z]{80,100}"),
]

hits = []
for directory, subdirs, files in os.walk(ROOT):
    subdirs[:] = [name for name in subdirs if name not in SKIP and not name.startswith("app-headless-profile")]
    for name in files:
        path = Path(directory, name)
        if path.suffix.lower() not in TEXT:
            continue
        try:
            value = path.read_text(encoding="utf-8-sig")
        except (UnicodeError, OSError):
            continue
        # FINAL receipt signatures are public 64-byte Ed25519 values. The
        # same long encoding outside an explicit signature field stays a hit.
        public_signature_lines_removed = "\n".join(
            line for line in value.splitlines()
            if not re.search(r'"signature"\s*:\s*"ed25519:', line, re.I)
        )
        if any(pattern.search(value) for pattern in PATTERNS[:2]) or \
                PATTERNS[2].search(public_signature_lines_removed):
            hits.append(str(path.relative_to(ROOT)))
if hits:
    print("POTENTIAL_SECRET_IN_FILES:", ", ".join(hits))
    raise SystemExit(1)
print("SECRET_SCAN_PASS: no matching private-key material in text files")
