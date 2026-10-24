# PR-6: Complete administrative migration

## Bounded sequence and dependencies

Use the independent AdminShell and its existing overview, users/finance, AI services and operations/security groups. Keep every baseline route and operation in REACT_UI_COMPATIBILITY.md. The candidate remains separate from the Vue production default until final acceptance; no backend business, OpenAPI, SQL or Compose rewrite is planned.

PR-5 supplies typed table/form primitives, cursor queries, owned mutations, exports and reusable credit views. Its local gates pass; its CI remains an integration gate. To keep reviews bounded, the authorized PR-6 milestone is split into sequential branches/PRs:

| Sub-PR | Scope                                                                                                           | Dependencies and gates                                                                                                                                              |
| ------ | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 6a     | Users, user detail/sessions/credits, ledger and redeem codes/batches                                            | Reuse PR-5; real create/edit/status/self guards, user/credit exports, batch actions, idempotent grants/adjustments, code lifecycle, pagination and permissions.     |
| 6b     | Upstreams, models/routing, chat settings, image settings/tasks and pricing                                      | Reuse 6a; real discovery/import/tests, secret preserve/clear, optimistic versions, capabilities, prices, image privacy/audit and terminal manual refund.            |
| 6c     | Dashboard, conversations, announcements, site/registration/mail settings, operations settings, system and audit | Reuse 6b; real statistics, metadata/content permissions, versioned announcements, maintenance/Turnstile/quota/circuit settings, bounded cleanup and redacted audit. |

Each sub-PR runs frozen install, strict typecheck, lint/format, unit tests, both builds, related legacy/candidate browser cases and full CI before integration. The final administrative gate is the complete compatibility matrix, existing performance bounds and Chrome desktop/320/390px acceptance. The original suites stay enabled; candidate setup uses real APIs only where a later sub-PR still owns the corresponding form.

## PR-6a source plan

- `src/react/pages/admin/{UsersPage,UserDetailPage,CreditLedgerPage,RedeemCodesPage}.tsx`.
- `src/react/components/admin/`: common page frame, confirmed user CRUD/batch dialogs and typed filter/row components where a page needs a bounded split.
- Reuse `CreditOverview`, `CreditLedger`, `RedemptionRecords`, `useCursorQuery`, `useOwnedMutation` and `createMutationKey`. New user balances come from the backend; no client settlement or adjustment arithmetic is introduced.
- Extend private CSV download validation to retain the existing CSV MIME contract and identity/Blob lifecycle.
- Candidate admin user/credit/code tests preserve existing behaviors, add batch grants/revocation and keep backend last-admin/self/role enforcement. Financial failures preserve the original request identity on retry.
- No new dependency is planned. The subsequent sub-PRs use the original API DTOs and keep provider secrets out of caches, URLs, logs and persistent storage.

## Progress

- [ ] 6a users/finance and its browser/CI gates.
- [ ] 6b AI services and its browser/CI gates.
- [ ] 6c operations/security and its browser/CI gates.
- [ ] All administrative routes/actions covered before PR-7 entry switch, Docker acceptance and Vue cleanup.

## PR-6b source and verification plan

Read the original UpstreamsPage, ModelsPage, ModelEditor, ImportModelsDialog, ChatSettingsPage, ImageSettingsPage, ImageTasksPage and PricingPage against `api/catalog.ts`, `catalog-contracts.ts`, `chat.ts`, `images.ts`, `credits.ts` and their OpenAPI definitions. Keep optimistic versions and backend validation; public selectors continue to read capabilities and prices from the server.

- Lazy pages: `pages/admin/{UpstreamsPage,ModelsPage,ChatSettingsPage,ImageSettingsPage,ImageTasksPage,PricingPage}.tsx`.
- Bounded dialogs/editors in `components/admin/`: upstream credentials/configuration, remote discovery/import, model capabilities/routes and confirmed deletion/refund.
- Reuse typed Query cursor resources, owned mutations, forms and tables. Discovery reads abort on close; test results bind the original upstream version; secret inputs stay out of Query data and mutation variables and clear after save/close.
- Model inputs preserve every route's upstream/model ID, enabled flag, priority and weight; image capabilities expose all existing quality/size/count/edit/reference/response-format fields. Imports use the discovery version and remain disabled until an explicit administrator action.
- Settings forms initialize from actual backend snapshots and submit complete existing DTOs, including hidden fields/version. Configuration changes invalidate public options/model/quote caches. New prices require explicit administrator input instead of a hardcoded amount.
- Image task metadata/detail use the original privacy boundary and audited content/file endpoints. Manual refund is confirmed, terminal-only and based on server results; the browser never calculates a refund.
- Restore the original catalog, chat-setting, image-setting and pricing UI assertions in candidate tests; add version-conflict, secret handling, settings persistence and manual-refund cases. Keep all original legacy tests and thresholds until final migration acceptance.
