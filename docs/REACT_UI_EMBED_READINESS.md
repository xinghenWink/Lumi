# React release follow-up: container readiness

## Observed failure and scope

Release proposal #20 CI #104 passed both complete Chrome jobs, but its independent production Docker embed timed out before browser startup. The earlier driver deleted containers before saving diagnostics, so the precise application startup error was not retained. Inspection found a real fixture race: the official PostgreSQL image starts a temporary Unix-socket-only initialization server, while the driver used the default Unix-socket `pg_isready`. That probe can succeed before the TCP endpoint used by Lumi exists. Redis was also started without an authenticated readiness check.

Do not change application startup, database/Redis configuration, production Compose, backend business rules, browser assertions or the 120-second readiness deadline. Main remains unchanged. This follow-up targets only `codex/react-ui` before updating the release proposal.

## File changes and dependencies

1. Extract the actual PostgreSQL TCP and authenticated Redis probes into a small dependency-free script module consumed by the smoke driver and its real-container regression test.
2. Add a real PostgreSQL initialization-delay regression: observe that Unix sockets accept connections while the production TCP probe rejects them; then require completed initialization and TCP readiness. Check Redis rejects unauthenticated access and accepts the fixture credential. Use owned temporary resources and guaranteed cleanup.
3. Make `scripts/react-embed-smoke.mjs` wait for both dependencies, fail immediately if the application exits, save build metadata before startup, and collect redacted owned-container status/logs before cleanup on failure. Never persist environment inspection or unredacted credentials.
4. Add the regression to `.github/workflows/ci.yml`; upload only explicit reports/diagnostics paths, including the hidden `.tools` directory. Guard secondary Compose diagnostics/cleanup when its credentials file has not yet been generated.
5. Record ADR-125 and acceptance evidence here. No new package, lockfile, API or SQL change.

## Acceptance

- [x] Real-container readiness regression passes; initialization is deliberately delayed, without increasing a production timeout. Local run: 1/1, 17.7 seconds, zero skipped cases and no owned containers left behind.
- [x] Frozen install, strict typecheck, lint/format, all 87 unit tests, normal React production build and generated OpenAPI type consistency. The new test's initial indentation format failure was fixed and the full lint gate rerun successfully.
- [x] Actual default Docker image passes all three authenticated Chrome embed projects; secrets, owned containers and network are cleaned. Source `cdfade1a511e3e9840e7ad17ae60a2b8d611e155`, image `sha256:a985ddac6061e1cb8f8bdbaabdee13e86a61aaa04b4e70010a94e722a0fd4ccf`, local report `.tools/react-embed/00a3a6cbdd73/report.json`; 3/3 in 12.9 seconds.
- [x] Current follow-up CI passes every existing quality, browser and container gate without retries concealing a failure. CI #105 ([40086534054](https://github.com/xinghenWink/Lumi/actions/runs/40086534054)) passes all three jobs on `ddb3cebb7610c7416e8506e6ef7a9ec940eac37c`, including both complete Chrome suites, the new readiness regression, actual Docker embed, production Compose, installation/upgrade/rollback and backup restoration.
- [x] PR #21 integrated only into `codex/react-ui` as `51f4a88ae94569f6aea09dc69c915ab79994056c`; release proposal #20 includes the validated fix. Its final source commit must pass all CI jobs before becoming ready for review. Main remains `c28be7fe16ca911f2b9443c27ce887f14f96b5d8`; no tag, image publication or deployment.

The original failed CI remains visible; the race is independently reproduced rather than assumed to be the proven cause of the missing first-run application logs.
