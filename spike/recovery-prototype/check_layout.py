"""Fail if the isolated recovery snapshot changes Vault v2's Borsh layout."""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parent
normal = (ROOT / "../multitenant-contract/src/lib.rs").read_text(encoding="utf-8")
recovery = (ROOT / "src/lib.rs").read_text(encoding="utf-8")


def fields(source: str, name: str) -> list[str]:
    match = re.search(rf"pub struct {name} \{{(.*?)\n\}}", source, re.S)
    if match is None:
        raise SystemExit(f"Missing {name}")
    return [line.strip().split("//", 1)[0].strip()
            for line in match.group(1).splitlines()
            if line.strip() and not line.lstrip().startswith("//")]


for struct in ("Contract", "Vault", "Payment"):
    if fields(normal, struct) != fields(recovery, struct):
        raise SystemExit(f"Borsh layout differs: {struct}")
if 'LookupMap::new(b"v")' not in normal or 'LookupMap::new(b"v")' not in recovery:
    raise SystemExit("LookupMap prefix differs")
print("PASS: Contract, Vault, Payment Borsh fields and LookupMap prefix match")
