# AgentShield Arena Lite release gate — 2026-11-14

**PRODUCT READY = NO.** No GitHub push, D1 migration, Worker deployment, Vercel deployment, agent key or transaction is authorized by this document.

## Candidate and boundaries

- [PR #1](https://github.com/chapaevv123/near-agentshield-arena/pull/1) is open from `release/functional-lite-20261114` into `main`. Its published commits are `6c7a64f` and `2af878c`; `check` passed in 39 seconds, while `migrate` and `deploy` were skipped. Recheck the PR head, checks and target branch before merge. The original dirty checkout is untouched.
- Vercel root `app/`, build `npm run build:showcase`, output `dist-showcase`. This contains the existing landing and the real wallet owner workspace at `/app/`. With no Worker URL, owner wallet actions use direct NEAR Testnet RPC and cloud-only panels show unavailable.
- `deploy/cloudflare/wrangler.toml` binds existing D1 `agentshield-lite` (`7de64b16-19fd-4c65-85d9-458e6be4ce01`) and serves the same `dist-showcase` assets on standard `workers.dev`. Worker offers NEP-413 owner-scoped read-only API. No signing/broadcast endpoint exists.
- Shared restricted executor design remains, but public autonomous REQUEST/EXECUTE is unavailable. The legacy Windows control plane is outside Lite hosting.

## Before any remote change

1. Review the exact PR diff and any new local changes. Run `git diff --check`, `python tools/audit_git_publication.py`, and `python tools/scan_public_secrets.py` inside the release worktree. Recheck `gh pr view 1` and `gh pr checks 1`. Never force push or merge the unrelated local `p0-vault-security-ci` history.
2. Confirm the Vercel project's production Git branch, root `app`, build `npm run build:showcase`, output `dist-showcase`, and auto-deploy behavior. Merging into `main` may trigger deployment. Obtain separate owner approval for merge and any resulting Vercel deployment before merging; pause an automatic deploy until approval.
3. On GitHub, protect `cloudflare-d1-migrate` and `cloudflare-worker-deploy` environments with required reviewers. Store `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` only as environment secrets. The check job needs neither. Confirm Workers/D1 **Free** and Vercel Hobby personal/noncommercial eligibility.

## Publication sequence after separate approvals

1. Finish local README and judge instructions; review their diff and secret scan. Push only a reviewed follow-up commit to the existing PR after separate push approval. Confirm the new PR head and green checks. Do not open another PR.
2. After separate merge and Vercel approvals, merge PR #1 into `main`. Record the merge SHA and confirm Vercel builds that SHA with root `app`, `npm run build:showcase`, and `dist-showcase`. Leave `VITE_AGENTSHIELD_WORKER_URL` unset for the wallet-first deployment.
3. Verify production `/` and `/app/` return 200, `/app` redirects to `/app/`, and Launch App opens the real Meteor/Testnet workspace. Check assets, CSP/RPC connectivity and the cloud-unavailable state. A route returning 200 does not prove a signed wallet flow.
4. Capture a separately authorized real Meteor owner transaction and reconcile its exact FINAL hash and Vault state before describing public wallet-to-chain onboarding as complete. The `workflow_dispatch` button appears after the workflow is on default `main`.

## Remote D1 and Worker — separate approvals

Cloudflare is optional for the `/app/` wallet-to-chain owner path. It is needed for NEP-413 cloud sessions, owner-scoped history and cloud policy reads. After the Vercel route works, run the `check` operation in `.github/workflows/cloudflare-lite-release.yml` on Ubuntu 24.04. Choose `migrate` with exact `MIGRATE_D1` confirmation only after owner approval and D1 environment review; choose `deploy` with exact `DEPLOY_WORKER` confirmation only after a second approval and Worker environment review. Both verify remote D1 identity first. The equivalent commands on a supported Linux host are in [`deploy/cloudflare/README.md`](../deploy/cloudflare/README.md). Before migration, export the existing D1 to a protected location outside Git:

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

**Gates:** A frontend/wallet local candidate PASS; B Worker/schema CI check PASS but remote D1/runtime pending; C PR #1 open with passing check, merge pending; D commands prepared, remote actions pending; E public wallet-to-chain FINAL E2E pending. Product release remains NO-GO until E.
