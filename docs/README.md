# StockBolt v1 — Planning Documentation

This folder contains the complete planning documentation for StockBolt v1, an auto parts ERP for the GCC + India market.

**These documents are the contract for what gets built.** Every implementation decision must trace back to one of them. If a discrepancy emerges between the docs and the code, the docs win unless updated explicitly.

---

## Read In This Order

For a first-time read, go through the documents in numerical order:

1. **Document_1_Module_Map.md** — What gets built (every screen, page, module)
2. **Document_2_Database_Schema.md** — Where data lives (48 tables fully specified)
3. **Document_3_Accounting_Rulebook.md** — The exact GL recipe for every transaction (38 types)
4. **Document_4_Reports_Spec.md** — Every report and how it's calculated (38 reports + 9 invariants)
5. **Document_5_Build_Phases.md** — The build sequence with pass/fail tests (13 phases)
6. **AGENTS.md** — The rulebook Claude Code follows on every session

Plus:
- **CURRENT_PHASE.md** — Live status file showing which phase is active right now

---

## How To Use During Build

| Question | Look in |
|---|---|
| What pages does v1 have? | Document 1 |
| What columns does table X have? | Document 2 |
| What's the journal entry for transaction X? | Document 3 |
| How is report X calculated? | Document 4 |
| What should I be working on right now? | CURRENT_PHASE.md + Document 5 |
| Is action X allowed in the codebase? | AGENTS.md |

---

## When To Update These Docs

Documents stay current with code. If during implementation you discover:

- A schema change is needed → update Document 2 in the same commit
- A new transaction type → update Document 3 in the same commit
- A new report → update Document 4 in the same commit
- A phase scope change → update Document 5 in the same commit
- An architectural decision → update AGENTS.md in the same commit

**Documentation drift is forbidden.** Per AGENTS.md Section 11.4, if Claude Code discovers a doc is wrong, it must STOP and propose an update before continuing.

---

## File Status

All documents are at version 1.0 as of project start. Significant updates will be tracked in git history. Major revisions will get versioned (e.g., `Document_2_Database_Schema_v1.1.md`).

---

## Cross-References

The documents reference each other heavily. Common cross-references:

- Doc 3 references Doc 2 for table/column names
- Doc 4 references Doc 2 (tables) and Doc 3 (source types)
- Doc 5 references Doc 1 (modules), Doc 3 (postings to test), and Doc 4 (reports to build)
- AGENTS.md references all of the above

When reading any one document, expect to flip to others for full context.
