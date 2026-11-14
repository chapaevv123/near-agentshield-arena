# AgentShield Arena Lite — submission preparation

**Status: draft, not posted or submitted. PRODUCT READY = NO for a new payment.** The [official organizer instructions](https://nearhackathon.com/HACKATHON.md) were reread on 2026-11-14; deadline: 2026-11-14 23:59 UTC. The manual payment UI is built in a Vercel Preview that requires Vercel Authentication. A new Meteor payment, FINAL hash and receipts have not been observed. The public Production `/app/` and GitHub `main` still need release verification.

## Judge route and evidence

1. Without signing, open the [protected Preview `/app/`](https://near-agentshield-arena-67n5ofb6f-chapaevv123s-projects.vercel.app/app/) after Vercel sign-in. Inspect the fixed 0.001 NEAR manual payment panel. The public landing shows a separate historical settlement. A public judge cannot use a protected Preview without access.
2. If the owner separately approves live signing, connect `openroom8315.testnet` in Meteor Testnet and verify the displayed account. Switch to owner `safeibis9110.testnet` and inspect its fresh FINAL Vault, grant, recipient and policy. Do not create a new Vault for the agent account.
3. Owner signs **Renew Agent Grant**, then **Authorize 0.001 NEAR** for one new ID and recipient `soundestate8404.testnet`. Each prompt is separate; authorization is not settlement.
4. Switch Meteor to `openroom8315.testnet`. Agent signs **Request Payment**, verifies FINAL, then signs **Execute Payment**. The app must verify the exact FINAL transaction and transfer/callback receipts on two RPCs before showing `FINAL SETTLED` and Explorer links.
5. If the above has not actually happened, show only the [historical proof](TESTNET_PROOF_2026-11-13.md), clearly labeled historical. A read-only Judge Demo ALLOW/DENY estimate is not a payment.

If a real transaction is cancelled, RPC is unavailable or the receipt remains UNKNOWN, record the truthful state and stop. A historical payment may be shown separately, labeled **historical**.

## Record a short real video

Target 60–90 seconds. Record a real public URL and address bar, both Meteor account IDs if available, the separate owner and agent prompts, and exact FINAL Explorer receipts. If the public route is unavailable or a live payment is not complete, record the historical proof with that label instead. Keep hashes legible; hide recovery phrases, private keys, wallet settings, personal notifications and local backend screens. Record only after the owner separately authorizes Testnet signing. Do not splice a mocked browser test into the live journey.

Suggested voiceover only after a real new payment: “AgentShield Arena uses a shared NEAR Testnet Vault with an owner grant, recipient allowlist and exact payment authorization. I confirm the owner steps in Meteor, then switch to the agent account for REQUEST and EXECUTE. The Vault enforces the policy. These hashes and transfer/callback receipts show the FINAL result.” If no new payment is completed, describe the same path as a tested Preview candidate and show the historical proof separately.

## Submission text and track

**Primary track:** `security` (AI Security & Defense). **Secondary `agents`:** decide only after reviewing the historical restricted-agent settlement and honest public-demo limits. The current manual Meteor route is not autonomous agent execution.

**Project description draft:** AgentShield Arena addresses unsafe AI-agent spending with a shared NEAR Testnet policy Vault. The Meteor workspace lets a Vault owner inspect FINAL balance and policy, set an expiring agent grant and authorize an exact payment. A manual Preview route asks the agent's Meteor account to request and execute a fixed 0.001 NEAR payment, with one-use ID and independent FINAL receipt checks. One earlier restricted-key payment settled on Testnet with public transaction hashes; it is labeled historical. The new manual payment has not been signed or settled, and autonomous cloud execution remains unavailable.

**X post draft for the owner to publish with a real video or screenshots:** “AI agents need spending limits. We built AgentShield Arena at NEAR HACKATHON: a Testnet Vault with owner policy and Meteor wallet actions. The public landing shows a historical FINAL payment; the new manual payment is pending. Source: https://github.com/chapaevv123/near-agentshield-arena. What policy would you check first? @NEARProtocol #NEARHackathon”

The owner must publish the X post with the actual video or screenshots and provide its public URL. Before one submission, the owner decides the project name, team lead name, contact email, team size (`1`, `2 - 4`, `4 - 6`, `6 - 8`, or `8+`), tracks, **mainnet** NEAR payout account, public repository URL and X demo-post URL. The owner must agree to this exact notice: “I agree that the organizers may use these details to review our submission and contact us about this hackathon.” Do not infer personal values from Git commits, generate a wallet, or submit without the owner's explicit review of the complete JSON payload. Generate and retain one requestId only when assembling that payload; reuse it for any retry. The form accepts one submission per project. The API payload must contain only `requestId`, `projectName`, `leadName`, `email`, `size`, `tracks`, `nearAddress`, `projectUrl`, `demoUrl`, `idea`, and `consent`; never include `website`.

The official instructions allow a Testnet-only project and ask for a public repository with reproducible judge steps. They recommend a LICENSE file; the repository currently has no approved license. The primary `security` track matches spending limits, policy controls and restricted FunctionCall keys. Add `agents` only if the owner chooses to emphasize the independently verified historical agent payment and labels the public Lite execution limit clearly. Other tracks have no demonstrated fit in this release.
