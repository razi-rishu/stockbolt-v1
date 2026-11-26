# 05 Test execution results

> Audit date 2026-11-25. Local staging only (Docker, 127.0.0.1). No production data, source code or schema was changed. Commit fe2ef09 plus the uncommitted quantity display fix.

| Result | Count |
|---|---|
| FAIL | 63 |
| PASS | 107 |

| Test | Scenario | Result | Observed |
|---|---|---|---|
| C1.1 | Register business through onboarding | PASS |  |
| C1.1b | Second company (isolation control) | PASS |  |
| C1.2 | Second branch | PASS |  |
| C1.3 | Second warehouse in second branch | PASS |  |
| C1.4 | Bank and cash accounts | PASS |  |
| C1.5-accountant | Add user accountant by invite + accept | PASS |  |
| C1.5-sales | Add user sales by invite + accept | PASS |  |
| C1.5-counter | Add user counter by invite + accept | PASS |  |
| C1.5-viewer | Add user viewer by invite + accept | PASS |  |
| C1.6 | Custom role warehouse + purchasing | PASS |  |
| C1.7-wh | Add custom-role user wh | PASS |  |
| C1.7-pu | Add custom-role user pu | PASS |  |
| C3 | Three suppliers | PASS |  |
| C7.1 | Five customers, one with credit limit 500 | PASS |  |
| C4.1 | Categories with subcategory | PASS | id,company_id,parent_id,name,name_ar,sort_order,is_active,created_at,updated_at,icon,image_url,description,description_ar,external_source,external_ref |
| C4.2 | Twenty products | PASS |  |
| C4.3 | Opening stock 2 products | PASS |  |
| C3.2 | Opening balances: bank, supplier, customer | PASS |  |
| C3.3-ar_owed | Opening balance ar_owed | PASS |  |
| C3.3-ap_owed | Opening balance ap_owed | PASS |  |
| C3.3-customer_credit | Opening balance customer_credit | PASS |  |
| C3.3-vendor_credit | Opening balance vendor_credit | PASS |  |
| C5.4 | Purchase order 100 x P03 @8 | PASS |  |
| C5.5 | Partial goods receipt 60 | FAIL | 2150=-480 qty=60 PO=received |
| C5.6 | Complete goods receipt 40 | PASS | qty=100 PO=received |
| D1 | Over-receipt: 30 more than ordered | FAIL | ALLOWED {"h":{"id":"<id>","company_id":"c2831e5c-7de4-4c |
| C5.7 | Supplier invoice for GRN1 (60 x 8) | PASS | 2150=-560 2100=-1504 1300=2317.5 |
| D2 | Supplier invoice price differs from GRN (40 x 9 vs 8) | FAIL | 2150=-240 1300=2357.5 subledger=2317.5 |
| D3 | Same GRN billed twice | FAIL | ALLOWED null |
| D4 | Duplicate supplier invoice number S-1 same supplier | FAIL | ALLOWED null |
| C5.7b | Direct bill P04 50@4, P05 30@7.333 | PASS |  |
| D5 | Confirm the same bill twice | PASS | refused: confirm_vendor_bill: confirm_vendor_bill: bill <id> not in draft (status=confirmed) |
| C5.8 | Supplier part payment 200 | PASS |  |
| D6 | Overpay: allocate 10,000 to a 504 bill | FAIL | ALLOWED null |
| C5.10 | Purchase return 5 x P04 | PASS | qty 46 |
| D7 | Return more than bought (200 x P04) | PASS | refused: confirm_debit_note: confirm_debit_note: returning 200.000 of "x" but only 45.000 remain returnable on that bill line |
| D7b | Return 46 of 45 left from bill of 50 (already 5 returned) with stock allowed from bill limit | PASS | refused: confirm_debit_note: confirm_debit_note: returning 20.000 of "x" but only 10.000 remain returnable on that bill line |
| C6.2 | Transfer 20 P01 between branches/warehouses | PASS | w2=20 GL unchanged=true |
| D8 | Transfer more than held (500) | PASS | refused: confirm_stock_transfer: Not enough stock for P01 (transfer_out): 80.000 available, 500.000 requested. Enable "Allow backorders" in Settings to overrid |
| C6.7 | Damaged stock -2 | PASS | 6700=20 |
| C6.9 | Physical count +1 (found) | PASS | 4300=-10 |
| D9 | Stale count: system_qty saved 79 but stock moved to 79+0; client claims 10 | FAIL | stock now 81 (count said 12, system 79) |
| C7.3 | Quotation | PASS |  |
| C7.9 | Sales invoice 10 P01 @20 | PASS | COGS 100 2200=-10 |
| C7.10 | Partial customer payment 100 | PASS |  |
| C7.11 | Full payment of remaining 110 | PASS |  |
| D10 | Duplicate payment of a paid invoice | FAIL | ALLOWED null |
| D11 | Two drafts 210 on same invoice confirmed concurrently | FAIL | fulfilled  / fulfilled  |
| D12 | Same invoice confirmed concurrently x5 | PASS | ok=1 JEs=1 |
| D13 | Two sales of last stock concurrently (P05 stock) | PASS | started 10, left 0, ok=1 |
| D14 | Negative stock: sell 9999 of P04 | PASS | refused: confirm_invoice: Not enough stock for P04 (sale): 46.000 available, 9999.000 requested. Enable "Allow backorders" in Settings to override. |
| D15 | Customer over credit limit 500 (invoice 2100) | FAIL | ALLOWED null |
| D16 | Duplicate invoice number | PASS | refused: invoices: duplicate key value violates unique constraint "invoices_company_id_invoice_number_key" |
| D18 | Return more than invoiced (50 of 10) | PASS | refused: confirm_credit_note: confirm_credit_note: crediting 50.000 of "x" but only 7.000 remain returnable on that invoice line |
| D19 | Payment reversed (void) | PASS | AR +110 |
| D20 | Sales invoice cancelled restores stock | PASS | 71 -> 71 |
| D20b | Void an invoice that has payments | FAIL | ALLOWED {"invoice_id":"<id>","invoice_number":"INV-A121" |
| D21 | Customer advance then apply | PASS | 2400 -1500 -> -1395 |
| C7.13r | Sales return with cost as the screen sends it | PASS | COGS -19.41 |
| D17r | Damaged customer return with cost | FAIL | stock 77->78 6700 +9.7 |
| C7.15r | Credit refund after paid invoice | PASS |  |
| D20c | Void invoice with a confirmed payment: allocation and AR state | FAIL | voided; allocations left 1, payment confirmed/against_invoice/full |
| C8.8 | Journal voucher balanced | PASS |  |
| D22 | Unbalanced journal | PASS | refused: post_journal_entry: post_journal_entry: entry does not balance (debit=50.00, credit=40.00) |
| D22b | Unbalanced by 0.01 | PASS | refused: post_journal_entry: new row for relation "journal_entries" violates check constraint "journal_entries_check" |
| D23 | Manual journal to AR without customer | FAIL | ALLOWED {"entry_number":"JE-1065","journal_entry_id":"b08d8c3b-a353-4e33-bb56-eb3ee1d26a |
| D23b | Manual journal direct to Inventory 1300 | FAIL | ALLOWED {"entry_number":"JE-1066","journal_entry_id":"c69352e7-ce7f-4803-9443-1a3b25bb50 |
| D23c | Manual journal labelled sales_invoice | FAIL | ALLOWED {"entry_number":"JE-1067","journal_entry_id":"938273c0-490d-4eba-a86f-96637c4b92 |
| D23d | Negative amounts in a journal | PASS | refused: post_journal_entry: new row for relation "general_ledger" violates check constraint "general_ledger_check" |
| C8.7 | Business expense with VAT | PASS | 6300=100 |
| C10.2 | Bank to cash transfer | PASS |  |
| D24 | Transfer more cash than held (999999) | FAIL | ALLOWED "posted" |
| C10.5 | Bank reconciliation that does not agree, locked | FAIL | ALLOWED null |
| C8.9 | Fixed asset and depreciation Oct | PASS | 6750=100 |
| D25 | Depreciation twice same month | PASS | 6750=100 |
| C8.11 | Asset disposal for 900 | PASS | 1740=0 1790=0 loss=200 |
| C8.12 | Prepaid amortization | PASS | 1410=-100 |
| C2 | Five employees | PASS |  |
| C9.3 | Payroll run confirm + pay | PASS | 6100=20775 2350=-19900 2360=-875 -> 2350=0 |
| D26 | Second payroll same month | PASS | refused: payroll_runs: duplicate key value violates unique constraint "payroll_runs_company_id_period_year_period_month_key" |
| C9.8 | Employee leaves: gratuity settlement | PASS | active=false |
| C9.8b | Gratuity above accrual (500000) | FAIL | ALLOWED {"je_id":"<id>","amount":500000,"entry_number":" |
| C8.14 | Employee loan row posts to 1450 | FAIL | 1450 0->0 |
| C8.pdc | PDC received then cleared | PASS | 1250 50 -> 0 |
| D27 | USD 100 @3.67 invoice converts in GL | FAIL | AR posted 100 |
| D28 | Deactivate product with history | PASS | movements 3 |
| D28b | Invoice a deactivated service product | FAIL | ALLOWED null |
| D28c | Delete products with history | PASS | refused: update or delete on table "products" violates foreign key constraint "credit_note_items_product_id_fkey" on table "credit_note_items" |
| D28d | Delete contacts with history | PASS | refused: update or delete on table "contacts" violates foreign key constraint "credit_notes_contact_id_fkey" on table "credit_notes" |
| D28e | Delete warehouses with history | PASS | refused: update or delete on table "warehouses" violates foreign key constraint "stock_ledger_warehouse_id_fkey" on table "stock_ledger" |
| D28f | Delete chart_of_accounts with history | PASS | refused: update or delete on table "chart_of_accounts" violates foreign key constraint "general_ledger_account_id_fkey" on table "general_ledger" |
| S1 | Cross-tenant: read 20 tables of another company | PASS | clean |
| S1b | Cross-tenant insert | PASS | refused: contacts: new row violates row-level security policy for table "contacts" |
| S1c | Cross-tenant void/confirm | PASS | refused: void_invoice: void_invoice: invoice 14a491df-c931-4270-85ab-e / refused: confirm_payroll_run: Payroll run not found |
| S1d | Own invoice with another company customer | FAIL | ALLOWED {"id":"<id>","company_id":"61a62899-92bc-46cb-a6 |
| S1e | Company-parameter RPCs with a foreign company id | PASS | clean |
| S2 | Anonymous reads | PASS | clean |
| S2b | Anonymous reset_company_data / set_user_role | PASS | refused: reset_company_data: reset_company_data: not authenticated/refused: set_user_role: forbidden: requires users.manage permission |
| S3 | Sales user promotes self to admin | PASS | refused: 0 rows/refused: set_user_role: forbidden: requires users.manage per |
| S3b | User moves own profile to another company | PASS | refused: 0 rows |
| S4-sales | sales reads general ledger | FAIL | CAN READ GL |
| S5-sales | sales posts a manual journal | FAIL | ALLOWED {"entry_number":"JE-1085","journal_entry_id":"31e85b63-2f6d-4154-ab14-552f3683a3 |
| S6-sales | sales reads employees/salaries | PASS | blocked |
| S7-sales | sales reads supplier bills, bank accounts, expenses | FAIL | {"bills":true,"bank":true,"exp":true,"pay":true} |
| S8-sales | sales confirms an expense | FAIL | ALLOWED {"expense_id":"<id>","item_count":0,"entry_numbe |
| S4-counter | counter reads general ledger | FAIL | CAN READ GL |
| S5-counter | counter posts a manual journal | FAIL | ALLOWED {"entry_number":"JE-1087","journal_entry_id":"12a67590-ee90-43cf-8a44-43449b2436 |
| S6-counter | counter reads employees/salaries | PASS | blocked |
| S7-counter | counter reads supplier bills, bank accounts, expenses | FAIL | {"bills":true,"bank":true,"exp":true,"pay":true} |
| S8-counter | counter confirms an expense | FAIL | ALLOWED {"expense_id":"<id>","item_count":0,"entry_numbe |
| S4-viewer | viewer reads general ledger | PASS | CAN READ GL |
| S5-viewer | viewer posts a manual journal | PASS | refused: post_journal_entry: new row violates row-level security policy "rbac_w_ins_document_sequences" for table "document_sequences" |
| S6-viewer | viewer reads employees/salaries | PASS | blocked |
| S7-viewer | viewer reads supplier bills, bank accounts, expenses | PASS | {"bills":true,"bank":true,"exp":true,"pay":true} |
| S8-viewer | viewer confirms an expense | PASS | refused: confirm_expense: new row violates row-level security policy "rbac_w_ins_document_sequences" for table |
| S4-wh | wh reads general ledger | FAIL | CAN READ GL |
| S5-wh | wh posts a manual journal | FAIL | ALLOWED {"entry_number":"JE-1089","journal_entry_id":"d2851edc-7060-4f37-9cd1-8a71de5098 |
| S6-wh | wh reads employees/salaries | PASS | blocked |
| S7-wh | wh reads supplier bills, bank accounts, expenses | FAIL | {"bills":true,"bank":true,"exp":true,"pay":true} |
| S8-wh | wh confirms an expense | FAIL | ALLOWED {"expense_id":"<id>","item_count":0,"entry_numbe |
| S4-pu | pu reads general ledger | FAIL | CAN READ GL |
| S5-pu | pu posts a manual journal | FAIL | ALLOWED {"entry_number":"JE-1091","journal_entry_id":"bc662428-62f8-4a25-a599-58412128c7 |
| S6-pu | pu reads employees/salaries | PASS | blocked |
| S7-pu | pu reads supplier bills, bank accounts, expenses | PASS | {"bills":true,"bank":true,"exp":true,"pay":true} |
| S8-pu | pu confirms an expense | PASS | ALLOWED {"expense_id":"<id>","item_count":0,"entry_numbe |
| S5-acc | Accountant posts journal (should be allowed) | PASS |  |
| S9 | Sales user confirms payroll run | PASS | refused: confirm_payroll_run: Payroll run not found |
| S9b | Sales user settles gratuity (cash out of bank) | PASS | refused: settle_gratuity: Employee not found |
| S10-sales | sales voids a confirmed customer receipt | PASS | ALLOWED {"payment_id":"<id>","payment_number":"PAY-S907" |
| S10-wh | wh voids a confirmed customer receipt | FAIL | ALLOWED {"payment_id":"<id>","payment_number":"PAY-S908" |
| S10-pu | pu voids a confirmed customer receipt | FAIL | ALLOWED {"payment_id":"<id>","payment_number":"PAY-S909" |
| S10-viewer | viewer voids a confirmed customer receipt | PASS | refused: void_payment: new row violates row-level security policy "rbac_w_ins_document_sequences" for table "d |
| S10-counter | counter voids a confirmed customer receipt | PASS | ALLOWED {"payment_id":"<id>","payment_number":"PAY-S911" |
| S11 | Warehouse user confirms a sales invoice | FAIL | ALLOWED {"je_id":"<id>","invoice_id":"07a1cef9-1525-4d7e |
| S11b | Purchase user: opening stock / GL opening | FAIL | ALLOWED {"total_value":50,"entry_number":"JE-1104","stock_ledger_id":"131a3385-3/ALLOWED {"amount":5,"direction":"debit","account_code":"1410","account_name":"Pr |
| S11c | Sales user reverses a vendor-bill journal entry | FAIL | ALLOWED {"entry_number":"JE-1106","journal_entry_id":"7281ab05-7d1a-464a-9bbd-372c0dea05 |
| S12 | REST: change total of CONFIRMED invoice (sales user) | FAIL | ALLOWED "updated" |
| S12b | REST: draft invoice -> confirmed without posting | FAIL | ALLOWED "updated" |
| S12c | REST: edit line of CONFIRMED invoice | FAIL | ALLOWED "updated" |
| S12d | REST: draft payment -> confirmed without posting | FAIL | ALLOWED "updated" |
| S12e | REST: insert payment already confirmed | FAIL | ALLOWED {"id":"<id>","company_id":"c2831e5c-7de4-4cda-9c |
| S12f | REST: delete CONFIRMED invoice | FAIL | ALLOWED "deleted; journal rows left 1" |
| S12g | REST: alter GL / stock ledger | PASS | refused: permission denied for table general_ledger |
| S12h | REST: change confirmed bill / credit note amounts | FAIL | ALLOWED "updated"/ALLOWED "updated" |
| S13 | Forge an audit log row | FAIL | ALLOWED {"id":"<id>","company_id":"c2831e5c-7de4-4cda-9c |
| S13b | Delete audit log rows | PASS | deleted 0 |
| S14 | Sales user changes company settings | PASS | refused: 0 rows |
| C12.1 | Lock period to 2026-10-31 | PASS | updated |
| D29 | Post into closed period | FAIL | refused,refused,refused,ALLOWED,ALLOWED,refused (JE,inv,exp,opStock,opBal,dep) |
| D29b | Accountant unlocks the period | PASS | refused: 0 rows |
| D29c | REST: change date of confirmed invoice into closed period | FAIL | ALLOWED "updated" |
| C12.2 | Close fiscal year 2026 before it ends | PASS | refused: close_fiscal_year: Fiscal year 2026 has not ended yet (ends 2026-12-31). |
| E1 | Every journal balances | PASS | 110 entries, 0 unbalanced, lines 255 |
| E1b | No journal header without lines | PASS | 110 headers |
| E2 | Stock ledger value = GL 1300 | FAIL | sub 2500.39 GL 2547.39 |
| S15r | Branch restriction switched on: warehouse user | PASS | stock warehouses 1, GL hidden, other-branch adjustment refused: inventory_adjustments: new row violates row-level s |
| V-void_vendor_bill | Cancel function exists: void_vendor_bill | FAIL | Could not find the function public.void_vendor_bill without parameters in the schema cache |
| V-void_grn | Cancel function exists: void_grn | FAIL | Could not find the function public.void_grn without parameters in the schema cache |
| V-void_stock_transfer | Cancel function exists: void_stock_transfer | FAIL | Could not find the function public.void_stock_transfer without parameters in the schema ca |
| V-void_inventory_adjustment | Cancel function exists: void_inventory_adjustment | FAIL | Could not find the function public.void_inventory_adjustment without parameters in the sch |
| D30 | Two users edit the same draft invoice | FAIL | ALLOWED "updated" |
| C7.1c | POS cash sale without a customer | FAIL | confirm_pos_sale: null value in column "contact_id" of relation "invoices" violates not-null constraint |
| C7.1d | POS cash sale with a customer, stock moves | PASS | 46->45 |
| E3 | System health checks | FAIL | [{"name":"AR Aging = AR Account (1200)","pass":false,"ar_tb":2634.5,"ar_aging":2885.5,"invariant":"B1","difference":251},{"name":"AP Aging = AP Account (2100)","pass":fal |
| E4 | MAC rounding: 3 units for 10.00 | PASS | GL +10 ledger 10 mac 3.33 |
| D31 | Bill line total tampered: qty 1 x 5 saved as total 500 | PASS | refused: confirm_vendor_bill: Journal entry does not balance (debits minus credits = -495.00). The transaction was rolled back to protect your books. |
| D31b | Invoice header total differs from lines | FAIL | ALLOWED {"je_id":"<id>","invoice_id":"4579ba00-5fc1-4fa4 |
| C12.3-quarterly | File VAT return with figures that do not match the books (999) | FAIL | ALLOWED {"status":"filed","filing_id":"<id>","period_end |
| C12.3-monthly | File VAT return with figures that do not match the books (999) | FAIL | ALLOWED {"status":"filed","filing_id":"<id>","period_end |
| S16 | Sales user reads settings secrets: api_keys hash, payment_provider_configs | PASS | api_keys false; provider cols id,provider,is_active,mode,public_config,created_at,updated_at |

Failures marked for roles show the first words of the server reply. Identifiers are removed.

## Attempts excluded from the counts
| Test | Reason |
|---|---|
| C12.3 | Script used a wrong period word. Repeated. |
| C3.3-ar | Script used a type name that does not exist; repeated with the right one. |
| C3.3-bill | Script used a type name that does not exist; repeated with the right one. |
| C3.3-customer | Script used a type name that does not exist; repeated with the right one. |
| C3.3-invoice | Script used a type name that does not exist; repeated with the right one. |
| C3.3-supplier | Script used a type name that does not exist; repeated with the right one. |
| C3.3-unpaid_bill | Script used a type name that does not exist; repeated with the right one. |
| C3.3-unpaid_invoice | Script used a type name that does not exist; repeated with the right one. |
| C5.9 | Empty placeholder, not a test. Excluded. |
| C7.13 | Script sent no cost. Kept as SAL-04; repeated as C7.13r. |
| C7.15 | Correct refusal: the customer owed more than the credit. Repeated as C7.15r. |
| C7.4 | Only read the configuration. Not a workflow test. |
| D17 | Script sent no cost. Repeated as D17r. |
| S15 | Restriction switch was off. Repeated as S15r. |
| V-cancel_purchase_order | Purchase orders change status directly; no function is expected. |

Notes: Quantity 46 is correct: 50 bought, 5 returned, 1 from the D4 test bill. Workflow passed. Refused because the sales user cannot see the run (row security). Refused because the sales user cannot see the employee (row security).

## Report readings (R-*)
Balance sheet: total assets -418,601.39 equal liabilities -505,913.48 plus equity 87,312.09. Cash flow closing cash -424,748 equals accounts 1100 + 1110 at that time (the negative comes from the 500,000 gratuity test). VAT: output 122.50 and input 59.72 equal accounts 2200 and 1500; taxable bases do not (ACC-03). Opening balance is 0 in both statements (RPT-01). Returns are 0 in Purchases by Supplier (RPT-04).

Test scripts are kept in evidence/ as text.

## Not run
Existing integration suites, production regression suite, real device tests, payment gateways, email, public API.
