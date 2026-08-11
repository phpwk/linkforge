# LinkForge — Test Strategy & Execution Summary

Individual test cases are cataloged in [TEST-CASES.md](./TEST-CASES.md).
This document covers the strategy behind them and the results of actually
running them.

## 1. Test levels

| Level | Scope | Tool | Real dependencies? |
|---|---|---|---|
| Unit | Backend route logic in isolation | Jest + Supertest | No — `pool.query` is a hand-written fake (see `test/links.unit.test.js`) |
| Integration | Backend against a real database | Jest + Supertest | Yes — real PostgreSQL 16 |
| Component | Frontend UI behavior | Vitest + React Testing Library | No — `fetch` is mocked |

There is deliberately no fourth "end-to-end" level (real browser driving
the real frontend against the real backend against the real database) —
see §4.

## 2. Why this split

- **Unit tests exist to test logic**, not infrastructure: URL validation,
  the collision-retry loop, route status codes. Mocking the database pool
  keeps these fast (10 tests run in well under a second) and isolates
  failures to actual logic bugs rather than environment flakiness.
- **Integration tests exist because the unit tests' mock could be wrong.**
  A fake that returns the shape you expect proves nothing about whether
  the real SQL is correct. The three integration tests specifically cover
  what only a real database can verify: the full create→list→redirect→stats
  lifecycle, and — the one that matters most — that two concurrent
  `POST /api/links` calls never produce the same code. That's a race
  condition that a mocked pool literally cannot exercise, because the
  mock has no concurrency to race.
- **Component tests exist because the frontend's logic (loading state,
  error display, refresh-after-create) is real code with real branches**,
  not just markup. Mocking `fetch` keeps these fast and independent of
  any running backend.

## 3. Coverage by requirement

Cross-referenced against [PRD.md](./PRD.md) §5 (functional requirements):

| Requirement | Covered by |
|---|---|
| FR-1 (create link) | UNIT-1, UNIT-3, UNIT-4, INT-1 |
| FR-2 (reject invalid URL) | UNIT-1, UNIT-2 |
| FR-3 (uniqueness under concurrency) | UNIT-4 (retry logic), INT-2 (actual concurrent race) |
| FR-4 (redirect) | UNIT-5, INT-1 |
| FR-5 (click increment) | UNIT-5, INT-1 |
| FR-6 (404 on unknown code) | UNIT-6 |
| FR-7 (list links) | INT-1 |
| FR-8 (link stats) | INT-1 |
| NFR-3 (telemetry) | UNIT-10 |

Every functional requirement has at least one test. NFR-1 (autoscaling),
NFR-4 (container security), NFR-6 (GitOps deploy) are *not* covered by any
automated test in this repo — they're verified by inspection (`kustomize
build`, `actionlint`) rather than by a test suite, because the tooling to
assert against a live cluster's actual runtime behavior wasn't part of this
build.

## 4. What's explicitly not covered

Stated plainly, matching the rest of this repo's documentation style:

- **No end-to-end/browser tests.** No Playwright/Cypress driving a real
  browser against the real stack. The component tests prove the frontend's
  own logic is correct given a mocked API; they don't prove the frontend
  and backend actually agree on the wire format in practice. `npm run
  build` succeeding and the Dockerfiles being well-formed are the closest
  proxies for "this actually works end to end" that exist right now.
- **No load/performance testing.** The latency SLO in PRD §7 (p99 < 1s) is
  a stated target with zero measured data behind it — no load test has
  been run against this system, in this sandbox or anywhere else.
- **No contract testing** between frontend and backend beyond both being
  written against the same (undocumented-as-a-schema) JSON shape. A
  backend response-shape change would only be caught by a human reading
  both sides, not by CI.
- **No security testing** (dependency scanning, SAST, container image
  scanning) is wired into `ci.yml`. Given there's no authentication at all
  (API.md), that's a real gap, not a minor one.
- **No migration testing** beyond the migration file being syntactically
  valid SQL that the integration tests happen to apply successfully.

## 5. Execution results

All numbers below are from an actual run, not an estimate:

| Suite | Tests | Result | Environment |
|---|---|---|---|
| Backend unit | 10 | 10 passed | Node 22.22.2, mocked `pg` pool |
| Backend integration | 3 | 3 passed | Node 22.22.2, PostgreSQL 16.14 (real instance) |
| Frontend component | 3 | 3 passed | Vitest 2.x, jsdom |
| **Total** | **16** | **16 passed, 0 failed** | |

Also verified in the same run: `npm run build` (frontend production
build) succeeded; `kustomize build` rendered all three overlays
(`base`, `dev`, `prod`) with zero errors or warnings; `actionlint`
reported zero issues on both workflow files.

Reproduce locally:

```sh
# Backend
cd backend && npm install
npm run test:unit
PGHOST=localhost PGUSER=linkforge PGPASSWORD=linkforge PGDATABASE=<a_real_test_db> npm run test:integration

# Frontend
cd frontend && npm install
npm test
npm run build
```

## 6. CI enforcement

Once `.github/workflows/ci.yml` is in place (see repo history — added
separately due to the GitHub connector's token lacking `workflow` scope at
push time), every pull request runs: backend unit tests, backend
integration tests against a `postgres:16-alpine` service container,
frontend tests + build, both Dockerfile builds (unpushed, build-only), and
`kustomize build` against all three overlays. A PR cannot merge with any of
these red.
