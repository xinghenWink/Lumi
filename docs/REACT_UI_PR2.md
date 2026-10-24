# PR-2: Authentication and application shells

## Scope and files

The default production build remains Vue. The explicit React candidate now implements real login, registration, verification-code requests, Turnstile actions, forgot/reset password, terms/privacy and 404 pages. It restores every existing route with session/admin guards. `/create` and its query/fragment are permitted safe internal login destinations; external redirects and prefix lookalikes remain rejected.

- `frontend/src/react/app/router.tsx`: lazy public/workspace/admin route trees and localized loading states.
- `frontend/src/react/features/auth/`: session/public-config hooks, role/maintenance boundaries and disposable Turnstile challenge adapter.
- `frontend/src/react/layouts/`: PublicShell, WorkspaceShell and separate AdminShell.
- `frontend/src/react/components/shared/`: real branding/version, theme persistence, credit balance, chat/image history, responsive navigation, account menu and sanitized announcements.
- `frontend/src/react/pages/`: authentication, recovery, legal and not-found pages. WorkspaceHome and SectionPage intentionally contain no fake business results; chat/image/account/admin business implementations follow in PR-3–PR-6.
- `frontend/src/react/stores/theme.ts`: local/system appearance, including OS changes.
- `frontend/src/features/accounts/utils.ts`: extend the existing safe destination allowlist to the preserved image route.
- `frontend/tests/react/`: grow the embedded Chrome suite while retaining version, language, storage, mobile and console-error checks.

There are no backend, migration, OpenAPI, pricing, task, settlement, Compose or dependency changes. All prior API parsers/types and the shared PR-1 authentication service remain in use. Private values never enter browser storage. Reset tokens are captured from the fragment and immediately removed from the address bar, including under StrictMode.

## Compatibility decisions

Desktop navigation is 260px; the mobile drawer is 268px with viewport bounds, a focus trap, Escape restoration and close-on-navigation. The anchored account menu is at most 264px and collision constrained. Ctrl/Cmd+K focuses the visible history search, opening the mobile drawer first. Chat and image sidebar requests use their distinct endpoints and cursor/search parameters. Full independent drafts/controllers are assigned to PR-3/PR-4.

Admin navigation contains overview, users/finance, AI services and operations/security groups. Every existing admin route is retained, including user detail and optional settings groups. A regular member cannot enter AdminShell; the backend continues enforcing authorization. Maintenance comes from public configuration and permits administrators through the existing server rule.

Theme toggles persist the complete existing preference contract, preserving instructions and image defaults. Public branding, favicon, footer, registration availability and challenge settings come from the backend. Announcement Markdown reuses the existing sanitizer/renderer and does not load arbitrary assistant image URLs.

The first browser run found Radix's default modal scroll-lock style injection violated the existing CSP. The fix uses the supported nonmodal account menu and a static drawer overlay while retaining modal Dialog.Content focus/accessibility handling. No CSP directive or console-error assertion was weakened. Failure traces are preserved in ignored `.tools/react-ui-pr-2/csp-first-attempt/`.

## Acceptance and remaining stages

- [x] Both strict TypeScript configurations, ESLint/hooks/refresh and Prettier pass.
- [x] All legacy/shared 50 tests and React/shared 21 tests pass. Added OS appearance, challenge action/disposal/failure and candidate translation-key coverage.
- [x] Both Vue and React builds pass and retain `backend/web/dist`; React's legacy-module exclusion gate passes.
- [x] Chrome desktop, 320px and 390px mobile/touch emulation exercise real Go embed, PostgreSQL and Redis. Registration, recovery, HTTP-only refresh cookies, reload, safe destinations, role gates, drawer/menu bounds, keyboard focus, appearance persistence, public pages and browser errors are checked.
- [x] Stage-head CI [#94](https://github.com/xinghenWink/Lumi/actions/runs/40022299040) passed all three jobs on `8752e6c00ec1354d5f6e0359884b6908a3846c8b`, including unchanged full legacy E2E, integration, capacity and Docker/Compose, before PR #12 integrated only into `codex/react-ui`.

The browser suite uses a disposable local backend and random test credentials. Registration is enabled through its real admin endpoint with email verification disabled only for the registration fixture, and prior settings are restored. Live SMTP delivery and Cloudflare Siteverify require configured providers; adapter lifecycle tests and existing Go protocol tests do not claim live-provider acceptance. No production setting is accessed or changed.

Local logs and screenshots are preserved under ignored `.tools/react-ui-pr-2/`; CI publishes its browser artifacts. Remaining profile, device, credits, chat/image and admin actions are tracked in the main compatibility matrix and are required before switching the production entry or removing Vue dependencies.

This is the PR-2 stage snapshot. Those later stages have since completed in PRs #13–19; see the [final handoff](REACT_UI_REFACTOR.md#completed-migration-and-review-handoff) and [PR-7 acceptance](REACT_UI_PR7.md#completed-acceptance).
