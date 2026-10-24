# React UI compatibility matrix

Baseline: `c28be7fe16ca911f2b9443c27ce887f14f96b5d8`. Source of truth: `frontend/src/app/router.ts`, `frontend/src/api/`, `docs/openapi.yaml` and backend handlers. All rows start pending for the React candidate; legacy implementation is not evidence that a candidate feature has migrated.

## Routes and functions

| Existing route                        | Required operations                                                                                                                    | Phase | Existing browser evidence                                       |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----- | --------------------------------------------------------------- |
| `/`, `/login`, `/register`            | Redirect, auth guards, safe internal return, registration switches, consent, verification, Turnstile                                   | 2     | guest, accounts                                                 |
| `/forgot-password`, `/reset-password` | Uniform reset request, fragment token consumption/removal, reset and reauthentication                                                  | 2     | Add dedicated browser coverage; backend operations tests remain |
| `/terms`, `/privacy`, unknown paths   | Public legal pages and router 404                                                                                                      | 2     | guest                                                           |
| `/chat`, `/chat/:id`                  | Model selection, drafts, messages, stop, retry, edit, regenerate, vision, export, durable resume                                       | 3     | chat; add browser resume/IME cases                              |
| `/me/chats`                           | Search, pin, rename, cursor pages, batch delete, clear all                                                                             | 3     | chat                                                            |
| `/create`, `/create/:id`              | Image conversation, prompt, upload/paste/drop/library references, model/capability/quote, task progress and edit                       | 4     | images, catalog                                                 |
| `/me/images`                          | Filters, cursor pages, virtual grid, preview/zoom/copy/download, batch ZIP/delete, edit existing file                                  | 4     | images; extend batch cases                                      |
| `/me/credits`                         | Daily/permanent balances, reset time, redeem, records, ledger and usage                                                                | 5     | credits, images full journey                                    |
| `/me`                                 | Nickname, locale, timezone, password, avatar and reauthentication behavior                                                             | 5     | accounts, images                                                |
| `/me/security`                        | Instructions, image defaults, theme, devices/revocation, chat export and self deletion                                                 | 5     | operations; extend devices/self-delete cases                    |
| `/admin`, `/admin/dashboard`          | Existing overview redirect, date selection, UTC trends, credit/upstream statistics                                                     | 6     | operations                                                      |
| `/admin/users`, `/admin/users/:id`    | Search/filter/cursors, create, edit, roles/status/delete, batch enable/disable/delete/grant, export, revoke sessions, balances/history | 6     | accounts, credits; extend batches                               |
| `/admin/credit-ledger`                | Filter/cursor/export across accounts                                                                                                   | 6     | credits                                                         |
| `/admin/redeem-codes`                 | Batches, generation, search, copy, enable/disable, unused deletion, records and export                                                 | 6     | credits                                                         |
| `/admin/upstreams`                    | Channel CRUD, secret preservation/clear, tests, discovery and model import, health and failure state                                   | 6     | catalog                                                         |
| `/admin/models`                       | Platform aliases, capabilities, order/default/enabled, priority/weight routing and version conflicts                                   | 6     | catalog                                                         |
| `/admin/chat-settings`                | Rate/context limits, system prompt and title model                                                                                     | 6     | chat                                                            |
| `/admin/image-settings`               | Counts, references, sizes/ratios, concurrency, timeouts, split behavior, retention and content visibility                              | 6     | images                                                          |
| `/admin/image-tasks`                  | Filters/cursors, details, privacy, audited content access/deletion, terminal manual refund                                             | 6     | images; extend manual refund UI                                 |
| `/admin/pricing`                      | Rules, model overrides, generate/edit quality, multipliers, gifts and credit timezone                                                  | 6     | credits, images                                                 |
| `/admin/conversations`                | Metadata filters/cursors, controlled content access                                                                                    | 6     | Add browser coverage; preserve existing API authorization       |
| `/admin/announcements`                | Multiple announcements, Markdown, start/end, versioned create/update/delete, banner refresh                                            | 6     | operations                                                      |
| `/admin/operations-settings`          | Maintenance, Turnstile, IP quota, sensitive words, circuit settings and secret handling                                                | 6     | operations; extend writes                                       |
| `/admin/settings/:group?`             | Site/branding, registration, SMTP, environment overrides and test email                                                                | 6     | accounts, operations                                            |
| `/admin/system`, `/admin/audit`       | Build/dependency/storage status, bounded cleanup confirmation, audit filter/cursor/change display                                      | 6     | accounts, operations                                            |

Keep URL query filters, deep-link refresh, browser back/forward, route titles and locale-aware accessibility labels. The current safe-return helper omits `/create`; add it without admitting external or protocol-relative URLs.

## API and lifecycle boundaries

