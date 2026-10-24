# PR-1: React foundation and independent session port

## Scope

The production entry remains Vue. `pnpm dev:react` and `pnpm build:react` explicitly select the candidate in `frontend/src/react/`; both builds retain `#app`, the API proxy, `backend/web/dist`, same-origin assets and Go embed. Do not run either build while the other version's E2E server is using that directory.

The candidate is a foundation screen with real build-version data, locale and appearance. It does not claim migrated authentication, chat, image generation, credits or administration; these remain assigned to PR-2–PR-6 in the compatibility matrix.

## Changes

- Add exact React ecosystem/tooling versions and lockfile entries, with reasons in ADR-115. Keep every existing Vue dependency. The repository registry points to npm's official source so a lagging local mirror does not select unavailable versions.
- Add strict TSX configuration, React hooks/refresh lint rules, Tailwind 4 tokens, shadcn-style button/Radix composition and provider/router/runtime foundations.
- Extract the authorized-client factory and session contract. Build aliases select an explicit legacy or React adapter; the shared endpoint modules and generated types remain at their existing paths.
- Guard requests against identity-generation changes, aborts and duplicate concurrent refresh. Preserve mutation body/key, cookie/CSRF behavior and single unauthorized retry.
- Add the independent `api/auth-session.ts` core, used by both the temporary Vue facade and the React/Zustand adapter. Login/register cookie writes are serialized with older refresh/authentication requests, and logout waits for outstanding cookie writes. Private query caches are cleared both on generation changes and when the authenticated identity arrives. Tokens never enter browser storage.
- Extract existing locale resources as framework-independent data. Keep keys, `{name}` interpolation and literal email text compatible without changing the legacy locale engine.
- Add a candidate Chrome desktop/mobile-emulation job alongside unchanged full legacy scenarios. Candidate bundles fail if Vue, Pinia, Reka or Vue locale/icon modules are included.

## Validation

| Validation                                   | Local result                                                                               |
| -------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `pnpm install --frozen-lockfile`             | Pass                                                                                       |
| `pnpm typecheck`                             | Pass for both Vue and strict React configurations                                          |
| `pnpm lint`                                  | Pass, including React hooks/refresh rules and repository formatting                        |
| `pnpm test`                                  | Pass: legacy/shared 50 tests and React/shared 16 tests; all original 45 tests retained     |
| `pnpm build` / `pnpm build:react`            | Both pass; candidate legacy-module exclusion gate passes                                   |
| Full legacy E2E after shared-core extraction | Pass: 16/16, fresh isolated PG16/Redis7, 2.8 minutes                                       |
| Candidate E2E                                | Pass: Chrome desktop, 320px and 390px touch/mobile emulation, 3/3; production Go embed     |
| `pnpm audit --prod --audit-level high`       | Pass, no known vulnerabilities found                                                       |
| OpenAPI regeneration/diff                    | Pass; generated types unchanged                                                            |
| Visual inspection                            | Desktop and 320px dark/English foundation captures show no clipping or horizontal overflow |

Logs and preserved screenshots live in ignored `.tools/react-ui-pr-1/`; CI publishes separate candidate/legacy artifacts. Existing lazy-chunk size warnings remain visible; the initial script budget is not relaxed. No SQL/OpenAPI change, Go business modification, deployment or production entry switch is included. Current-head Linux CI and Docker/Compose must pass before integration.

The first local legacy rerun reused PR-0 Redis state and received HTTP 429 at registration in both image scenarios (14/16 passed). The preserved network traces identify the existing IP quota; no limit, test assertion or business rule was changed. Fresh isolated PG/Redis runs are required for final acceptance, matching CI's disposable services. Failed traces remain in ignored `.tools/react-ui-pr-1/legacy-first-attempt/`.
