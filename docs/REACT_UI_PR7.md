# PR-7: React default, dependency cleanup and release proposal

## Entry gate

Do not apply this stage until PR-6c passes its complete native Chrome suite, original Vue suite, actual production React Docker embed and all current-head CI jobs, then integrates only into `codex/react-ui`. Main must remain `c28be7fe16ca911f2b9443c27ce887f14f96b5d8`. Commit this analysis and acceptance plan before implementation on `codex/react-ui-pr-7`.

## Audited file changes

- Switch `frontend/index.html` to the existing `src/react/main.tsx`; simplify `vite.config.ts` to the React/Tailwind plugins and keep the legacy-module rejection guard active for the default build. Preserve `#app`, URLs, favicon, output `backend/web/dist`, CSP and Go production embedding.
- Make the normal dev/build/typecheck/test/E2E scripts use React. Preserve candidate script aliases if useful for established commands. Consolidate strict TSX configuration, session alias and ESLint; remove only Vue compiler/plugin/rules.
- Remove these exact frontend package dependencies: `@tanstack/vue-virtual`, `lucide-vue-next`, `pinia`, `reka-ui`, `vue`, `vue-i18n`, `vue-router`; dev dependencies `@vitejs/plugin-vue`, `eslint-plugin-vue`, `vue-tsc`. Update only the corresponding pinned manifest/lock resolution. Do not upgrade unrelated packages or introduce a testing dependency.
- After tests are ported, remove the inventoried `.vue` files, old `src/main.ts`, `src/app/router.ts`, seven Pinia implementation files, `src/api/session.legacy.ts`, `src/i18n/index.ts`, Vue-only `features/accounts/time.ts`, `features/credits/resources.ts`, `features/images/actions.ts` and the six old `src/styles/*.css` files. Verify every target path and import before deletion. Retain shared APIs/types, accounts utilities, chat messages/Markdown/SSE, image fixtures/contracts, locale data and all meaningful tests.
- Remove the last unused React SectionPage scaffold and replace its fallback with explicit complete route mapping so new navigation entries cannot silently render a heading-only page. Keep all existing complete pages lazy and preserve the 250000-byte initial-script bound.
- Default Docker frontend becomes React; the smoke driver proves the default production build, not a hidden alternative. Keep all backend/runtime Docker stages and production Compose unchanged.
- Update README stack/diagram/development instructions, migration compatibility/evidence documents and ADR-124. Historical Vue decisions remain historical. No API/OpenAPI/schema/SQL/business-rule change or version/tag/deployment is needed.

## Original unit acceptance migration

Keep every test case and behavioral assertion in these original five files, adapting their target to the real session service, Query and Zustand controllers. Rehome tests into a React compatibility directory if appropriate; do not remove them to obtain a green run.

| Original file           | Cases | React acceptance target                                                                                                                                                                                                                                |
| ----------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `stores/auth.test.ts`   | 4     | Coalesced refresh, no stored tokens, CSRF/credentials, expired/late results, transient failure preservation and server-acknowledged logout.                                                                                                            |
| `stores/chat.test.ts`   | 5     | Exact retry request, durable messages, regeneration without duplicate user turns, late account data/drafts, deletion of filtered-out histories, retained new/independent drafts, no late stream resurrection and late mutations after identity change. |
| `stores/images.test.ts` | 5     | Earlier submit cannot change a later view/draft, exact body/key replay, identity clear, SSE-to-poll fallback without cancellation and delayed old-view events.                                                                                         |
| `stores/models.test.ts` | 3     | Actual `useModels` hooks with RuntimeContext/QueryClientProvider and React DOM/act: independent defaults/selections, cancelled stale reads/account reset, empty choices and mixed-mode rejection. No mirrored fake store.                              |
| `stores/system.test.ts` | 3     | Real `getVersion` through Query cache: valid metadata, errors/malformed JSON/retry and concurrent coalescing.                                                                                                                                          |

Preserve all other original protocol/contract/Markdown/SSE tests and all existing React tests. Adapt three shared translation contract tests from Vue-i18n to `createAppI18n` and their existing locale/key/interpolation assertions. Point the original credit idempotency test at the existing React `createMutationKey`, retaining request/CSRF/auth/MIME assertions. Final Vitest discovery includes all shared and React tests once.

## Browser acceptance migration

Retain the original eight journey entry points. Their ported implementations may be imported from the already accepted React journey modules, with explicit canonical Playwright matching so no assertion suite is accidentally skipped or duplicated. Keep the original two guest tests unchanged. Run Chrome desktop and full Pixel touch/mobile emulation at 320px and 390px.

