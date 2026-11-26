# 12 Root cause analysis

> Audit date 2026-11-25. Local staging only (Docker, 127.0.0.1). No production data, source code or schema was changed. Commit fe2ef09 plus the uncommitted quantity display fix.

## RC1: Permission is checked by screens, not by the database functions
**Shared fix:** One shared rule map and one check at the top of each function; matching read policies.

**Issues:** SEC-01, SEC-03

## RC2: Tables stay open for direct writes after posting
**Shared fix:** One reusable guard trigger on every posted document table.

**Issues:** SEC-02, SEC-04, SEC-05, SEC-06

## RC3: Server trusts values that the screen computed
**Shared fix:** Re-derive and check amounts, limits, dates and links inside the posting functions, with row locks.

**Issues:** PAY-01, PAY-02, PUR-02, PUR-05, SAL-02, SAL-05, INV-01, ACC-01, ACC-02, ACC-04, ACC-05, BNK-02, HR-01, GEN-01

## RC4: Cost flow is incomplete for corrections
**Shared fix:** One costing routine for price variance, returns, damage and no-cost sales, agreed in Doc 3.

**Issues:** PUR-01, SAL-01, SAL-04, POS-02, INV-02

## RC5: Workflow built for the normal path only
**Shared fix:** Add states, tolerances and cancellation paths.

**Issues:** PUR-03, PUR-04, SAL-03, POS-01, INV-04, PUR-06, BNK-01, DOC-01, DOC-02

## RC6: Module not built
**Shared fix:** Plan as new modules, each with its own approval.

**Issues:** INV-03, BNK-03, HR-02, HR-03, RPT-07, SO-01, PR-01

## RC7: Each report has its own query over documents or ledger
**Shared fix:** One tested set of facts (sales, purchases, tax, party balances), each tied to the ledger by a test.

**Issues:** ACC-03, ACC-06, RPT-01, RPT-02, RPT-03, RPT-04, RPT-05, RPT-06

