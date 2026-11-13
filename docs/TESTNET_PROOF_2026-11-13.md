# Historical Testnet payment proof — 13 November 2026

This document records one completed payment. It is not live polling and does not verify any future owner's Vault.

| Field | Verified value |
| --- | --- |
| Task | `task-ab5b09b7692e4a9d8d9d21241cb9a0d2` |
| Payment | `ag-e7f53f5b9e714fc4ac09d7eb45ee2618` |
| Owner / agent | `safeibis9110.testnet` / `openroom8315.testnet` |
| Vault | `agentshield-arena-v2-stage2.testnet` |
| Recipient | `soundestate8404.testnet` |
| Amount | `1000000000000000000000` yoctoNEAR = **0.001 NEAR** |
| Policy | v4 |
| Backend | `COMPLETED`, revision 9; settlement evidence `TESTNET_TWO_RPC_FINAL` |

## FINAL transactions

1. [Owner AUTHORIZE](https://testnet.nearblocks.io/txns/6YjcdhYxs65JQMtfqDLgMM2PfadMtJQkSfHjmR4KCT1N): `6YjcdhYxs65JQMtfqDLgMM2PfadMtJQkSfHjmR4KCT1N`.
2. [Agent REQUEST](https://testnet.nearblocks.io/txns/2Yo8N6TvbtobhWYH8UxvgAAxCrm1FGXduBa82qZCUmr8): `2Yo8N6TvbtobhWYH8UxvgAAxCrm1FGXduBa82qZCUmr8`.
3. [Agent EXECUTE](https://testnet.nearblocks.io/txns/ApXoyN7EpG6S8DFX6gfm919tqQFQC4u911MDxU7p4KdS): `ApXoyN7EpG6S8DFX6gfm919tqQFQC4u911MDxU7p4KdS`.

FastNear and Intear returned exact successful FINAL execute receipts at heights 277561240 and 277561245. The transfer receipt was `bhH1rHpPWmLPrWKo8dUYfQuWQxhpUNezUEEoESR1frv`; callback receipt `2nw4yLNc1aF2MLP1thgKBUwDTWhq7fBrtnvm7qeEtVQ6`. Both RPCs observed payment `SETTLED`, 0.009 NEAR Vault available, zero pending, and recipient balance 0.011 NEAR after execution. These balances are an **observation from 13 November 2026**, not current balances.

The local backend's audited task record, inspected read only after owner handoff, records `COMPLETED` at revision 9 with exact authorization and REQUEST FINAL rows, and EXECUTE settlement classification `TESTNET_TWO_RPC_FINAL`. The local-only artifact `artifacts/e2e/stage2-fourth-payment-execute-final-2026-11-13.json` was captured **before** backend handoff and therefore still says `BLOCKED`/revision 8. It remains an accurate timestamped intermediate record and is deliberately excluded from the public publish set. The final backend state was verified later; no SQLite edit was made for this documentation.

Evidence levels: real finalized Testnet receipts and audited backend state are distinct from local unit tests, mocked wallet tests, and browser showcase tests.
