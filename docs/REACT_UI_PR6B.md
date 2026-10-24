# PR-6b: AI services administration

## Scope and dependencies

Follow the source and verification plan committed with PR-6a. PR #16 and CI #98 passed before creating `codex/react-ui-pr-6b` from integration merge `2583feb`. Migrate upstreams, platform models/routing, chat settings, image settings/tasks and pricing. Retain Vue as the production default, the existing Go/OpenAPI/SQL/Compose contracts and every legacy assertion. No dependency is added.

## Implementation and file changes

- Lazy `pages/admin/{UpstreamsPage,ModelsPage,ChatSettingsPage,ImageSettingsPage,ImageTasksPage,PricingPage}.tsx` and their router entries.
- `components/admin/{AdminFields,UpstreamDialog,ImportModelsDialog,ModelEditor}.tsx` for typed configuration, credentials, discovery/import and complete capability/route editors.
- `features/admin/{catalog,options}.ts`: immutable API input projection, public/private option invalidation and unambiguous normalized ratio mapping. Existing shared form/table/notice/dialog components remain in use.
- Connection results bind the upstream version. Discovery has an abortable, nonpersistent query lifetime; imports retain its version, aliases, types and conservative protocol defaults, with explicit later activation. Runtime capability/price selectors still read the backend.
- Password inputs are uncontrolled refs and clear after save/unmount. Empty editing input preserves credentials; a separate translated checkbox requests key clearing only on disabled channels. Responses and caches contain configured flags, never the secret input.
- Versioned forms initialize from backend snapshots, preserve drafts on conflicts and apply new snapshots only after explicit refresh/save. Pricing preserves exact decimal strings and existing global rules; new override amounts/multipliers are empty required inputs. Account balances and accepted task costs remain server-owned.
- Image task metadata, privacy-gated audited detail/file access, deletion and confirmed terminal refunds reuse the original endpoints. The manual refund regression drops a successful response, retries, and verifies one balance change and one refund audit record.
- Shared `Panel` supports an untitled container for settings pages, keeping one page heading. The Radix model menu explicitly removes the trigger's default labelled-by association so the existing Available models label remains accessible.

## Test migration and initial findings

The original catalog journey is represented in the React suite with all behavior assertions retained, including imported disabled models, defaults/routes, preserved keys, private DTOs, bottom composer placement, both themes, channel lifecycle and public availability. It adds disabled-only key clearing/restoration with real upstream authentication. Chat settings, pricing and image privacy/configuration UI steps previously deferred to this phase are restored; registration/mail/operations setup remains real API fixture work until PR-6c.

The first catalog browser run found Radix's generated labelled-by association overriding the explicit menu label. The component label was fixed; the original exact label assertion and menu placement bound pass. Failure evidence is retained under ignored `.tools/react-ui-pr-6b/`.

Focused desktop runs pass: full catalog; versioned chat/image configuration and ratio validation; model conflict/pricing overrides; full finance; full streaming chat; and full image editing/gallery/privacy/manual-refund recovery. Unit coverage adds normalized duplicate-ratio rejection and retains all existing tests.

- [x] Frozen install, strict typecheck, lint/format and both unit suites (50 legacy/shared and 42 React/shared).
- [x] Both builds and original 16 legacy browser cases.
- [x] Full Chrome candidate suite on desktop and 320/390px touch/mobile emulation, with unchanged SSE/script/Lighthouse/DOM/interaction bounds.
- [x] Inspect desktop/mobile configuration, routing, pricing and task/privacy screenshots.
- [x] Current-head CI quality/integration/capacity/audit, candidate E2E and Docker/Compose before integration.

## Next dependency

The final local candidate run passes 39/39. Desktop Lighthouse is 100, initial script gzip 248,394 bytes, SSE p95 19/19/19 ms, sampled interactions at most 16 ms and long tasks 0. Both Chrome mobile projects retain the full touch/device emulation and the original performance bounds. Success/failure evidence is retained under ignored `.tools/react-ui-pr-6b/`.

CI #99 (`40069745251`) passes all jobs on `a4a6db6` on the first CI attempt, including quality/integration/capacity/audit, Chrome and Docker/Compose/deployment rehearsal. PR #17 merged only into `codex/react-ui` as `24915ca`; main is unchanged.

PR-6c completes operations/security and every remaining route, then proves full React Docker embed acceptance. PR-7 may only switch the entry and remove Vue after those gates; it repeats final checks and proposes a release PR without merging main.
