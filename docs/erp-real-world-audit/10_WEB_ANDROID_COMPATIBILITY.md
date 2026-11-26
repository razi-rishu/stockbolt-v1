# 10 Web and Android compatibility

> Audit date 2026-11-25. Local staging only (Docker, 127.0.0.1). No production data, source code or schema was changed. Commit fe2ef09 plus the uncommitted quantity display fix.

Screens were opened signed in as the owner, in headless Chrome: desktop 1440 px, and the app layout at 390 px. **This is not a test on an Android device.** Only the main list, report and new-document screens were opened; no action was taken on them.

### Desktop
| Measure | Count |
|---|---|
| Screens opened | 84 |
| Horizontal overflow | 0 |
| Module switched off | 0 |
| Text that looks like an error | 29 |
| Nearly empty (< 120 characters) | 0 |

### Phone layout
| Measure | Count |
|---|---|
| Screens opened | 84 |
| Horizontal overflow | 0 |
| Module switched off | 0 |
| Text that looks like an error | 4 |
| Nearly empty (< 120 characters) | 2 |

### Screens flagged for a look
| View | Screen | Overflow px | Text length | Error-like words | Raw key |
|---|---|---|---|---|---|
| web | settings | 0 | 2602 | true |  |
| web | settings/company | 0 | 1501 | true | e.g |
| web | settings/tax-rates | 0 | 811 | true | e.g |
| web | settings/import-export | 0 | 2027 | true |  |
| web | settings/business-configuration | 0 | 1966 | true |  |
| web | settings/system-health | 0 | 363 | true |  |
| web | settings/audit-log | 0 | 15829 | true |  |
| web | reports/trial-balance | 0 | 2321 | true |  |
| web | reports/profit-loss | 0 | 1818 | true |  |
| web | reports/balance-sheet | 0 | 2306 | true |  |
| web | reports/cash-flow | 0 | 1801 | true |  |
| web | reports/ar-aging | 0 | 1449 | true |  |
| web | reports/ap-aging | 0 | 1221 | true |  |
| web | reports/stock-valuation | 0 | 1430 | true |  |
| web | reports/stock-movement | 0 | 3399 | true |  |
| web | reports/vat-return | 0 | 1838 | true |  |
| web | reports/daily-cash | 0 | 1294 | true |  |
| web | reports/bank-recon | 0 | 1139 | true |  |
| web | reports/audit-log | 0 | 16532 | true |  |
| web | reports/reversal-trail | 0 | 1715 | true |  |
| web | reports/fixed-asset-register | 0 | 1562 | true |  |
| web | reports/depreciation-schedule | 0 | 1455 | true |  |
| web | reports/grn-reconciliation | 0 | 1248 | true |  |
| web | reports/outstanding-pos | 0 | 1008 | true |  |
| web | reports/sales-trend | 0 | 1315 | true |  |
| web | reports/sales-by-customer | 0 | 1405 | true |  |
| web | reports/purchases-by-supplier | 0 | 1242 | true |  |
| web | reports/returns-analysis | 0 | 1507 | true |  |
| web | reports/supplier-statement | 0 | 1086 | true |  |
| phone | dashboard | 0 | 43 | false |  |
| phone | settings/company | 0 | 1314 | true | e.g |
| phone | settings/tax-rates | 0 | 656 | true | e.g |
| phone | settings/business-configuration | 0 | 1779 | true |  |
| phone | settings/categories | 0 | 107 | false |  |
| phone | reports/cash-flow | 0 | 908 | true |  |

"Error-like words" is a case-insensitive word search: it also matches "nan" inside words such as Financial or maintenance in the menu. A sample of six flagged and unflagged screenshots was viewed and showed no error; the rest were not looked at one by one. Samples are in evidence/ (the audit-log picture shows the forged row with no user, SEC-04).

Differences by design: billing screens are web only (Play rules); the app uses bottom navigation; printing uses the device share flow. The app bundles its own copy of the code, so a web fix reaches Android only with a new build. Not tested: offline behaviour, camera barcode, back button, print/share on device, push.
