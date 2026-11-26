# 08 Inventory audit

> Audit date 2026-11-25. Local staging only (Docker, 127.0.0.1). No production data, source code or schema was changed. Commit fe2ef09 plus the uncommitted quantity display fix.

| Check | Result | Evidence |
|---|---|---|
| Partial and full receipt quantities | Pass | 60 then 100 |
| Transfer conserves quantity and value | Pass | Total 100, warehouse 2 = 20, 1300 unchanged |
| Transfer above stock refused | Pass | D8 |
| Oversell refused | Pass | D14 |
| Two simultaneous sales of the last stock | Pass | One accepted, 0 left |
| Five simultaneous confirms of one invoice | Pass | One journal |
| Purchase return limit | Pass | D7, D7b |
| Customer return limit | Pass | D18 |
| Void restores stock | Pass | D20 |
| Repack and packs | Pass | 10 KG to 10 packs, 10 Box = 100 PCS |
| Damaged return | Fail | D17r |
| Stale count | Fail | D9 |
| Price difference on GRN bill | Fail | D2 |
| Cost at 2 decimals | Minor | E4 |

| ID | Severity | Type | Problem | Evidence |
|---|---|---|---|---|
| PUR-01 | P1 | Confirmed defect | A bill priced differently from its goods receipt changes account 1300 but not stock value. | D2, E2, E3 (E1) |
| PUR-02 | P1 | Confirmed defect | The same goods receipt can be billed twice. | D3 |
| PUR-03 | P2 | Confirmed defect | A purchase order becomes Received at the first partial receipt, so the rest disappears from Outstanding POs. | C5.5 |
| PUR-04 | P2 | Confirmed defect | More than ordered can be received without warning. | D1 |
| PUR-05 | P2 | Design limitation | Same supplier bill number accepted twice by the server (screen only warns). | D4 |
| SAL-01 | P1 | Confirmed defect | A damaged return goes back into sellable stock at full value; the write-off only moves the amount from 5100 to 6700. | D17r |
| SAL-02 | P1 | Confirmed defect | Invoice header total is not checked against its lines. | D31b, D31 |
| SAL-03 | P2 | Design limitation | Credit limit only warns on screen. | D15 |
| SAL-04 | P2 | Potential risk | A credit note line without cost restocks at zero cost. | C7.13 |
| SAL-05 | P2 | Confirmed defect | A deactivated product can still be invoiced. | D28b |
| POS-01 | P1 | Confirmed defect | Cash/card sale without a customer fails. | C7.1c |
| POS-02 | P2 | Confirmed defect | POS sale of an item without cost leaves stock unchanged (found 2026-11-24, not retested). | Memory: costing findings 2026-11-24 |
| INV-01 | P2 | Confirmed defect | A count saves the difference from the quantity seen at entry, not the current quantity. | D9 |
| INV-02 | P3 | Design limitation | Average cost is kept to 2 decimals: 3 units for 10.00 value at 9.99. | E4, E2 |
| INV-03 | P2 | Missing feature | No stock reservation and no available-versus-on-hand. | Schema review |
| INV-04 | P2 | Missing feature | No void for transfers, adjustments or goods receipts. | V-* |
| PUR-06 | P2 | Design limitation | No Void for bills: a bill is reopened and the draft deleted, losing its number and trail. | V-void_vendor_bill |
