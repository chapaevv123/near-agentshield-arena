# AgentShield Arena Lite release gate — 2026-11-14

**PRODUCT READY = NO.** No GitHub push, D1 migration, Worker deployment, Vercel deployment, agent key or transaction is authorized by this document.

## Candidate and boundaries

- Local branch `release/functional-lite-20261114` lives in the separate `release/functional-lite/` worktree and starts at GitHub `main` commit `e633cbcccf19f6da14284d6117f227bf574a3529`. Re-read remote refs before any push; a changed `main` requires review of its new commits. The original dirty checkout is untouched.
- Vercel root `app/`, build `npm run build:showcase`, output `dist-showcase`. This contains the existing landing and the real wallet owner workspace at `/app/`. With no Worker URL, owner wallet actions use direct NEAR Testnet RPC and cloud-only panels show unavailable.
- `deploy/cloudflare/wrangler.toml` binds existing D1 `agentshield-lite` (`7de64b16-19fd-4c65-85d9-458e6be4ce01`) and serves the same `dist-showcase` assets on standard `workers.dev`. Worker offers NEP-413 owner-scoped read-only API. No signing/broadcast endpoint exists.
- Shared restricted executor design remains, but public autonomous REQUEST/EXECUTE is unavailable. The legacy Windows control plane is outside Lite hosting.

## Before any remote change

1. Compare `git ls-remote --heads https://github.com/chapaevv123/near-agentshield-arena.git` with the candidate base. Review `git diff --check`, `git diff --cached --stat`, `git diff --cached --name-only`, `python tools/audit_git_publication.py`, and `python tools/scan_public_secrets.py` inside the release worktree. Never use force push or merge the unrelated local `p0-vault-security-ci` history.
2. Review the exact PR file list and confirm the Vercel project's production Git branch/auto-deploy behavior. Merging into `main` may trigger a production deploy, so obtain separate Vercel approval before merge or disable that trigger with owner approval.
3. On GitHub, protect `cloudflare-d1-migrate` and `cloudflare-worker-deploy` environments with required reviewers. Store `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` only as environment secrets. The check job needs neither. Confirm Workers/D1 **Free** and Vercel Hobby personal/noncommercial eligibility.

## After separate publication approval

From the release worktree, push only the reviewed branch, with no force flag:

```sh
git push https://github.com/chapaevv123/near-agentshield-arena.git release/functional-lite-20261114:refs/heads/release/functional-lite-20261114
```

Open a PR against `main`; verify every file and commit. The `workflow_dispatch` button appears only after the workflow file exists on default `main`. After approved merge, run `AgentShield Lite check only`, then `AgentShield Lite Cloudflare release` with operation `check`. Both use Ubuntu and local D1 only. Check the logs for successful four-table migration, production build, bundle scan and Wrangler dry run.

## Remote D1 and Worker — separate approvals

The preferred execution path is `.github/workflows/cloudflare-lite-release.yml` on GitHub-hosted Ubuntu 24.04: choose `migrate` with exact `MIGRATE_D1` confirmation only after owner approval and D1 environment review; choose `deploy` with exact `DEPLOY_WORKER` confirmation only after a second approval and Worker environment review. Both verify remote D1 identity first. The equivalent commands on a supported Linux host are in [`deploy/cloudflare/README.md`](../deploy/cloudflare/README.md). Before migration, export the existing D1 to a protected location outside Git:

```sh
cd deploy/cloudflare
npx --no-install wrangler d1 info agentshield-lite --json --config wrangler.toml | node verify_d1_identity.mjs
npx --no-install wrangler d1 export agentshield-lite --remote --output /protected/agentshield-lite-before.sql --config wrangler.toml
npx --no-install wrangler d1 migrations apply agentshield-lite --remote --config wrangler.toml
npx --no-install wrangler d1 execute DB --remote --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name" --config wrangler.toml
npx --no-install wrangler deploy --config wrangler.toml
```

Run each remote mutation only after its specific authorization. Record the Worker version ID and the resulting `https://agentshield-arena-candidate.<subdomain>.workers.dev` URL. Verify `/`, `/app/`, `/mvp-api/health`, exact Vercel CORS, NEP-413, D1 persistence, owner isolation, rate limits and RPC 503. The Worker must work while the owner's PC is off.

## Vercel and rollback — separate approval

In the existing Vercel project, confirm root `app`, build `npm run build:showcase`, output `dist-showcase`. For a wallet-first deploy before Worker, leave `VITE_AGENTSHIELD_WORKER_URL` unset. After Worker smoke checks, set it to the exact HTTPS `workers.dev` origin without a path and deploy the approved commit. Confirm `/` and `/app/` return 200, Launch App opens the owner workspace, no mock asset ships, and the cloud API status reflects actual availability.

To roll back Worker code/assets, use a reviewed previous version ID with `npx --no-install wrangler rollback <PREVIOUS_VERSION_ID> --config wrangler.toml` from `deploy/cloudflare/` on supported Linux. This does **not** reverse D1 schema or data. Review a D1 Time Travel restore or a new migration separately. For Vercel, restore the prior production deployment in its dashboard, then verify a fresh browser load and asset links.

## Public judge E2E and media

Capture one new owner journey in a real browser: landing → Launch App → Meteor Testnet connect → owner account ID → Vault absence → wallet-confirmed `create_vault` with fixed initial limits → FINAL Vault state → wallet-confirmed deposit → FINAL balance/policy → allowed recipient → read-only Judge Demo ALLOW/DENY explanation → any supported owner authorization/revoke/withdraw prompt → exact FINAL hash → Testnet Explorer. Check RPC and API unavailable states, cancellation, and UNKNOWN reconciliation. If an executor is not safely available, do not submit REQUEST/EXECUTE or claim a new payment settlement.

GIF/README frames after real E2E: landing CTA; Meteor account; create prompt and fixed limits; FINAL balance; recipient policy and Judge Demo; FINAL transaction hash; Explorer receipt. Use real owner screenshots only, with private details redacted by the owner. A historical transaction screenshot must be labeled historical.

**Gates:** A frontend/wallet local candidate PASS; B Worker/schema local tests PASS but real D1/runtime pending; C local release branch prepared, push/PR pending; D commands prepared, remote actions pending; E public wallet-to-chain FINAL E2E pending. Product release remains NO-GO until E.
