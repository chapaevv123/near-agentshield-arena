"""Scan the exact public working set and every reachable Git blob without printing values."""

from __future__ import annotations

import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SKIP_DIRS = {".git", "node_modules", "dist-showcase", "target", "test-results", ".vercel"}
SENSITIVE_PATH = re.compile(
    r"(^|/)(\.env(?:\.|$)|[^/]*(?:private[_-]?key|secret|credential|session|journal|dpapi|mnemonic|seed|\.sqlite|\.db|\.pem|\.p12|\.pfx|\.key)(?:\.|/|$))",
    re.I,
)
MARKERS = {
    "private key block": re.compile(rb"-----BEGIN (?:OPENSSH |RSA |EC )?PRIVATE KEY-----"),
    "key field": re.compile(rb'"(?:private_key|secret_key|seed_phrase|mnemonic)"\s*:\s*"(?!<|\*|REDACTED)[^"\s]{20,}"', re.I),
    "long ed25519 key": re.compile(rb"ed25519:[1-9A-HJ-NP-Za-km-z]{80,100}"),
    "bearer token": re.compile(rb"Bearer\s+[A-Za-z0-9._~+/-]{20,}", re.I),
    "GitHub token": re.compile(rb"(?:ghp_|github_pat_)[A-Za-z0-9_]{20,}"),
    "AWS access key": re.compile(rb"(?:AKIA|ASIA)[0-9A-Z]{16}"),
}


def git(*args: str) -> bytes:
    return subprocess.check_output(["git", "-c", f"safe.directory={ROOT}", *args], cwd=ROOT, stderr=subprocess.DEVNULL)


def check(name: str, data: bytes, findings: list[str], source: str) -> None:
    normalized = name.replace("\\", "/")
    if SENSITIVE_PATH.search(normalized):
        findings.append(f"{source}: sensitive path: {name}")
    for category, pattern in MARKERS.items():
        if pattern.search(data):
            findings.append(f"{source}: {category}: {name}")


def main() -> None:
    findings: list[str] = []
    files = [path for path in ROOT.rglob("*") if path.is_file() and not any(part in SKIP_DIRS for part in path.relative_to(ROOT).parts)]
    for path in files:
        check(path.relative_to(ROOT).as_posix(), path.read_bytes(), findings, "working set")
    objects = 0
    staged = 0
    try:
        git_root = Path(git("rev-parse", "--show-toplevel").decode().strip()).resolve()
        if git_root == ROOT:
            index_entries = [entry for entry in git("ls-files", "--stage", "-z").split(b"\0") if entry]
            for entry in index_entries:
                metadata, name = entry.split(b"\t", 1)
                object_id = metadata.split()[1].decode()
                staged += 1
                check(name.decode("utf-8"), git("cat-file", "blob", object_id), findings, f"index object {object_id[:12]}")
            entries = git("rev-list", "--objects", "--all").decode().splitlines()
        else:
            entries = []
    except subprocess.CalledProcessError:
        entries = []
    for entry in entries:
        object_id, _, name = entry.partition(" ")
        if git("cat-file", "-t", object_id).strip() != b"blob":
            continue
        objects += 1
        check(name, git("cat-file", "blob", object_id), findings, f"Git object {object_id[:12]}")
    for finding in findings:
        print(finding)
    if findings:
        raise SystemExit(1)
    print(f"PUBLISH_AUDIT_PASS: {len(files)} working files; {staged} staged objects; {objects} reachable Git blobs; no sensitive paths or secret markers")


if __name__ == "__main__":
    main()
