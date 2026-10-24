# React release follow-up: native SSE measurement environment

## Observed evidence

Release proposal #20 CI #107 on `8ba31f4` passed every quality-job check, including its full 57-case Chrome suite and capacity gate. The separate React job passed 56/57: desktop SSE platform p95 was 130 ms against the unchanged strict `<100 ms` requirement; mobile values were 8/8 ms, UI long tasks were zero and the interaction maximum was 32 ms. Its failed trace and measurements are retained in the CI artifact and ignored `.tools/react-ci107-candidate-curl.zip`. The earlier CI #105 passed both full suites and all container gates.

Trace inspection found all 60 latency requests; their response-header wait was at most 25.727 ms. Some streaming HAR bodies are incomplete, so the trace does not isolate Redis delivery, browser scheduling or runner effects. Do not attribute the exact 130 ms failure to an unproven cause or simply rerun it until green.

Both native browser jobs currently connect a host Go process to Docker-published PostgreSQL/Redis ports. The existing capacity rehearsal already uses direct host loopback dependencies. The production Docker test uses app-to-dependency traffic within its private network. A native benchmark does not need the extra published-port NAT/proxy layer; [Docker documents host networking](https://docs.docker.com/engine/network/drivers/host/) as bypassing it. This is an environment correction and diagnostic improvement, not proof that NAT caused this particular failure.

## Planned files and execution order

1. Add a Linux-only native E2E wrapper with owned PostgreSQL 16/Redis 7 containers on host loopback, fresh database, random file-based credentials, TCP/authenticated readiness, explicit ownership checks and guaranteed normal/failure cleanup. Preserve PostgreSQL durability and capture non-secret topology metadata. Run the existing normal/candidate pnpm commands unchanged against these dependencies.
2. Reuse the actual dependency probes with optional explicit ports/database; retain default behavior for the independent Docker embed. Extend the real delayed-initialization regression to cover explicit ports.
3. Extend `frontend/tests/chat-performance.ts` diagnostic output with ordered request samples and browser scheduling/visibility observations. Retain the original formula, all 60 samples, `<100 ms`, no-compression check, interaction/long-task/Lighthouse/gzip bounds and every functional assertion. Do not drop slow samples, warm up selectively, retry assertions or move measurements out of Chrome.
4. Use the wrapper in both native Chrome CI jobs while preserving their original Go services/integration tests and every later capacity/container/Compose/upgrade/rollback/backup gate. Upload explicit hidden report paths without credentials. Add ADR-126; no dependency, backend, API, SQL or production Compose changes.

## Acceptance

- [x] Frozen install, strict typecheck, lint/format, all 87 unit tests, normal production build and generated OpenAPI consistency.
- [x] Actual delayed PostgreSQL/Redis probe regression passes with explicit ports, 1/1 in 18.4 seconds, zero skipped cases and owned resources cleaned.
- [x] Independent production Docker embed remains green with the default probe ports: 3/3 in 13.5 seconds on `ffa0f72c9577c9f08f1d5cfb7daac51784e8dd67`, image `sha256:19d4da96b1f48757c3249346c339d5ab9eb0ff725415f82a6f58f5988086bb1b`, report `.tools/react-embed/44a4b5c3e4cd/report.json`; owned resources and credential files cleaned.
- [x] Fresh local full Chrome desktop/320/390 run passes 57/57 in 9.4 minutes on `bb3c0789aaeb227dd790d8ced216cd8c7013731b`. SSE p95 is 39/34/34 ms, Lighthouse 100, gzip 249223 bytes, interaction maximum 24 ms, long tasks zero. All 60 samples remain, including one desktop maximum of 133 ms; no sample was discarded. Reports/screenshots are retained under `.tools/react-ui-sse-environment/e2e-pass`, and owned dependencies are cleaned.
- [x] Linux wrapper reports direct host topology and PostgreSQL durability enabled; CI [#108](https://github.com/xinghenWink/Lumi/actions/runs/40090373836) passes all three jobs on `bb3c0789aaeb227dd790d8ced216cd8c7013731b`, including both 57-case suites and all existing capacity/container/Compose/upgrade/rollback/backup gates. Candidate SSE p95 is 8/8/8 ms (maximum 9 ms); quality p95 is 5/5/6 ms (maximum 6 ms). Each view retains all 60 samples, with zero slow samples or browser long tasks. The downloaded report independently confirms `host` topology, `on,on,on` durability and no uploaded credential files. Failed CI #107 remains visible; these results do not prove its exact cause.
- [x] PR #22 integrated only into `codex/react-ui` as `a64f10a6ea72d06d2530ecb6a72d7402b615e62c`; #20 includes the accepted correction and evidence. Its final source commit must pass complete CI before review readiness; the PR records that final run. Main remains `c28be7fe16ca911f2b9443c27ce887f14f96b5d8`, with no merge, tag, publication or deployment.
