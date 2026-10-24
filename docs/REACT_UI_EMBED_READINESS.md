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

- [ ] Real-container readiness regression passes; initialization is deliberately delayed, without increasing a production timeout.
- [ ] Frozen install, strict typecheck, lint/format, all 87 unit tests, normal React production build and generated OpenAPI type consistency.
- [ ] Actual default Docker image passes all three authenticated Chrome embed projects; secrets, owned containers and network are cleaned.
- [ ] Current follow-up CI passes every existing quality, browser and container gate without retries concealing a failure.
- [ ] Integrate only into `codex/react-ui`, update #20 and require its current-head CI before making it ready for review. Never merge main or publish.

The original failed CI remains visible; the race is independently reproduced rather than assumed to be the proven cause of the missing first-run application logs.
