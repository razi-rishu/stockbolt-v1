# 11 ERP gap analysis

> Audit date 2026-11-25. Local staging only (Docker, 127.0.0.1). No production data, source code or schema was changed. Commit fe2ef09 plus the uncommitted quantity display fix.

| ID | Gap | Impact | Suggested size |
|---|---|---|---|
| INV-03 | No stock reservation and no available-versus-on-hand. | Overselling between order and delivery. | Medium |
| INV-04 | No void for transfers, adjustments or goods receipts. | Mistakes need opposite documents. | Medium |
| BNK-03 | No bank statement import or auto-matching. | Manual ticking. | Medium |
| HR-02 | The loans table exists, but there is no screen and no posting to 1450. | Advances kept outside the ERP. | Medium |
| HR-03 | No attendance, leave requests, leave policy or payroll approval; leave salary payout only. | Manual HR. | Large |
| RPT-07 | No branch performance or payroll report. | No branch view. | Medium |
| SO-01 | sales_orders tables exist, but no screen; no delivery note, partial delivery or reservation. | Distribution flow incomplete. | Large |
| PR-01 | No purchase request, supplier quotation or comparison. | Done outside. | Medium |

Also absent or limited by design: foreign-currency posting (ACC-05), bad-debt workflow, budgets, batch and expiry tracking, bins, stock-take documents, price levels on documents, landed cost on GRN. Approval rules exist but are off until configured.
