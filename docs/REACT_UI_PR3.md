# PR-3: Chat, history and durable streaming

## Scope and implementation

The explicit React candidate now implements `/chat`, `/chat/:id` and `/me/chats`. The default production entry remains Vue. No backend, OpenAPI, migration, Compose or business-rule changes are required.

The controller in `frontend/src/react/features/chat/controller.ts` stores server conversation/message snapshots in TanStack Query and interface state in Zustand. It reuses the existing API parsers, send/resume transport and CSRF/authentication adapter. It batches deltas by animation frame, preserves the exact request ID/body after an unknown response, reconciles durable status, sends an explicit stop command without aborting the reader, and ignores old-identity/deleted-conversation responses. Pending conversation creation also retains its original ID/model payload.

The candidate provides bottom-composer model selection from the real public catalog, per-conversation text/reference drafts, vision uploads, copy, edit, regenerate, stop, retry, rename, pin, delete, cursor history, batch delete, clear all and JSON/Markdown exports. Switching chat/image modes preserves the chat draft and accepted references. Image business functionality remains assigned to PR-4.

Markdown reuses the existing parser, sanitizer, Shiki and KaTeX. Memoized stable blocks avoid reprocessing the full response on every delta. Remote images and arbitrary HTML remain excluded. Protected references use bearer-authorized metadata/blob requests, the existing signature refresh and MIME checks, and disposable Blob URLs. No upstream names, credentials or endpoints are exposed in model selection or stream presentation.

`@tanstack/react-virtual` is pinned at 3.14.22 with its reason in ADR-118. Message and sidebar virtualization retain the original rendering bounds. Their mutable getter APIs sit in explicit `use no memo` boundaries with narrowly documented `react-hooks/incompatible-library` exceptions; the rest of the lint configuration is unchanged. The virtualizer, message rendering and Markdown load on demand. The initial desktop implementation approached the existing 250,000-byte script gzip budget, so empty conversations no longer load virtualization code.

## File changes

- `frontend/src/react/features/chat/`: controller, server-query options and isolation/replay tests.
- `frontend/src/react/features/catalog/models.ts`: independent model selection and validated catalog queries.
- `frontend/src/react/components/chat/`: composer, mode tabs, conversation actions, message/reference rendering and virtualized messages.
- `frontend/src/react/components/images/ProtectedImage.tsx`: shared authenticated image lifecycle for vision and the subsequent image milestone.
- `frontend/src/react/components/shared/`: virtual history, conversation management and streaming Markdown blocks.
- `frontend/src/react/components/ui/modal-dialog.tsx`: focus-managed Radix dialog using the existing CSP-compatible static overlay.
- `frontend/src/react/pages/ChatPage.tsx`, `ChatHistoryPage.tsx`, router/runtime and shared Markdown CSS.
- `frontend/tests/react/chat.spec.ts`: candidate version of the existing chat journey, retaining streaming, privacy, editing/stopping, isolation, history and performance assertions.
- `frontend/tests/react/chat-recovery.spec.ts`: real vision/files, IME, mode drafts/references, refresh/replay, exports and Blob cleanup.
- `frontend/tests/image-fixture.ts`: extract the exact existing deterministic PNG generator for both legacy image tests and candidate vision tests; no legacy assertions are removed.
- `frontend/tests/chat-performance.ts`: allow an explicit Chrome channel for candidate Lighthouse; legacy calls retain their original Chromium behavior and thresholds.

## Validation and evidence

- [x] Frozen-lockfile installation, strict Vue/React typecheck, lint/format and all unit tests pass: legacy/shared 50 and React/shared 30.
- [x] Nine controller tests cover preserved request/creation payloads, edit/regenerate identity, stop vs reader cancellation, durable resume, deletion, old-identity failures, stale-frame isolation and older-history ordering.
- [x] Initial desktop Chrome chat journey passes with the original performance bounds; rendering, code/math, copy, draft switch, stop/edit/regenerate, history operations and 500 loaded messages are exercised.
- [x] Desktop Chrome vision/recovery journey passes. Backend/upstream requests are real. The test injects one browser reader failure to check real Last-Event-ID replay, and one metadata HTTP 401 to check real refresh-cookie recovery. It asserts one upstream call per turn, no duplicate text, owner-only files, exports and zero live Blob URLs after logout.
- [x] Final complete legacy browser suite after fixture extraction: 16/16 pass.
- [x] Final React suite on Chrome desktop and 320/390px mobile/touch emulation: 15/15 pass. Desktop SSE p95 is 19 ms (60 samples), Lighthouse 100, initial script gzip 238,730 bytes, sampled interaction 16 ms and long-task percentage 0. The existing thresholds are unchanged. Light/dark desktop and mobile screenshots have been inspected.
- [x] Production dependency audit: no known vulnerabilities.
- [ ] Current-head CI, integration, capacity and Docker/Compose before integration.

The first candidate desktop run found an implicit label included React textarea initial text in the exact label lookup. The edit field now has an explicit label/control ID. A subsequent recovery test used an incorrect export translation label; it now uses the existing translated action name and jointly awaits click/download so a failed selector cannot leave an unhandled promise. Failure traces remain under ignored `.tools/react-ui-pr-3/`. These are fixes, not removed or relaxed checks.

The original legacy scenarios remain enabled throughout the migration. Candidate chat setup uses real admin APIs because administrative forms are assigned to PR-6; legacy E2E continues exercising those forms. No live external model provider or production data is used for deterministic regression fixtures. Chrome mobile evidence is browser emulation, not a physical-device result.
