# Demo and submission drafts — owner review

## 75-second demo script and shot order

| Time | Screen | Narration |
| --- | --- | --- |
| 0–10s | Hero and payment card | “AI agents can pay, but owners need control. AgentShield Arena binds payments to owner-approved Vault policy on NEAR.” |
| 10–22s | How it works cards | “The owner authorizes an exact scope. A restricted agent requests payment. The Vault settles only under its policy.” |
| 22–45s | Interactive proof tabs | “This is one real completed 0.001 NEAR Testnet payment. Open its authorization, request and execute transactions; these are actual hashes.” |
| 45–58s | Execute tab and receipts | “FastNear and Intear independently verified FINAL settlement, including transfer and callback receipts. The backend task is completed.” |
| 58–68s | Security section | “Limits, recipient restrictions, a narrow FunctionCall key, durable one-shot claims and protected signing constrain agent action.” |
| 68–75s | Footer and limitations | “This public site is a read-only proof. Protected operations stay local; no wallet connection or new payment is implied.” |

Record only the public showcase, the exact explorer pages, and safe public evidence. Avoid local owner sessions, logs, journals or backend screens that may reveal secrets. Use [desktop](screenshots/desktop.png) and [mobile](screenshots/mobile.png) captures for the submission. No video has been recorded or posted.

## Short project description

AgentShield Arena is a policy-bound payment system for AI agents on NEAR Testnet. Owners authorize exact payment scopes; a restricted agent key requests and executes through a shared Vault; independent FINAL receipt checks and an audited backend verify settlement. A real 0.001 NEAR payment is complete and publicly inspectable.

## Submission description

AgentShield Arena addresses the security gap between AI agent autonomy and financial authority. Instead of handing an agent unrestricted funds, the owner sets Vault policy and authorizes a specific payment. The agent operates with a restricted FunctionCall key that can call only payment methods. The Vault enforces amount and recipient restrictions. A protected native signer, durable transaction claims and fail-closed reconciliation reduce duplicate or uncertain execution risk.

The public demo walks judges through an actual 0.001 NEAR Testnet payment from `safeibis9110.testnet` to `soundestate8404.testnet` under policy v4. The three real on-chain transactions are linked, and two independent RPCs confirmed the FINAL transfer and callback receipts. The local backend records the task as COMPLETED. The showcase is deliberately read only; live public wallet onboarding and signing are not claimed.

Recommended primary track: **AI Security & Defense**, because the product constrains and audits autonomous payment authority. The [official hackathon page](https://near.army/) allows one project to select multiple fitting tracks. **Agent Economy** is a reasonable secondary fit because the restricted agent completed a real payment, though the public demo is read only and broader agent commerce is not claimed.

## English X post draft — do not publish automatically

AI agents need payment rails with boundaries. AgentShield Arena lets an owner authorize an exact NEAR Testnet payment, while a restricted agent requests and executes under Vault policy. We completed a real 0.001 NEAR payment with three public txs and two independent FINAL verifiers. Read-only demo and source links will be added after release. @NEARProtocol #NEARHackathon

No prize, ranking, public URL or endorsement is claimed. The owner must review and publish any post or submission.
