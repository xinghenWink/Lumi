# PR-6a: Users and finance administration

## Scope and dependencies

Build on PR-5 and the bounded PR-6 plan. Migrate `/admin/users`, `/admin/users/:id`, `/admin/credit-ledger` and `/admin/redeem-codes` into the independent AdminShell. Keep every other administrative route for its subsequent sub-PR and retain the Vue production default. No SQL migration, OpenAPI change, backend rule or dependency is required.

## Implementation

- Lazy React admin routes and a shared page frame; responsive tables keep horizontal scrolling inside their own container.
- User search, role/status/date/balance filters, sort, cursor paging, create/edit/confirmed deletion and backend-provided credit buckets. Self role/status/deletion controls remain disabled; server permission and last-admin rules remain authoritative.
- Confirmed batch enable/disable/delete and payload-bound idempotent grants. User detail preserves profile/session metadata, ID copy, conversation metadata links, forced logout, credit adjustments, ledger and redemption tabs.
- Redemption batch generation, expiry/prefix/quantity/usage controls, batch/status/exact-code filters, cursor paging, copy, individual/batch enable/disable, confirmed unused-code deletion and admin redemption records.
- Private code/user/ledger CSV exports retain actual API filters, CSV MIME validation, identity checks, aborts and disposable Blob URLs. User CSV only supports the existing search/role/status parameters; no extra export API is inferred from list filters.
- Financial success uses the server account snapshot and invalidates dependent private queries. Unknown batch/grant/adjustment responses reuse the original payload key. The generic mutation cache contains ownership metadata only.

## Source changes

- `frontend/src/react/pages/admin/{UsersPage,UserDetailPage,CreditLedgerPage,RedeemCodesPage}.tsx`.
- `frontend/src/react/components/admin/{AdminPage,UserDialog,UserBatchDialog,RedeemBatchDialog}.tsx`.
- Lazy router entries, typed table header content, credit export/cache invalidation and private CSV validation.
- Shared modal close icon now uses the existing `common.close` translation, distinguishing it from the form's cancel action.
- `frontend/tests/react/{admin-users,admin-finance}.spec.ts` with real shared fixture helpers. Existing candidate journeys retain all assertions and use the same isolated administrator/client fixture.

## Validation and failure handling

The first focused desktop run exposed duplicate accessible names for the close icon and cancel action. The icon now says Close; the original unambiguous cancel assertions pass. Both administrative journeys subsequently passed on real Go/PG/Redis.

The expanded full suite then exposed shared-fixture rate limits. All journeys used one administrator and one client IP per viewport, so aggregate writes hit the real 60/minute administrator quota; isolating only users also exposed the aggregate login IP quota. Each journey now creates its own real administrator through the existing API and uses one deterministic benchmark-range client IP across that journey's browser/API/device contexts. Bootstrap creation/deletion uses the original administrator. Production quotas, authentication checks, clocks and thresholds are unchanged. Failure traces remain under ignored `.tools/react-ui-pr-6a/`.

- [x] Frozen install, strict typecheck, lint/format and unit tests (50 legacy/shared and 41 React/shared).
- [x] Both builds and the original 16 legacy browser cases.
- [x] Full Chrome candidate suite on desktop, 320px and 390px touch/mobile emulation, including existing SSE/credits/image editing and performance bounds.
- [x] Real user CRUD, disable/re-enable/relogin, self controls, forced logout, batch status/delete, user CSV and an uncertain grant retry that changes each target account exactly once.
- [x] Original code generation/pagination/filter binding/copy/CSV/redemption/used-code deletion rules and add/subtract/set adjustments; extra unknown-response replay for batch generation and adjustment, plus batch code status controls.
- [x] Inspect desktop/mobile visual evidence and verify no viewport overflow.
- [ ] Current-head CI quality, integration, capacity, dependency audit, candidate E2E and Docker/Compose before merging only into `codex/react-ui`.

## Next dependency

The final local candidate suite passes 30/30. Desktop Lighthouse is 100, initial script gzip 247,266 bytes, SSE p95 19/19/21 ms for desktop/320/390px, sampled interactions at most 24 ms and long tasks 0. No performance gate or behavioral assertion changed. Candidate success and failure evidence is retained under ignored `.tools/react-ui-pr-6a/`.

After these gates pass, PR-6b migrates AI services and PR-6c migrates operations/security. PR-7 switches the production entry and removes Vue only after complete candidate functionality, Chrome/SSE/credits/image-editing and Docker embed acceptance, then repeats final validation and proposes a release PR to main without merging it.