| Boundary           | Contract to preserve                                                                                                                                     | Validation                                             |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Session            | Memory-only access JWT; HttpOnly refresh cookie; single-flight bootstrap/refresh; Web Locks; refresh 401/403 clears identity, transient failure does not | Adapter tests, accounts E2E                            |
| Protected requests | Same-origin credentials, Bearer, `X-Lumi-CSRF: 1`, one 401 refresh/retry, request ID and Retry-After                                                     | Transport/client tests, real API E2E                   |
| Private lifecycle  | Abort pending private work and clear caches/drafts/object URLs on identity change; reject late responses                                                 | Store/controller tests and browser account switches    |
| Pagination         | Opaque filter-bound cursor, applied filters separate from draft filters; reset on submitted filter changes                                               | Existing credits/catalog/history checks                |
| Versions           | Preserve server optimistic versions and explicit conflict errors                                                                                         | Contract and UI conflict tests                         |
| Chat request       | `request_id`, `model_id`, `content`, `action`, optional `last_message_id` and owned `reference_file_ids`; identical retry retains input                  | Chat tests and Go integration                          |
| Chat SSE           | `meta`, `delta`, `error`, `done`, `ping`; split UTF-8, CRLF, multiline data, explicit terminal frame, validated event ID                                 | Existing SSE parser tests plus controller tests        |
| Chat resume        | GET events with `request_id` and `Last-Event-ID`; five-minute owner-scoped Redis replay; durable checkpoint fallback; disconnect does not imply stop     | operations_stream Go integration and browser reconnect |
| Image subscription | `task`, `done`, `ping`; six task states; ignore older task versions; 3-second GET polling after loss; no cancellation on navigation                      | images store/contract tests and E2E                    |
| Capabilities       | `/models?type=` and `/image-options` intersection; ratios map to supported sizes; no static models/prices                                                | catalog/images E2E with constrained fixtures           |
| Quote              | `model_id`, `operation`, `quality`, `size`, `count`; references determine generate/edit; quote is not a price lock                                       | Existing image scenario and quote race tests           |
| Image submit       | Conversation/model/prompt/quality/size/ratio/n/reference IDs and Idempotency-Key; preserve exact payload/key after uncertain response                    | Lost-success-response images E2E                       |
| Files              | Upload multipart; owned metadata/signatures; authenticated byte fetch; WebP thumbs/PNG results; expired-signature refresh; revoke Blob URLs              | Images E2E and file ownership integration              |
| Content security   | Existing Markdown sanitization, no arbitrary external images/unsafe links, KaTeX/Shiki lazy loading, same-origin fonts and current CSP                   | Markdown tests, browser error observer and CSP tests   |
| Embed              | `backend/web/dist`, `production` tag, `#app`, HTML no-cache, immutable hashed assets, API/resource 404 without HTML fallback                             | Go web tests, guest E2E, Docker/Compose                |

## Credits and administrative invariants

- Charge and task creation stay atomic in Go. Settlement and terminal state stay atomic. React does not mutate a displayed balance as a substitute for fetching the account.
- Consume the daily bucket first, then permanent. Daily credits do not accumulate. Reset uses the server's configured IANA timezone and returned next reset time.
- Display accepted `unit_price`, `total_cost`, `refunded_cost` and `actual_cost`. Partial failure refunds the original accepted price; cross-day daily refunds go to permanent credits. Frontend multiplication is not settlement.
- Identical idempotency key/input returns the original result; changing the payload is a distinct operation or a conflict. Preserve keys after uncertain network results for redemption, adjustments, batch creation/grants and image submission where required by the existing API.
- A canceled task may require worker acknowledgement. Deleting an already successful image does not refund it. Manual refund applies only to terminal tasks and cannot refund an already refunded amount again.
- Preserve last-administrator/self protections, backend role checks and content access audits. Do not reveal upstream names, keys, route internals, server file paths or raw provider errors in public data.
- SMTP/upstream/Turnstile secrets retain configured/preserve/clear semantics, remain absent from persistent client storage, URLs and logs, and are cleared from form state after save.
- Existing user CSV export and model import are distinct functions. There is no user-import API to invent from a prototype label.

## Migration tracking

Each implementation PR links its completed rows, changed source paths and exact test evidence. A row is complete only after its React behavior is exercised. CSS-selector changes may use stable test IDs or accessible selectors, but all prior behavioral assertions remain represented. Full React acceptance is required before deleting legacy tests or dependencies; tests are migrated, not discarded.

## Final React default (PR-7)

PR-6c passed complete functions, Chrome desktop/320/390 (51), original Vue browser cases (16), actual React Docker embed (3) and all CI #101 jobs before cleanup. The default entry now uses the same accepted React application; no route, backend business rule, API/OpenAPI/SQL, SSE or financial settlement changed. The framework-independent parsers/types and session adapter remain in use.

Canonical browser discovery preserves the original journey entry points and all newer cases: 57 cases over Chrome desktop and fully emulated 320/390px touch/mobile projects. The original credit journey maps to both public signup/account statistics and administrator finance modules. All 20 original store acceptance cases now use the real React architecture; the combined suite has 87 cases after running the five formerly shared cases only once. See REACT_UI_PR7.md for the exact mapping and final gates.

Final default acceptance passes all 57 Chrome cases and 87 unit cases, plus three actual default Docker embed cases. CI #103 passes all quality, contract, security, capacity, Compose and recovery gates. PR #19 integrates the complete default switch and Vue cleanup as 0b80860. The main-targeted release proposal contains the same accepted runtime tree and this final evidence; main has not been merged.
