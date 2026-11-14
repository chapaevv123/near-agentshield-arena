# Free cloud candidate (read-only executor mode)

This candidate serves the existing Vite landing and `/app` from Cloudflare Workers static assets. The Worker has no private key, signing code, broadcast route, control worker, Windows SID, or DPAPI dependency. D1 stores one-time NEP-413 challenges, short-lived owner sessions, and owner-observed payment IDs. Every history status and policy preflight is read from the pinned Vault v2 contract at FINAL. A `SETTLED_CHAIN_STATE` label is not a transfer receipt proof. The preflight is advisory; it is not a contract execution result. REQUEST/EXECUTE and FINAL settlement for a new user are blocked until a separately reviewed cloud executor exists.

## Free-tier decision

- **Cloudflare Workers + D1:** one HTTPS origin, static assets, durable SQL, Ed25519 WebCrypto verification, and outbound NEAR RPC. Free limits currently include 100,000 Worker requests/day, 10 ms CPU/request, 50 subrequests/request; D1 includes 5 million rows read/day, 100,000 rows written/day, 5 GB account storage, and 500 MB per database. Exceeding enforced limits can stop requests. The existing Windows Rust/DPAPI signer cannot be copied into a Worker. A cloud executor needs a new custody and atomic nonce design and separate security review.
- **Vercel Hobby + external storage:** Functions have no bundled durable database. Hobby is for personal, noncommercial use, so it is a poor default for a public product. An external database adds another service and operational boundary.
- **Render Free:** web service sleeps after inactivity and its filesystem is ephemeral. Free Postgres expires after 30 days and lacks backups. SQLite here would not be durable across restarts.

