"""Read-only scan of Git history and publishable working-tree files.

Prints paths and finding categories only; never prints matching secret values.
"""
from __future__ import annotations

import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TEXT = {".py", ".ps1", ".ts", ".tsx", ".js", ".mjs", ".json", ".jsonl", ".md", ".html", ".css", ".toml", ".yml", ".yaml", ".txt"}
SECRET = [
    re.compile(rb"-----BEGIN (?:OPENSSH |EC |RSA )?PRIVATE KEY-----"),
    re.compile(rb'"(?:private_key|secret_key|seed_phrase|mnemonic)"\s*:\s*"(?!<|\*|REDACTED)[^"\s]{20,}"', re.I),
    re.compile(rb"ed25519:[1-9A-HJ-NP-Za-km-z]{80,100}"),
]
PUBLIC_RECEIPT_SIGNATURE = re.compile(rb'"signature"\s*:\s*"ed25519:[1-9A-HJ-NP-Za-km-z]{80,100}"')


def git(*args: str) -> bytes:
    return subprocess.check_output(["git", *args], cwd=ROOT)


def sensitive_name(name: str) -> bool:
    p = Path(name.lower())
    if p.name in {".env", "credentials.json", "key4.db", "logins.json"}:
        return True
    if p.name.endswith((".sqlite", ".sqlite3", ".pem", ".p12", ".key")):
        return True
    if "browser-profile" in name.lower() or "/.aws/" in name.lower():
        return True
    return False


def check(name: str, data: bytes, source: str, findings: list[str]) -> None:
    if sensitive_name(name):
        findings.append(f"{source}: sensitive path {name}")
    # FINAL receipt signatures in the captured E2E JSON are public chain data.
    # Identical encodings elsewhere remain findings.
    scanned = PUBLIC_RECEIPT_SIGNATURE.sub(b'"signature":"<PUBLIC_RECEIPT_SIGNATURE>"', data) if name.startswith("artifacts/e2e/") and name.endswith(".json") else data
    if Path(name).suffix.lower() in TEXT and any(p.search(scanned) for p in SECRET):
        findings.append(f"{source}: secret marker in {name}")


def main() -> None:
    findings: list[str] = []
    current = [x.decode("utf-8", "surrogateescape") for x in git("ls-files", "--cached", "--others", "--exclude-standard", "-z").split(b"\0") if x]
    for name in current:
        path = ROOT / name
        if path.is_file():
            check(name, path.read_bytes(), "working tree", findings)
    commits = git("rev-list", "--all").decode().splitlines()
    for commit in commits:
        entries = git("ls-tree", "-r", "-z", commit).split(b"\0")
        for entry in entries:
            if not entry:
                continue
            metadata, raw_name = entry.split(b"\t", 1)
            if metadata.split()[1] != b"blob":
                continue
            name = raw_name.decode("utf-8", "surrogateescape")
            if sensitive_name(name) or Path(name).suffix.lower() in TEXT:
                data = git("cat-file", "blob", metadata.split()[2].decode())
                check(name, data, commit[:12], findings)
    if findings:
        for finding in findings:
            print(finding)
        raise SystemExit(1)
    print(f"PUBLICATION_AUDIT_PASS: {len(current)} candidate files; {len(commits)} historical commits; no matching sensitive paths or secret markers")


if __name__ == "__main__":
    main()