| Original entry       | Preserved implementation and behavior                                                                                                                                                                                                                                                                                                                                               |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `accounts.spec.ts`   | `react/account-settings.spec.ts`: original registration/session/roles/menu bounds/profile/dark/disable/relogin/user-edit/detail/audit/SMTP/delete/registration-off assertions.                                                                                                                                                                                                      |
| `catalog.spec.ts`    | `react/catalog.spec.ts`: full original create/edit/test/discover/import/activate/default/routing/public-selector/privacy/channel lifecycle, plus explicit secret clear/restore.                                                                                                                                                                                                     |
| `chat.spec.ts`       | `react/chat.spec.ts`: streaming/edit/regenerate/stop/retry/export/history/delete/clear/virtualization/performance, plus metadata/content/audit boundaries; recovery/vision remains a separate required journey.                                                                                                                                                                     |
| `credits.spec.ts`    | `react/accounts-credits.spec.ts` and `react/admin-finance.spec.ts`: signup/daily gifts and bucket totals/empty usage/30 days/viewport, exact redemption replay, code generation/copy/cursors/status/deletion/records/CSV, all adjustments and initialized users. Original gifts are covered through real public registration, never substituted with an initial-credit admin grant. |
| `guest.spec.ts`      | Both existing public/guard/theme/legal/404 cases remain unchanged.                                                                                                                                                                                                                                                                                                                  |
| `images.spec.ts`     | `react/images.spec.ts`: original full real registration/chat/credits/generate/edit/partial refund/privacy/gallery/thumbnail/virtualization, plus independent drafts/parameters/references/ZIP/delete/manual refund/retry.                                                                                                                                                           |
| `operations.spec.ts` | `react/operations.spec.ts`: full original dashboard/banner/preferences/export/security/system/announcements/metrics assertions.                                                                                                                                                                                                                                                     |

Also retain every existing new candidate journey: auth/reset/shell, foundation/locales, account/security, administration/users/finance/settings, chat recovery and operations writes. The resulting canonical set is 19 journeys × 3 projects = 57 cases. Ensure all desktop/mobile conditionals continue to execute Lighthouse and the original mobile bounds. Add explicit `toBeInViewport` for the retained usage-list viewport assertion if currently implicit in `scrollIntoViewIfNeeded`.

## Verification and release boundary

1. Frozen install; strict typecheck; ESLint/Prettier; complete shared/React unit suite; generated OpenAPI diff check; default production build and guard proving no Vue modules.
2. Fresh owned PostgreSQL/Redis, all 57 real Go-embedded Chrome cases sequentially; retain failures, fix and rerun relevant/full gates when justified. Keep SSE p95 <100ms, gzip ≤250000 bytes, Lighthouse ≥90, interaction/long-task and chat/gallery DOM/thumbnail bounds.
3. Inspect desktop/mobile/contrast, composer model placement, image Popover and admin layouts. The prototype remains a reference only.
4. Build actual default Docker image with exact head metadata; three-project authenticated production embed, environment overrides and asset/resource boundaries. Keep production Compose, installation/upgrade/rollback and backup restoration CI exercises.
5. All exact-head CI jobs green before the release proposal. Integrate the final milestone only into `codex/react-ui`, then create the complete reviewable release proposal PR against main (or make PR-7 itself the release proposal with the complete integration diff). Attach every PR. Never merge main, tag, publish or deploy.

## Implementation progress

- [x] Entry gate: PR-6c CI #101 passed all jobs on 2b6d0e3; PR #18 integrated only into codex/react-ui as ae05cbe.
- [x] Plan committed before implementation (41b3657).
- [x] All original 20 state cases ported to actual React/session/Query/Zustand behavior; three translation contract tests and credit idempotency assertions retained.
- [x] Default entry/build/typecheck/lint/test now React; 10 direct Vue dependencies and 81 inventoried obsolete files removed. The lockfile only removes 558 lines and adds no package resolution.
- [x] Strict typecheck, lint/format, frozen install and all 87 deduplicated unit cases pass; normal production build passes its no-Vue-module guard.
- [x] Canonical discovery lists exactly 57 Chrome cases in 14 source files, preserving all original entries and new regressions.
- [ ] Full default production-embed Chrome acceptance, unchanged performance bounds and visual inspection.
- [ ] Actual default production Docker embed and all exact-head CI jobs.
- [ ] Integration and a reviewable release proposal targeting main, without merging or deployment.

The original browser entry files delegate to their already migrated complete React implementations; these implementations remain required by canonical test discovery. The original signup gift assertion is covered by public registration with exact daily/permanent totals, not replaced with an administrator grant. The usage list retains its explicit viewport assertion as well as the new 30-row count. No test or performance threshold was removed to obtain a pass.

The real-hook model test initially did not subscribe to Query's tracked error property. The test probe now consumes the status/error fields used by the production picker, preserving its mixed-mode rejection assertion. No product rule was changed to accommodate the fixture.

The first default-entry full run exposed an incomplete reload assertion in the original account journey: checking the unchanged URL could succeed before refresh finished, then another hard navigation interrupted the in-flight refresh. The journey now also waits for the authenticated chat heading after reload before testing the admin guard. This strengthens session-restoration coverage; authentication handlers, timeouts and role assertions are unchanged. Failure traces are retained for comparison with the required full rerun.

Canonical discovery matches every browser spec by default and excludes only the independent embed suite and the seven implementations already imported by original entries. New unrelated test files remain automatically discovered; the current set is still exactly 57 cases.
