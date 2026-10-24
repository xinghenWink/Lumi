# PR-6c: Operations, security and React container embed

## Dependency and source audit

Start from PR-6b integration merge `24915ca`, after PR #17 and CI #99 pass. The original OperationsPage, SettingsPage, AuditPage, operations/account clients and the corresponding Go handlers/OpenAPI were inspected. Preserve all existing routes, fields, actions, scopes and tests. Keep Vue as the production default until this complete administrative migration and React container acceptance pass.

## File and component plan

- Lazy `pages/admin/{DashboardPage,ConversationsPage,AnnouncementsPage,OperationsSettingsPage,SystemPage,SettingsPage,AuditPage}.tsx` replaces every remaining administrative placeholder.
- Reuse AdminPage, Panel, typed forms/tables, cursor resources, owned mutations and sanitized lazy Markdown. Add bounded dialogs for announcement edits/deletes, controlled message access and confirmed cleanup as needed.
- Dashboard preserves backend totals, 1/7/30-day UTC trends, all eleven daily columns and upstream call/success/latency statistics. Presentation calculations do not change billing.
- Conversation lists request metadata only; content is fetched after explicit selection, checked by the existing `admin_can_view_content` permission and audited endpoint, and retained only for the open detail view. Filters/cursors bind the submitted user ID and keep existing deep links.
- Announcements preserve UTC start/end times, enabled state, optimistic versions, multiple active messages, Markdown and cursor paging. Confirmed writes invalidate the current actor's banner/list queries.
- Site/registration/mail forms initialize from the complete backend snapshot, disable environment-overridden fields, preserve every existing limit/domain/branding/link field and send only the current group. SMTP inputs are uncontrolled and honor configured/preserve/explicit-clear semantics.
- Operations settings preserve maintenance, Turnstile, IP quota, sensitive words and circuit controls. Secret clearing requires Turnstile disabled; public configuration is refreshed after writes. System retains dependency/build/storage status, test-mail action and confirmed bounded cleanup.
- Audit retains action/actor/target/date filters, opaque cursors, localized labels, actor links and backend-redacted before/after data behind explicit change details.
- Existing client reads may gain optional AbortSignal arguments; endpoint paths, DTOs, roles, versions and backend/SQL rules remain unchanged. No new package is planned.

## Container embed plan

The existing Dockerfile runs the Vue default build, so existing container CI does not prove React packaging. Add a guarded frontend variant argument with the existing default preserved, then explicitly build the React variant. Leave production Compose unchanged.

`scripts/react-embed-smoke.mjs` will create isolated, labelled temporary PG/Redis/app containers, generate ephemeral credentials, build the actual production Go-embed image and run `frontend/playwright.embed.config.ts` with `tests/embed/embedded.spec.ts` on Chrome desktop and 320/390px touch/mobile emulation. Verify real readiness/version, authenticated React pages, deep links/themes, CSP/static asset behavior and API/resource 404 boundaries. Clean up only owned containers/network/anonymous volumes and secret fixture files; retain nonsecret evidence. Reuse existing locked Node/Playwright/Docker tools.

CI retains its current quality, full legacy/candidate suites, capacity/audit, production Compose and upgrade/rollback/backup rehearsal. Add React container embed acceptance to the container gate. This separately proves container packaging; full native Go production-embed Chrome journeys continue to prove SSE, credits and image editing. PR-7 cannot remove Vue until both are green.

## Test plan and gates

- Port the original account settings/audit/SMTP and operations dashboard/preferences/export/system behavior assertions into the candidate suite without deleting legacy tests.
- Add real announcement CRUD/version conflicts/banner refresh, operations writes/secret clearing, controlled conversation content/audit, environment read-only fields where configured, and confirmed system action coverage.
- Keep existing strict types, lint/format, unit tests, both builds and all original performance bounds. Initial script gzip is currently 248,394 bytes; if new routes exceed the 250,000 bound, split administrative dispatch instead of increasing the limit.
- Run frozen install, typecheck, lint/format, units, full candidate Chrome desktop/320/390 and original legacy suite sequentially. Inspect visuals and retain failed/passing evidence.
- Run React Docker embed acceptance locally and in current-head CI, then merge only into the integration branch and start PR-7 automatically. Main and deployment remain untouched.

## Progress

- [ ] All operations/security routes and existing functions migrated.
- [ ] Real candidate/legacy, static/unit/performance and visual gates.
- [ ] Actual React Docker production embed accepted locally and in CI.
- [ ] Integration complete before PR-7 entry switch and Vue cleanup.