Official conditions: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [D1 limits](https://developers.cloudflare.com/d1/platform/limits/), [Workers WebCrypto](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/), [Vercel Hobby](https://vercel.com/docs/plans/hobby), [Vercel Functions](https://vercel.com/docs/functions/limitations), [Render Free](https://render.com/docs/free).

## Release checklist — every external mutation requires separate owner approval

1. Review the exact source diff, Vite lockfiles, `worker.mjs`, `schema.sql`, `migrations/0001_initial.sql`, and `wrangler.toml`. Build the production app and confirm no `mock-meteor` asset.
2. Independently review Cloudflare Free account terms, quotas, privacy, default `workers.dev` hostname and Worker access. Wrangler is pinned for a supported Ubuntu runner. No paid plan or automatic deploy on push.
3. Verify the owner-provided `agentshield-lite` name/UUID remotely in a read-only step. Separately approve the first versioned D1 migration, then check all four tables and D1 persistence after a Worker restart. No new D1 creation is needed.
4. Approve the exact HTTPS hostname and deployment of static assets plus read-only Worker. Verify `/`, `/app`, `/mvp-api/health`, CSP/security headers, and same-origin API in a real browser. Verify NEP-413 login, owner isolation, challenge replay denial, policy preflight, wallet-created Vault, deposit, recipient policy, authorization, revoke, withdrawal, and transaction explorer links with independent FINAL RPC evidence.
5. Configure `SHARED_EXECUTOR_ACCOUNT` and `SHARED_EXECUTOR_PUBLIC_KEY` only after approving an existing bounded FunctionCall key and verifying its on-chain permissions. No historical key is selected automatically. This still does not enable autonomous execution.
6. Before claiming the full MVP, separately design and approve cloud restricted-key custody, atomic nonce allocation, durable one-shot journal, restart recovery, rate limits, RPC reconciliation, and real public A/B browser-to-chain FINAL settlement. Do not add FullAccess custody to this Worker.

Local checks: `node --test deploy/cloudflare/worker.test.mjs`, `node --check deploy/cloudflare/worker.mjs`, `npm.cmd test`, `npm.cmd run build`, mocked Playwright, backend/contract regression, secret scan, and `git diff --check`. The Worker tests use an in-memory D1 fake and mocked RPC; live D1, Cloudflare CPU behavior, public Meteor integration, and Testnet settlement remain unverified.

## Workers.dev + Vercel Lite release gate (prepared, not executed)

The release candidate serves the canonical wallet application at `https://near-agentshield-arena.vercel.app/app/`; the current public `/app` returned 404 before deployment. The Worker can also serve `/app` at `https://agentshield-arena-candidate.<owner-subdomain>.workers.dev/app`. The Vercel app reaches `/mvp-api` directly through the public build variable `VITE_AGENTSHIELD_WORKER_URL` once the Worker is deployed. **CORS allows only the exact Vercel production origin and the Worker's own origin**; other origins are denied. NEP-413 challenges and sessions bind to the caller's accepted origin. With no Worker URL, the Vercel app still supports owner wallet actions through NEAR RPC and marks cloud API unavailable. Vercel Hobby may only be used for a personal, noncommercial showcase under its current terms.

Worker security gates: one-time D1 challenge claim, finalized FullAccess owner key plus Ed25519 proof, owner-scoped sessions/history, hashed-IP D1 limits (90 API requests/minute and 6 authentication requests/minute), lazy removal of rate rows older than one day, exact Vercel-origin CORS with same-origin Worker access, CSP/HSTS/frame/referrer/content-type/permissions headers, and a 503 `RPC_UNAVAILABLE` response without upstream error detail. Unknown payment routes return `CLOUD_EXECUTOR_DISABLED`; there is no signing key or broadcast route. Local SQL compatibility and synthetic Worker tests do not establish actual D1/workerd behavior or Free CPU consumption.

### Existing D1 and supported cloud execution path

The owner reports an existing Cloudflare D1 named `agentshield-lite` with UUID `7de64b16-19fd-4c65-85d9-458e6be4ce01`. `wrangler.toml` now binds that exact database as `DB`; no new D1 creation command is needed. The ID is public configuration, not a credential. Actual remote identity, schema and account plan have **not** been queried. `schema.sql` and `migrations/0001_initial.sql` are byte-identical. Wrangler's versioned migration ledger prevents accidental reapplication; this first migration creates four tables with SQLite-compatible DDL. The preflight checks name, UUID, migration file, real assets and absence of the mock bundle.

This Windows 10 host is not a supported current Wrangler runtime. The prepared `.github/workflows/cloudflare-lite-release.yml` uses GitHub-hosted Ubuntu 24.04 and locked Wrangler 4.162.0. It has **manual `workflow_dispatch` only** and three operations:

1. `check`: install pinned dependencies, run the Lite frontend owner/wallet tests and Worker/SQLite SQL tests, apply the migration to an **ephemeral local D1** on Ubuntu and query its four tables, build production Vercel/Worker assets, scan secrets, run preflight and `wrangler deploy --dry-run`. No Cloudflare credentials or remote mutation. The local-only backend and protected signer are outside this Lite workflow. This job has not yet run.
2. `migrate`: only after the separate `cloudflare-d1-migrate` environment approval and exact `MIGRATE_D1` confirmation; verify remote D1 name/UUID, apply `0001_initial.sql` through `wrangler d1 migrations apply agentshield-lite --remote`, then query all four tables. Wrangler skips its prompt in CI and captures a migration backup.
3. `deploy`: only after the separate `cloudflare-worker-deploy` environment approval and exact `DEPLOY_WORKER` confirmation; verify remote D1 identity and all four tables, rebuild real assets, then deploy the read-only Worker to `workers.dev`.

There is no Git remote in this checkout. The workflow cannot run until the owner separately authorizes repository publication and configures protected GitHub environments with required reviewers. Set `CLOUDFLARE_ACCOUNT_ID` and a narrowly scoped `CLOUDFLARE_API_TOKEN` as GitHub environment secrets; never store either in Git, Vite variables or workflow inputs. For migration the token needs D1 Edit; for first Worker creation it needs Workers Admin, then Workers Editor for later deploys. `workers.dev` needs no zone Route or custom-domain permission. Confirm Workers/D1 **Free** plan and runner quota before use.

The equivalent exact commands on a separately supported Linux host, **only after the matching owner approval**, start in the repository root:

```bash
npm ci --prefix app
npm ci --prefix deploy/cloudflare
node --test deploy/cloudflare/worker.test.mjs deploy/cloudflare/verify_d1_identity.test.mjs
python -m unittest deploy.cloudflare.test_d1_local -q
npm run build:showcase --prefix app
python tools/scan_public_secrets.py
python deploy/cloudflare/preflight.py
cd deploy/cloudflare
npx --no-install wrangler d1 migrations apply agentshield-lite --local --config wrangler.toml
npx --no-install wrangler deploy --dry-run --config wrangler.toml
npx --no-install wrangler d1 info agentshield-lite --json --config wrangler.toml | node verify_d1_identity.mjs
npx --no-install wrangler d1 migrations apply agentshield-lite --remote --config wrangler.toml
npx --no-install wrangler d1 execute DB --remote --command "SELECT 1 FROM challenges LIMIT 0" --config wrangler.toml
npx --no-install wrangler d1 execute DB --remote --command "SELECT 1 FROM sessions LIMIT 0" --config wrangler.toml
npx --no-install wrangler d1 execute DB --remote --command "SELECT 1 FROM observed_payments LIMIT 0" --config wrangler.toml
npx --no-install wrangler d1 execute DB --remote --command "SELECT 1 FROM rate_limits LIMIT 0" --config wrangler.toml
npx --no-install wrangler deploy --config wrangler.toml
```

Run the remote migration and Worker deploy as separate reviewed operations, not as one pasted sequence. Before migration, inspect the current D1 table list and create a reviewed D1 export/backup. After migration, verify `d1_migrations` records `0001_initial.sql`. D1 changes are **not** rolled back by Worker rollback. None of the remote commands above were executed here.

For Vercel, set `VITE_AGENTSHIELD_WORKER_URL=https://agentshield-arena-candidate.<owner-subdomain>.workers.dev` in the build environment only after the actual Worker URL is returned and checked. A malformed URL fails `build:showcase`; a missing URL is allowed so the Vercel `/app/` owner wallet flow works while cloud-only features show unavailable. Vercel root is `app/`; `build:showcase` builds the real MVP app and the existing landing into `dist-showcase` without requiring local runtime artifacts. No `/mvp-api` rewrite or client secret is needed.

### Rollback and public E2E

Record the Worker version ID and a D1 export before release. To revert Worker code/assets, use `npx wrangler rollback <PREVIOUS_VERSION_ID> --config wrangler.toml` after reviewing the target version. This leaves D1 unchanged; revert schema only from a reviewed backup/migration. Revert the Vercel showcase to its previous deployment or restore its previous `VITE_AGENTSHIELD_WORKER_URL` and rebuild. A previous browser page may retain newer asset URLs, so verify a fresh browser load after rollback.

Public checks on the actual `workers.dev` URL: `/`, `/app`, `/mvp-api/health`; HTTPS/CSP/HSTS and no CORS wildcard; D1 persistence across Worker restart; challenge replay, wrong Origin and wrong owner denial; Meteor Testnet connect/disconnect; owner A and B Vault creation with initial limits and exact wallet prompts; deposit; independent FINAL policy/balance/transaction receipt verification and explorer links; recipient policy, authorization, revoke and withdrawal if the existing contract permits each; RPC outage shown as unavailable; signing routes denied. Verify a new user's receipt graph, transfer and callback separately from the historical showcase proof. **PRODUCT READY remains NO until that public E2E is captured.**
