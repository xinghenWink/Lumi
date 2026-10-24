# PR-5: Credits, profile and account security

## Scope and dependencies

Build on PR-4's real file lifecycle, server-credit query keys, model options and session boundary. The candidate implements `/me/credits`, `/me` and `/me/security`; the default production entry remains Vue. PR-4's local gates and CI #96 pass; PR #14 is integrated as `ffa3f93`. No Go, OpenAPI, SQL, Compose, credit policy or account permission changes are required.

## File changes and order

1. Add typed Query cursor navigation and identity-scoped mutation/download helpers. Reuse all existing API parsers and password/date validators; add optional abort signals to existing preference/device reads where useful. No new dependencies.
2. Add credit overview/redemption, backend usage chart, ledger filters/cursors and redemption records. Keep all accepted balances and statistics authoritative; uncertain redemption responses retain the payload's idempotency key. Reusable account/ledger components also support PR-6's administrator view with explicit props and backend permissions.
3. Add profile nickname/locale/timezone, authenticated avatar, appearance and password changes. Updating profile/avatar must not invalidate the identity or write old-user data after logout.
4. Add complete preferences, paginated devices/current-device markers, confirmed revocation, chat exports and confirmed account deletion. Preserve the entire preference contract when changing appearance. Password changes/current-session revocation/deletion clear the authenticated runtime only after server confirmation.
5. Add candidate credit/account security regressions and restore the candidate image journey's credit-redemption/avatar UI checks now that those pages are implemented. Keep the original legacy scenarios and assertions enabled.

Changed modules:

- `features/accounts/resources.ts`, `owned-mutation.ts` and focused tests: cursor/filter ownership, operation keys and epoch fencing.
- `features/files/download.ts`: abortable private exports and disposable Blob URLs.
- `components/credits/{CreditOverview,CreditUsage,CreditLedger,RedemptionRecords}.tsx`: server-owned finance views and reusable admin variants.
- `components/shared/{CursorControls,DataTable,Panel,UserAvatar}.tsx`, `components/ui/field.tsx`: typed table/form primitives, account-menu avatar and responsive layout.
- `pages/{CreditsPage,ProfilePage,SecurityPage}.tsx`, router and runtime/route-guard exit coordination.
- `api/operations.ts`: optional abort signals only; existing endpoints, parsers and payloads remain.
- `tests/react/accounts-credits.spec.ts`, `tests/react/images.spec.ts`: two real account/finance journeys per viewport and restored redemption/avatar UI steps in the full image journey.

## Acceptance plan

The first desktop account run found a race after successful password change: a synchronous anonymous-route redirect could overwrite `/login?changed=1`. The runtime now publishes the confirmed exit destination before notifying session subscribers. Route guards and the initiating page use the same destination; current-session revocation and account deletion use the same mechanism. The session protocol/core and backend revocation semantics are unchanged. The regression keeps the exact changed-password redirect assertion and passes without relaxing it. Failure traces remain under ignored `.tools/react-ui-pr-5/`.

- [x] Real gifts/redemption/account totals, lost-response replay, disabled/duplicate codes, usage, ledger filter binding/pagination and private redemption records.
- [x] Real profile/avatar ownership and dimensions, locale/timezone persistence, light/dark/system appearance and bounded mobile layout.
- [x] Full preference persistence, session cursor loading/current marker, other/current-session revocation, exports, password validation/change/relogin and account deletion. The browser journey exercises two real devices; the original cursor API is reused for additional pages.
- [x] Identity changes reject late mutations/downloads and clear private caches, drafts, readers and Blob URLs.
- [x] Frozen installation, strict typecheck, lint/format, unit tests, both builds and relevant legacy/Chrome desktop/320/390px E2E pass: legacy 16/16 and candidate 24/24. Existing performance gates remain unchanged.
- [ ] Current-head CI, integration, capacity, audit and Docker/Compose pass before integration. OpenAPI and migrations are not applicable without an API change.

The final candidate suite passes 24/24 on Chrome desktop and 320/390px mobile/touch emulation. Strict typecheck, lint/format, frozen installation, legacy/shared 50 unit tests, candidate/shared 41 unit tests and the React build pass. Desktop Lighthouse is 100 with initial script gzip 246,830 bytes; SSE p95 is 23/32/33 ms across the three viewports, sampled interactions at most 16 ms and measured long tasks 0. The original thresholds and all legacy assertions remain. Light/dark credit, profile, preferences, chat and image artifacts are retained under ignored `.tools/react-ui-pr-5/` and have been inspected. Mobile evidence is browser emulation.

The initial translation check interpreted a concatenated partial namespace as a static key; ledger dynamic translations now use template interpolation, while the static-key and complete language-catalog tests remain unchanged. No test has been removed or weakened.
