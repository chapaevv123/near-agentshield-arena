#!/usr/bin/env bash
# Local sandbox fixtures only. Never use these fixed test.near manifests on Testnet.
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root"
python3 spike/recovery-prototype/check_layout.py
manifest=spike/recovery-prototype/Cargo.toml
target_dir=spike/recovery-prototype/target/linux-fixtures
fixture_dir=spike/recovery-prototype/target/fixtures
mkdir -p "$fixture_dir"
for fixture in success failure wrong-owner wrong-amount wrong-id; do
  case "$fixture" in
    success) features=recover-success ;;
    failure) features=recover-failure ;;
    wrong-owner) features=recover-success,wrong-owner ;;
    wrong-amount) features=recover-success,wrong-amount ;;
    wrong-id) features=recover-success,wrong-id ;;
  esac
  CARGO_TARGET_DIR="$target_dir" cargo build --locked --release \
    --target wasm32-unknown-unknown --manifest-path "$manifest" --features "$features"
  cp "$target_dir/wasm32-unknown-unknown/release/agentshield_recovery_prototype.wasm" \
    "$fixture_dir/$fixture.wasm"
  sha256sum "$fixture_dir/$fixture.wasm"
done
