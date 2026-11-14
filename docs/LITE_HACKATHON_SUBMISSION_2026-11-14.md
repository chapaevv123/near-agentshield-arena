# AgentShield Arena Lite — submission preparation

**Status: local draft, not posted or submitted. PRODUCT READY = NO until a new public Meteor-to-Vault FINAL E2E.** The [official organizer instructions](https://nearhackathon.com/HACKATHON.md) were read on 2026-11-14; reread them immediately before submission. Deadline: 2026-11-14 23:59 UTC. PR #1 is open and its check passed; `/app/` has not been verified on the public deployment.

## Judge route and evidence

1. After the approved Vercel deployment, open https://near-agentshield-arena.vercel.app and choose **Launch App**. Confirm `/app/` loads from the public origin, not a local preview. Before that deployment, use the public landing only for the explicitly historical proof.
2. Connect a Meteor **Testnet** account. Show the connected account ID and cloud API status. A missing Worker must be shown as unavailable.
3. If this owner has no Vault, set initial spending limits and confirm `create_vault` in Meteor. Show its exact transaction hash, FINAL state and Testnet Explorer page. If the Vault exists already, show its current FINAL state and continue.
4. Confirm `deposit` in Meteor. Refresh the real balance and policy, then open the FINAL deposit transaction in Explorer.
5. Set an allowed recipient with owner confirmation. Enter a payment and run **Judge Demo**. Show the ALLOW/DENY explanation and contract link. Say that this is a read-only estimate, not an on-chain rejection or agent payment.
6. If useful, demonstrate a supported owner revoke or withdraw with a separate wallet confirmation and FINAL receipt. Do not claim autonomous REQUEST/EXECUTE in Lite.

If a real transaction is cancelled, RPC is unavailable or the receipt remains UNKNOWN, record the truthful state and stop. A historical payment may be shown separately, labeled **historical**.

## Record a short real video

Target 60–90 seconds. Record the public URL and browser address bar, the Meteor account connection, one actual owner wallet confirmation, the resulting FINAL Vault balance/policy and the exact Explorer receipt. Keep transaction hashes legible. Hide recovery phrases, private keys, wallet settings, personal notifications and local backend screens. Record only after the owner separately authorizes any Testnet spending or signing. Do not splice a mocked browser test into the live journey.

Suggested voiceover: “An AI agent should never receive unrestricted wallet access. AgentShield Arena uses a shared NEAR Testnet Vault with owner-set spending limits and recipient policy. I connect Meteor, create and fund my Vault, inspect FINAL chain state, and check a proposed payment against the current policy. The check is advisory; the contract enforces policy during real transactions. Public autonomous agent execution is not available in Lite. This transaction hash opens its FINAL receipt on Testnet Explorer.”

## Submission text and track

**Primary track:** `security` (AI Security & Defense). **Secondary `agents`:** omit for this Lite submission unless a public agent-controlled payment flow is separately confirmed. The historical restricted-agent settlement can be described as historical evidence, not as a new user's live agent execution.

**Project description draft:** AgentShield Arena addresses unsafe AI-agent spending with a shared NEAR Testnet policy Vault. The owner workspace is designed for Meteor wallet confirmation of Vault creation, deposits, spending limits, recipient policy and exact payment authorization. It reads FINAL chain state and shows exact receipt hashes. A read-only policy preflight explains an estimated ALLOW/DENY result; it does not submit a payment. A restricted FunctionCall agent completed one historical Testnet payment with independently verified FINAL receipts. Public autonomous REQUEST/EXECUTE is unavailable in Lite. The new public Meteor-to-Vault onboarding flow is pending deployment and live verification.

**X post draft for the owner to publish with the real video or screenshots:** “AI agents need spending limits, not unrestricted keys. We built AgentShield Arena at NEAR HACKATHON: a NEAR Testnet Vault for owner-set policy, Meteor wallet actions, and verifiable FINAL receipts. Try the public demo: https://near-agentshield-arena.vercel.app — source: https://github.com/chapaevv123/near-agentshield-arena. What policy check would you want before an agent pays? @NEARProtocol #NEARHackathon”

The owner must publish the X post with the actual video or screenshots and provide its public URL. Before one submission, the owner decides the project name, team lead name, contact email, team size (`1`, `2 - 4`, `4 - 6`, `6 - 8`, or `8+`), tracks, **mainnet** NEAR payout account, public repository URL and X demo-post URL. The owner must agree to this exact notice: “I agree that the organizers may use these details to review our submission and contact us about this hackathon.” Do not infer personal values from Git commits, generate a wallet, or submit without the owner's explicit review of the complete JSON payload. Generate and retain one requestId only when assembling that payload; reuse it for any retry. The form accepts one submission per project. The API payload must contain only `requestId`, `projectName`, `leadName`, `email`, `size`, `tracks`, `nearAddress`, `projectUrl`, `demoUrl`, `idea`, and `consent`; never include `website`.

The official instructions allow a Testnet-only project and ask for a public repository with reproducible judge steps. They recommend a LICENSE file; the repository currently has no approved license. The primary `security` track matches spending limits, policy controls and restricted FunctionCall keys. Add `agents` only if the owner chooses to emphasize the independently verified historical agent payment and labels the public Lite execution limit clearly. Other tracks have no demonstrated fit in this release.
