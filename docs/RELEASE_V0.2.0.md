# v0.2.0 release plan and compatibility

## Scope and authorization

On 2026-10-24 the user authorized merging accepted React proposal #20 and publishing the next version. PR #20 merged as `aaed88cc19857a306cf10bee7f0d34348182a564` after all CI #109 jobs passed. Per the existing 0.x policy, the complete UI migration is the next minor release, `v0.2.0`; no published tag is moved or replaced.

The earlier migration documents record their stage-specific no-merge/no-publication boundary. This later authorization permits merging and publishing the accepted result. It does not change backend business rules or authorize unrelated infrastructure changes.

## Release preparation files

- `README.md`: describe the React release, versioned assets and upgrade boundary.
- `deploy/.env.example`: select `v0.2.0` for fresh installations. Existing `.env` files remain intact; the installer already preserves them.
- `docs/VERSIONING.md` and `docs/DEPLOYMENT.md`: identify this minor release and use its tag in current release commands, retaining immutable old versions and the existing release gates.
- `docs/DECISIONS.md`: record release selection and authorization. No new dependency, lockfile, runtime code, OpenAPI, SQL or production Compose changes.

## Upgrade compatibility

The default bundled frontend is React with the original routes, authentication, themes, mobile behavior, APIs and SSE protocol. Chat and image creation use separate conversational histories/drafts; backend models, capabilities, prices and balances remain authoritative. The independent AdminShell preserves all administrative functions. Vue/Pinia dependencies are removed only after full migration acceptance; shared protocol parsing and OpenAPI types remain.

This release introduces no database migration or backend settlement/task change. Preserve the existing database, image files, Redis configuration, `.env` and encryption/JWT keys. Back up before changing the fixed image version. An existing `.env` is not automatically changed by the new deployment template. Do not reinitialize storage or silently switch existing deployments to `edge`.

## Required publication sequence

1. Run frozen install, strict typecheck, lint/format, all 87 units, default production build, generated contract consistency and the complete existing CI on this preparation PR. Merge only its verified head, with no unrelated change.
2. Create a new annotated `v0.2.0` tag at the accepted release commit and push it. Never move an existing release tag. The existing tag workflow reruns all CI, publishes the multi-architecture manifest and validates its exact digest on native amd64 and arm64 production stacks.
3. Require the entire tag workflow to pass and the draft's three deployment/image/identity assets to exist. Verify tag commit, `/api/version`, architecture, non-root UID and manifest/config identities. Retain test failures and fix them without weakening gates.
4. Apply the target-server validation gate in [deployment documentation](DEPLOYMENT.md#正式发布门槛), or an explicit user instruction about publication without updating production. Do not represent historical v0.1.0 server evidence as a new v0.2.0 deployment.
5. Publish the verified draft with accurate release notes, upgrade instructions, immutable commit/digest, workflow links and asset checksums. Mark it as the latest stable 0.x release. Record the actual final evidence in the Release and preparation PR instead of making an endless sequence of documentation-only CI commits.

Until these steps finish, this file is a plan, not a claim that v0.2.0 is already published. The authoritative publication result is the [v0.2.0 Release](https://github.com/xinghenWink/Lumi/releases/tag/v0.2.0).
