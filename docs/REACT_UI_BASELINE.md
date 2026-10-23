# React UI baseline and PR-0 evidence

## Source and environment

- Baseline commit: `c28be7fe16ca911f2b9443c27ce887f14f96b5d8`.
- Source branch: `main`, matching remote main during the initial audit.
- Date: 2026-10-24, Asia/Shanghai.
- Local Node: 22.19.0; pnpm: 10.27.0; verification Go: 1.26.10 via GOTOOLCHAIN.
- Initial working tree: only the user-supplied untracked `docs/Lumi-React-UI-Design-Package/`.
- All reports and temporary assets use ignored `.tools/react-ui-pr-0/` or normal ignored test output. No credentials or authenticated traces are committed.

## Initial audit results

| Check                                     | Result                   | Scope                                                                         |
| ----------------------------------------- | ------------------------ | ----------------------------------------------------------------------------- |
| `pnpm typecheck`                          | Pass                     | Existing Vue/strict TypeScript                                                |
| Frontend ESLint                           | Pass                     | Existing frontend                                                             |
| `pnpm test`                               | Pass: 12 files, 45 tests | Existing unit/contracts/store regressions                                     |
| `pnpm build`                              | Pass                     | Existing output in backend/web/dist; lazy KaTeX chunk warning retained        |
| OpenAPI generation                        | Pass                     | Formatted temporary generated types match committed schema.d.ts               |
| Pinned Go guest E2E                       | Pass: 4 tests            | Desktop/mobile route guard, legal pages, theme and 404 using production embed |
| Root `pnpm lint`                          | Failed initially         | Supplied Markdown formatting and malformed reference HTML closing structure   |
| Full authenticated E2E/integration/Docker | Not run in initial audit | Docker engine unavailable; E2E database and Redis URLs absent                 |

## Reference provenance

Five PNG concept views, the HTML prototype and the supplied Chinese implementation brief belong to the user-provided design package. These are concept artifacts, not screenshots of the current running application. PR-0 formats the brief and normalizes/formats HTML without transferring demonstration logic into production.

The original mobile PNG's cropping is not a production acceptance target. Original SHA-256 values are recorded before any normalization:

| Supplied file                         | Original SHA-256                                                 |
| ------------------------------------- | ---------------------------------------------------------------- |
| Lumi-React-Refactor-Plan-for-Codex.md | 6fc70824ea0ce50f841fe27cdbdd5ba118a067dfa5d1fef791def0bb4a62df55 |
| Lumi-React-UI-Preview.html            | 960c3195f8c4bf91127b889719ae4ce9d1108eb6ecb1705ef8a7e81050a07966 |
| Lumi-UI-Admin.png                     | 8f13ecf7da279eb5993a733d091759051c670ce0d2f6e5d3593b83b6b4e61778 |
| Lumi-UI-Chat.png                      | dcbee681ed2eb5b8bb9217b07815a2e727d10310f0a9acdd24699c3678df1603 |
| Lumi-UI-Image-Settings.png            | cd6dcfca474ed20bebfba3a0b73d14b8099a79e7791494e703e757283298f6e8 |
| Lumi-UI-Image.png                     | 6215a93a355611a1fc89f63b2ca04dad7d3c3222294a8a1eb6ea1b1fbaaa621a |
| Lumi-UI-Mobile.png                    | 543405401fee59c9ecea9c1c7893ab9ba13957d8f4e2a64aa0a7d83f6d4e2ec8 |

HTML repair uses browser-compatible DOM serialization followed by Prettier, preserving the browser's existing interpretation of malformed nesting. Original/repaired chat, image and admin renders at 1440×900 and 320×900 have **zero changed pixels in all six comparisons**. Theme, parameter popover, mobile drawer and mode switching smoke checks have no page errors. The PNG references remain byte-for-byte unchanged. The original HTML, twelve comparison images, raw/post-repair hashes and `reference-check.json` live in ignored `.tools/react-ui-pr-0/`.

## PR-0 final validation

| Command/check                                                    | Final local result                                                                                      |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `pnpm typecheck`                                                 | Pass                                                                                                    |
| `pnpm lint`                                                      | Pass, including the repaired reference package                                                          |
| `pnpm test`                                                      | Pass: 12 files, 45 tests                                                                                |
| `pnpm build`                                                     | Pass; production asset location unchanged                                                               |
| `pnpm api:generate` and generated-file diff                      | Pass, no type contract changes                                                                          |
| `GOTOOLCHAIN=go1.26.10 go test ./...`                            | Pass                                                                                                    |
| `GOTOOLCHAIN=go1.26.10 go test -tags=integration -count=1 ./...` | Pass with real disposable Docker dependencies                                                           |
| Full `pnpm test:e2e`                                             | Pass: 16/16 desktop/mobile cases, 2.8 minutes, real isolated PG/Redis and production embedded Go server |
| Reference repair comparisons/smoke                               | Pass: six zero-pixel-difference comparisons; no page errors                                             |

The full browser run retained the existing performance, long-history/gallery, image-editing, partial-refund, cancellation, redemption replay and administrative privacy assertions. This is the existing Chromium/viewport matrix, not the explicit Chrome/mobile-emulation matrix planned for the React candidate.

Local logs and preserved Playwright outputs are in `.tools/react-ui-pr-0/`. The reference-only repair does not change production code, dependencies, migrations or OpenAPI. Docker image/Compose and Linux CI gates remain tracked separately; a local E2E build is not described as a Docker image verification. GitHub status must refer to the actual PR head before integration.
