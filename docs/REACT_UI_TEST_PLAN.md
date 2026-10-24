# React UI validation plan

## Environments and evidence

Pin Node 22.19+ within 22.x, pnpm 10.27.0 and Go 1.26.10. On this Windows workstation set `GOTOOLCHAIN=go1.26.10` explicitly; the host default is a different version. Use isolated PostgreSQL 16, Redis 7, image data and random test credentials. Never reuse production accounts or paid upstream requests for deterministic regressions.

Existing full Playwright scenarios use the actual Go production binary and real PG/Redis, with local deterministic HTTP upstream fixtures. Guest-only tests do not prove authenticated functionality or settlement. CI reports, traces, screenshots and environment/commit information are acceptance evidence; previous milestone artifacts cannot substitute for the current commit.

## Every implementation stage

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm test:e2e
```

PR-1 adds explicit candidate build/test commands and a candidate CI job while retaining these legacy checks. Both TypeScript configurations keep strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes and no-explicit-any. Tests include TSX when added. Builds targeting the same dist execute sequentially or in separate checkouts/jobs. Each browser job starts only after its matching build.

Use `pnpm test:e2e --grep '@guest'` only for explicitly labeled infrastructure-only validation. In PowerShell the quotes prevent `@guest` from being interpreted as splatting. A missing database/browser/engine is a reported unmet gate, not a skipped or passing test.

For protocol/build changes also run:

```sh
make lint test
make sqlc api
git diff --exit-code -- backend/internal/platform/db/query frontend/src/api/schema.d.ts
make test-integration
make build
```

No database/OpenAPI changes are expected for this migration; generated-contract consistency is still checked. Equivalent pinned PowerShell commands may be used locally because the Makefile assumes POSIX environment assignment. Full Linux CI remains required.

## Browser matrix

| Surface                 | Configuration                                                              | Cases                                                                        |
| ----------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Chrome desktop          | Explicit Chrome channel, 1440×900                                          | Complete business suite, keyboard/focus, both themes                         |
| Chrome mobile emulation | Explicit Chrome channel, 320×740 and 390px width, mobile UA/touch/isMobile | Complete business suite, drawer/popover boundaries, composer/keyboard layout |
| Intermediate layout     | 768px width                                                                | Navigation, tables, gallery, modal overflow                                  |

The existing Playwright desktop/mobile projects only set viewport dimensions. Extend their context helpers too: manual `browser.newContext()` calls currently copy selected fields and must preserve mobile emulation. Browser emulation is labeled as such; it is not evidence from a physical Android device.

Keep the existing pageerror/console observer and screenshots. Add assertions for modal focus trapping/restoration, Escape, outside dismissal, visible labels, reduced motion, scroll containment and no horizontal overflow. For image options, tests open the new popover before selecting values. Use accessible selectors or stable IDs instead of retaining obsolete CSS solely to satisfy locators.

## Feature regressions

| Feature         | Required cases                                                                                                                                                                                      |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Session         | Concurrent bootstrap/401 single flight, Web Locks, refresh failure classes, logout waits, stale refresh after clear, account switch during requests                                                 |
| Auth            | Registration and consent, email verification, Turnstile error, disabled registration, safe deep-link return including `/create`, fragment reset token removal                                       |
| Chat            | UTF-8/CRLF/multiline SSE, malformed/missing terminal frames, resumption without duplicate text, accepted-response loss, 401 resume, explicit stop, edit/regenerate IDs, deletion races, IME Enter   |
| Drafts          | User+mode+conversation isolation, separate new drafts, retained input on mode/back navigation, no previous-user data after logout/login                                                             |
| Images          | Model/config capability intersection, PRICE_UNAVAILABLE qualities, quote races, upload/paste/drop/library, edit existing file, exact payload/key replay, no repeated upstream generation            |
| Tasks/credits   | Partial result, queued/running cancellation, failure, polling fallback, late older snapshots, accepted price display, balance refetch, original-price/cross-day refunds and exactly-once settlement |
| Files/gallery   | Signature expiry refresh, cross-owner rejection, thumbs-only lists, actual image dimensions, Blob cleanup, copying/downloading, preview zoom, batch ZIP/delete, edit selection return               |
| Credits/account | Redemption response loss retains key, double-click protection, filters/cursors, locale/timezone, avatar, password/device revocation, self deletion and exports                                      |
| Admin           | Every compatibility row, grouped navigation, role/self/last-admin protections, secret configured/preserve/clear, version conflicts, batch atomicity, audited content visibility and manual refunds  |

Retain the Go integration cases for cross-day refunds, settlement idempotency, task recovery, vision and durable stream resume. Add browser coverage where only backend or parser tests currently exist. Do not modify business outcomes or test thresholds to fit the redesign.

## Performance and deployment gates

Keep existing checks in `frontend/tests/chat-performance.ts`: authenticated initial script gzip ≤250,000 bytes, Lighthouse performance ≥90, sampled event duration <200ms, long-task percentage <5%, and all 60 local-fixture SSE samples with platform p95 <100ms and no stream compression. Preserve bounded rendering for 500 messages/history and 1000 real image files. Markdown/highlighting/math/admin code remains lazy where appropriate.

Run the unchanged k6 mixed-load workload and thresholds, separately from build workloads. Keep environment reports and failed samples. Do not broaden a passing test repeatedly without a new change or unresolved risk.

Build the Docker production image and run the existing complete Compose stack and installation/upgrade/rollback/backup-restore rehearsal. Verify readiness/version/commit, non-root user, static assets, deep links, missing API/assets, HTML/asset caching and CSP. The final release proposal retains amd64/arm64 validation; no cleanup or main-targeted release PR precedes full candidate acceptance.

## PR-0 reference validation

PR-0 only changes documentation and supplied references. Normalize malformed HTML nesting through the same HTML parsing model used by browsers, then format it. Compare rendered original/normalized screenshots and exercise mode switching, model/parameter menus, theme and mobile drawer. Record any visual difference before accepting the repair. Do not add the prototype to production assets.

## Canonical suite after PR-7 cleanup

Normal build/typecheck/lint/test/E2E commands now target React; the candidate aliases target the same commands/configuration. Vitest discovers all shared and React tests exactly once (87 cases), including all 20 ported state cases and the unchanged protocol/financial/SSE assertions. Playwright preserves the original journey entries and adds every accepted candidate regression, yielding 57 cases on Chrome desktop/320/390. Only the independent container suite is excluded from native test discovery; its three cases run against the actual default production image through scripts/react-embed-smoke.mjs.

Keep existing SSE, Lighthouse, 250000-byte gzip, interaction/long-task and virtualized DOM/thumbnail limits. The final CI retains full backend quality/integration/contract/vulnerability/capacity gates and Compose/upgrade/rollback/backup exercises. Main remains unchanged; the last deliverable is a reviewable release proposal.

## Production fixture regression

`node --test scripts/react-embed-readiness.test.mjs` uses real temporary PostgreSQL/Redis containers and the smoke driver's shared probes. A delayed initialization demonstrates Unix-socket readiness while TCP still rejects connections; the production probe must wait until initialization completes. Redis must reject unauthenticated access and accept the configured credential. The default Docker smoke then runs all three authenticated Chrome embed projects. Failure evidence saves build metadata and redacted owned-container status/logs before cleanup; CI uploads only explicit reports/diagnostics, never secret files. See [follow-up acceptance](REACT_UI_EMBED_READINESS.md). No browser assertion, production deadline or performance threshold is relaxed.

Linux native CI invokes the existing full pnpm browser commands through `scripts/native-e2e.mjs`. Owned fresh PG16/Redis7 fixtures use direct host loopback; startup asserts real TCP/authentication, host topology and PostgreSQL `fsync`/`synchronous_commit`/`full_page_writes` all enabled. Original Go integration services and all production Docker/deployment gates remain. Browser SSE reports preserve ordered request/header/upstream/platform samples, visibility and long tasks, while retaining the same original formula, all 60 samples, strict p95 `<100 ms` and no-compression assertion. See [native environment evidence](REACT_UI_SSE_ENVIRONMENT.md); do not remove outliers or retry assertions to obtain a pass.
