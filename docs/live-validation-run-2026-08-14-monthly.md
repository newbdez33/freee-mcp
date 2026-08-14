# Playwright Monthly Read Validation — 2026-08-14

## Scope and safety boundary

- Source baseline: commit `e23233e`, package version `0.3.3`, plus the compatibility fixes recorded by this branch.
- Backend: explicitly selected `playwright`, headless Chrome, System Keychain credentials.
- Excluded: Public API calls, real clock actions, monthly submission/withdrawal, manager approval/return, and every other business write.
- Evidence was reduced to periods, counts, application numbers, normalized states, and safe error codes. No credentials, names, raw employee tables, cookies, screenshots, or browser-profile data were retained.

## Personal monthly period navigation

The initially selected attendance calendar returned work month `2026-08`, payment month `2026-09`, and state `unsubmitted`. A read for requested work month `2026-07` returned exactly `2026-07`, payment month `2026-08`, state `approved`, and application No. `9140`. The payment/work offset remained one month and no application was submitted or withdrawn.

Result: `LV-R12` passed.

## Manager monthly review

The pending manager filter contained one general application and no `月次勤怠締め` application. The first approved source page contained nine monthly closing applications. Approved application No. `9869` for work month `2026-08` was used for a read-only review.

The final review verified:

- exact monthly application type and approved state;
- one unique applicant mapping in the attendance monitor;
- exact `2026-08` period verification on both manager and employee attendance pages;
- one daily attendance table with 31 unique days;
- zero day-level alerts, zero page warnings, and one consolidated automatic check;
- no available manager action for the already approved application.

Result: the list, mapping, period verification, and full review portion of `LV-R11` passed. `LV-R11` remains open because the manager monitor was already on `2026-08` and no naturally pending monthly application was available. Cross-month manager navigation and two stable read-only prepare fingerprints still require a natural pending case. `LV-W10` was not attempted.

## Live compatibility fixes

The validation exposed four current freee UI differences, all before any write:

1. The manager attendance monitor displays the payment/work period label without parentheses.
2. The employee attendance link opens an official `/attendances` page in a new tab.
3. The table-view control uses `data-testid="テーブル"`.
4. The daily attendance grid places its header row inside `<tbody>` and preserves blank edge columns.

The implementation now accepts both observed strict period-label forms, follows and validates the new official tab, selects the current table control, derives the selected work period from the verified payment/work context, and recognizes exactly one body-header daily table while retaining column alignment.

## Automated regression result

`npm run check` passed all 122 tests after the fixes.
