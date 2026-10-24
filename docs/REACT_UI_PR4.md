# PR-4: Image conversations, tasks and gallery

## Plan and dependencies

This milestone builds on PR-3's session adapter, model catalog, protected image component, Query runtime and mode-specific sidebar. It migrates `/create`, `/create/:id` and `/me/images` while retaining the legacy production entry. PR-3's local gates and CI #95 passed; PR #13 is integrated as `3ce9f7d`. No Go business code, OpenAPI, SQL, Compose or settlement changes are required.

The existing `api/images.ts` and `api/operations.ts` remain authoritative for validated inputs, tasks, file metadata, quotes, SSE and gallery cursors. The Vue image store's responsibilities are split between a React controller (Query snapshots, monotonic task updates, SSE/polling lifecycle), Zustand (independent drafts and immutable pending submissions), and components (parameters, references, preview and gallery selection).

## File changes

- `src/react/features/images/controller.ts`: identity-scoped conversation/task queries, draft/pending state, explicit cancellation, version filtering and read-only polling fallback. Unknown outcomes retain the original create payload, task body and idempotency key; navigation cannot clear another conversation's draft.
- `src/react/features/images/options.ts`: intersect backend configuration/model capabilities; choose valid backend values using saved preferences. Quote keys include operation, model, quality, size and count; display the returned total without client price arithmetic.
- `src/react/features/images/actions.ts`: abortable authorized original-file downloads and clipboard writes, identity guards and Blob cleanup.
- `src/react/components/images/`: bottom composer with model selection and a Radix parameter Popover; reference uploads/library; conversation actions; task cards/list; original preview; gallery filters and a responsive virtual grid.
- `src/react/pages/ImagePage.tsx`, `ImageGalleryPage.tsx`, router/runtime, mode tabs and sidebar actions.
- Remove the now-unreferenced candidate `WorkspaceHome.tsx` placeholder. The legacy Vue pages and every existing test remain enabled.
- `tests/react/images.spec.ts`: adapt the existing real image regression to the candidate UI, preserve generation/edit/idempotency/cancellation/refund/file/privacy/pagination/1000-file rendering assertions. Account and admin form journeys remain enabled in the original suite until PR-5/PR-6 and candidate fixture setup uses real APIs.
- Focused controller and option-selection tests cover unknown responses, navigation/identity races, stale versions and SSE/polling fallback.

Pending submissions retain both the original payload and key even when a later retry receives HTTP 429. A later rejection does not disprove the earlier unknown transaction outcome. The candidate regression drops a real accepted response, injects one browser-side 429, then replays against the real backend and asserts three identical keys and exactly one provider call. A first definitive rejection still permits editing the draft. This tightens frontend recovery without changing backend idempotency or settlement.

The browser tests additionally cover independent chat/image drafts, IME/Shift+Enter, parameter Popover bounds, failed-event polling, real ZIP file headers, gallery filters and batch deletion. Candidate credit/profile/admin setup uses real APIs for pages assigned to PR-5/PR-6; the original suite retains their UI assertions. Production code has no fixture endpoint or synthetic price, balance or task result; fault injection is confined to Playwright.

The first image attempt found a select-label association issue and the next found a shared reference class included historical references in a composer lookup. Explicit accessible names and separate task/composer markers fix those issues. Failure traces are retained under ignored `.tools/react-ui-pr-4/`.

## Compatibility and acceptance

- [x] Keep independent chat/image histories, last-opened IDs, text and reference drafts.
- [x] Keep model selection inside the bottom composer and quality/ratio/size/count inside the parameter Popover, including 320px keyboard/touch access.
- [x] Render only backend-supported parameters and backend quote/balance/accepted/reserved/actual/refunded values. No invented model capabilities, prices or credit arithmetic.
- [x] Recover unknown submission responses with exactly the original request, including a subsequent HTTP 429 and reopening from history; disconnecting or navigating never cancels a backend job.
- [x] Preserve monotonic task versions, terminal balance refresh, explicit cancellation, partial results, refunds, reference validation and file ownership.
- [x] Preview original files, zoom, previous/next keyboard actions, download/copy/edit/delete, library, gallery filters/cursors, batch ZIP/delete and bounded rendering of 1000 files.
- [x] Frozen installation, typecheck, lint/format, unit tests, both builds and applicable legacy/candidate E2E pass without weakening existing assertions: legacy 16/16 and candidate 18/18.
- [x] [CI #96](https://github.com/xinghenWink/Lumi/actions/runs/40060262906): quality, candidate, Go integration, capacity, audit, Docker/Compose and deployment rehearsal pass. PR #14 merged only into `codex/react-ui` as `ffa3f93`. No new dependencies.

Final candidate validation passes 18/18 on Chrome desktop and 320/390px mobile/touch emulation. Legacy/shared unit tests pass 50/50; candidate/shared tests pass 38/38, including eight focused image tests. Strict typecheck, lint/format, frozen installation and both builds pass. The original performance bounds remain: desktop Lighthouse 100, initial script gzip 245,251 bytes, SSE p95 20/22/20 ms across the three viewports, sampled interactions at most 24 ms and no measured long tasks. Screenshots for light/dark conversations, parameters and virtual galleries have been inspected. Mobile evidence is browser emulation, not a physical-device result.
