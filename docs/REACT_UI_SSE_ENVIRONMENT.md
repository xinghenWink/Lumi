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

- [ ] Frozen install, strict typecheck, lint/format, all 87 unit tests, normal production build and generated OpenAPI consistency.
- [ ] Actual delayed PostgreSQL/Redis probe regression and independent production Docker embed remain green.
- [ ] Fresh local full Chrome desktop/320/390 run with the richer measurements; retain failed CI evidence.
- [ ] Linux wrapper reports direct host topology and PostgreSQL durability enabled; both complete 57-case CI suites pass with the unchanged SSE bound and all existing jobs pass. Investigate any remaining failure before integration.
- [ ] Integrate the accepted small PR only into `codex/react-ui`, then update #20 and require its complete final-commit CI. Keep main unchanged and the release proposal draft until acceptance.
