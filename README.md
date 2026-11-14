# AgentShield Arena

**Public website:** https://near-agentshield-arena.vercel.app

**Safe public source snapshot:** https://github.com/chapaevv123/near-agentshield-arena

## WORKING NOW

- The published landing page shows a historical, independently verified Testnet payment. Its current `/app` route returned HTTP 404 during the 14 November 2026 preflight; the release candidate fixes this locally, but has not been deployed.
- The local release build serves the existing Meteor Testnet owner workspace at `/app/`: connect/disconnect, read a user's FINAL Vault/policy, create a Vault with fixed initial limits, deposit, set recipient, authorize, revoke an agent grant, withdraw, and reconcile exact wallet transaction hashes before showing FINAL. Every owner transaction requires an explicit Meteor prompt. A read-only Judge Demo estimates ALLOW/DENY from fresh FINAL policy without submitting a payment.
- The existing Vault v2 contract, historical receipt evidence, and shared restricted executor architecture remain intact. The local owner journey is source, unit and mocked-browser verified; a new public wallet-to-chain journey is still unverified.

## EXPERIMENTAL

- Cloudflare Workers + D1 Free read-only API: NEP-413 owner session, owner-scoped FINAL policy/history, rate limits and policy preflight. A local Worker test is not proof of deployed Cloudflare behavior. The Vercel app can use the approved `VITE_AGENTSHIELD_WORKER_URL` after deployment; without it, wallet owner operations still use NEAR RPC while cloud-only functions show unavailable.
- [PR #1](https://github.com/chapaevv123/near-agentshield-arena/pull/1) contains the release candidate. Its Ubuntu check passed; migration and deployment were skipped. The reviewed code is not yet on the public `/app/` route.

## NOT AVAILABLE

- Autonomous agent REQUEST/EXECUTE from the public site. The Windows DPAPI signer and local control plane are outside Lite; there is no approved cloud signer, live key or broadcast endpoint.
- Public Meteor-to-Vault FINAL E2E for a new owner. **PRODUCT READY = NO** until that result is captured on the deployed app.

Judge path after an authorized deployment: **Launch App → Connect Meteor Testnet → Create My Vault with initial limits (if absent) → Deposit → Read FINAL balance/policy → Check payment against FINAL policy → confirm an owner action in Meteor → reconcile its FINAL hash → open Testnet Explorer.** If a Vault already exists, start with its FINAL state. The ALLOW/DENY panel is an advisory estimate and sends no agent payment. If Meteor cancels, RPC fails or the outcome is UNKNOWN, stop and report that state. Capture real screenshots only after the public flow; proposed frames are landing/Launch App, Meteor account, Vault creation prompt, FINAL balance, policy and Judge Demo, FINAL transaction hash, and Explorer receipt.

Exact publication gates, commands, rollback and public E2E checklist: [Lite release runbook](docs/LITE_RELEASE_RUNBOOK_2026-11-14.md).

For the NEAR HACKATHON, the new Lite work is isolated in [PR #1](https://github.com/chapaevv123/near-agentshield-arena/pull/1) against the earlier public showcase baseline. The primary submission track is AI Security & Defense; public agent execution remains unavailable. See the [video plan and submission draft](docs/LITE_HACKATHON_SUBMISSION_2026-11-14.md). No new public judge video, X post or application is evidenced here.

**Secure payments for AI agents, with owner policy and verifiable NEAR Testnet settlement.** This is an independent hackathon project built on NEAR Testnet, not an official NEAR Protocol product.

![AgentShield Arena desktop showcase](docs/screenshots/desktop.png)

## The problem and solution

An agent can propose a useful payment and still make a costly mistake or follow malicious instructions. AgentShield separates the owner's authority from the agent's limited ability to act. The owner approves an exact scope; a restricted agent key can request and execute only through a shared Vault contract; the recipient, limits, policy, and final receipts are checked independently.

The currently published [showcase](app/showcase/) is a read-only demonstration of a **completed historical Testnet payment**. The release candidate adds the real owner workspace at `/app/` without exposing the protected local backend or simulating a new settlement.

## Real Testnet proof

On 13 November 2026, payment `ag-e7f53f5b9e714fc4ac09d7eb45ee2618` completed under policy v4: **0.001 NEAR** from Vault `agentshield-arena-v2-stage2.testnet` to `soundestate8404.testnet`, owner `safeibis9110.testnet`, restricted agent `openroom8315.testnet`.

| Phase | FINAL transaction |
| --- | --- |
| Owner authorization | [6YjcdhYxs65JQMtfqDLgMM2PfadMtJQkSfHjmR4KCT1N](https://testnet.nearblocks.io/txns/6YjcdhYxs65JQMtfqDLgMM2PfadMtJQkSfHjmR4KCT1N) |
| Agent request | [2Yo8N6TvbtobhWYH8UxvgAAxCrm1FGXduBa82qZCUmr8](https://testnet.nearblocks.io/txns/2Yo8N6TvbtobhWYH8UxvgAAxCrm1FGXduBa82qZCUmr8) |
| Settlement execution | [ApXoyN7EpG6S8DFX6gfm919tqQFQC4u911MDxU7p4KdS](https://testnet.nearblocks.io/txns/ApXoyN7EpG6S8DFX6gfm919tqQFQC4u911MDxU7p4KdS) |

FastNear and Intear independently confirmed the exact FINAL execute outcome, transfer receipt `bhH1rHpPWmLPrWKo8dUYfQuWQxhpUNezUEEoESR1frv` and callback receipt `2nw4yLNc1aF2MLP1thgKBUwDTWhq7fBrtnvm7qeEtVQ6`. The backend task `task-ab5b09b7692e4a9d8d9d21241cb9a0d2` is `COMPLETED` at revision 9 with `TESTNET_TWO_RPC_FINAL` settlement evidence. See [proof details](docs/TESTNET_PROOF_2026-11-13.md). This proof describes one historical payment, not a new user's live Vault.

## Product features

- Owner authorization of an exact payment scope; policy v4 amount and recipient restrictions.
- Restricted FunctionCall key on the agent account, limited to the Vault payment methods.
- Durable one-shot transaction claims and read-only reconciliation after uncertain broadcasts.
- FINAL receipt and settlement graph verification through two independent RPC providers.
- Audited backend task transitions, local Stage 2 owner UI, and a separate public read-only proof walkthrough.

## Architecture and security

`Owner → Policy / shared Vault → Restricted agent → Request → Execute → Recipient`

The shared Vault contract enforces payment policy. The protected agent signer and journal remain on the local Windows host with DPAPI CurrentUser custody. The owner session uses authenticated NEP-413 locally. Neither the public build nor this repository's publication set should contain private keys, bearer tokens, SQLite databases, DPAPI stores, or journals. The public showcase performs no signing, RPC mutation, or local API call.

The repository contains an earlier single-owner contract in `contract/` and an isolated multitenant experiment in `spike/multitenant-contract/`; their Borsh state is incompatible. Do not deploy the spike onto the historical Vault or a personal account. [Architecture and product acceptance](docs/COMPLETE_PRODUCT_ACCEPTANCE.md) describes the broader product scope; the public site shows only verified capabilities.

## Tech stack and local run

- Frontend: React 19, TypeScript 5, Vite 7; Playwright browser checks.
- Contract: Rust / NEAR SDK; local backend: Python and SQLite; protected G signer: Rust/Windows DPAPI.
- Public hosting target: Vercel HTTPS for landing and owner wallet actions; Cloudflare Workers + D1 Free for optional read-only owner cloud API. Neither depends on the owner's PC after deployment.

Requirements: Node.js 22+, npm; Python 3.11+ only for local Stage 2 and release scans.

```sh
cd app
npm install
npm run build:showcase
npm run preview:showcase
```

Open `http://127.0.0.1:4182` locally. The public Vercel project root is **`app`** in the isolated release snapshot; `app/vercel.json` runs `npm run build:showcase` and publishes `dist-showcase`. The protected developer flow remains available through `start-stage2.cmd` on Windows and is deliberately excluded from the public build.

## Checks

```sh
cd app
npm test
npm run build
npm run build:showcase
npm run test:showcase
```

From the repository root:

```sh
python tools/scan_public_secrets.py
python tools/audit_git_publication.py
git diff --check
```

The showcase Playwright test uses installed Microsoft Edge and saves [desktop](docs/screenshots/desktop.png) and [mobile](docs/screenshots/mobile.png) screenshots. These browser checks are not a new real wallet E2E. See [release notes and interaction registry](docs/HACKATHON_RELEASE_2026-11-13.md).

## Limits and publication

The currently deployed public experience is read only and `/app` returned 404 in the latest preflight. The prepared Vercel build includes `/app/` and real wallet owner actions; it has not been published. The historical showcase snapshot may have changed. Cloud agent signing remains unavailable.

The owner authorized safe publication. A separate clean-history snapshot at `release/public-snapshot/` is published through the public source link above; the original repository retains extensive uncommitted Stage 2 work and no public remote. Do not run `git reset` or `git clean`. See [current status](PROJECT_STATUS.md) and [release preparation](docs/HACKATHON_RELEASE_2026-11-13.md).

## Hackathon

Recommended primary track: **AI Security & Defense**. The [official event page](https://near.army/) permits multiple fitting tracks in one submission; Agent Economy is a possible secondary fit because a restricted agent completed a real payment. [Demo script and submission draft](docs/HACKATHON_DEMO_SUBMISSION_2026-11-13.md) are prepared for owner review; nothing has been posted or submitted.

## License

No license has been approved. All rights remain with the repository owner until a license is selected and added.
