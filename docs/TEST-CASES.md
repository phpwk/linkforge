# LinkForge — Test Case Catalog

Every test that exists in the repo, as of the initial release. IDs are
referenced from [TESTING.md](./TESTING.md)'s coverage matrix. Source file
and result are both included so this document stays checkable against
reality rather than becoming stale prose.

## Backend — Unit (`backend/test/links.unit.test.js`)

Database is a hand-written fake; these test route logic only.

| ID | Case | Steps | Expected result | Result |
|---|---|---|---|---|
| UNIT-1 | Reject missing URL | `POST /api/links` with `{}` | `400`, no query issued | Pass |
| UNIT-2 | Reject non-http(s) URL | `POST /api/links` with `{ url: "javascript:alert(1)" }` | `400`, no query issued | Pass |
| UNIT-3 | Create succeeds | `POST /api/links` with a valid URL, mock INSERT returns a row | `201` with `code`, `originalUrl` in body | Pass |
| UNIT-4 | Collision retry | Mock first INSERT throws Postgres `23505` (unique_violation), second succeeds | `201`, exactly 2 INSERT attempts made | Pass |
| UNIT-5 | Redirect + click increment | `GET /:code`, mock UPDATE returns a row | `302` with `Location` header set to `originalUrl`; query is an `UPDATE`, not a `SELECT` | Pass |
| UNIT-6 | Unknown code | `GET /doesnotexist`, mock UPDATE returns no rows | `404` | Pass |
| UNIT-7 | Liveness ignores DB | `GET /healthz` with a pool that throws on any query | `200` — proves the handler never calls `pool.query` | Pass |
| UNIT-8 | Readiness fails on DB error | `GET /readyz` with a pool that throws | `503`, `status: "not ready"` | Pass |
| UNIT-9 | Readiness succeeds on DB OK | `GET /readyz` with a pool that resolves | `200`, `status: "ready"` | Pass |
| UNIT-10 | Metrics endpoint | `GET /metrics` | `200`, body contains `linkforge_http_requests_total` | Pass |

## Backend — Integration (`backend/test/links.integration.test.js`)

Against a real PostgreSQL 16 instance; schema applied fresh in `beforeAll`,
table truncated between tests.

| ID | Case | Steps | Expected result | Result |
|---|---|---|---|---|
| INT-1 | Full lifecycle | Create a link → list links → redirect via its code → fetch its stats | Create returns `201`; list contains 1 entry with `clicks: 0`; redirect is `302` to the right URL; stats afterward show `clicks: 1` | Pass |
| INT-2 | Concurrent creation, no collision | Fire two `POST /api/links` concurrently via `Promise.all` | Both return `201`; the two returned codes are different | Pass |
| INT-3 | Readiness against live DB | `GET /readyz` | `200` | Pass |

INT-2 is the test that unit tests structurally cannot perform — a mocked
pool has no real concurrency to race against, so this is the only place the
uniqueness guarantee (PRD FR-3) is actually exercised under contention.

## Frontend — Component (`frontend/src/App.test.jsx`)

`fetch` is mocked with a scripted response sequence; no real backend.

| ID | Case | Steps | Expected result | Result |
|---|---|---|---|---|
| COMP-1 | Loads existing links on mount | Mock `GET /api/links` to return one link | Destination URL and click count render on screen | Pass |
| COMP-2 | Submit refreshes the list | Mock load (empty) → create → refreshed load (one link); fill the form and submit | New link's destination appears after submit; exactly 3 fetch calls made (load, create, reload) | Pass |
| COMP-3 | Submission error surfaces to the user | Mock load (empty) → create rejected with `400` | An element with `role="alert"` appears containing the server's error message | Pass |

## Summary

| Level | Count | Passed | Failed |
|---|---|---|---|
| Unit | 10 | 10 | 0 |
| Integration | 3 | 3 | 0 |
| Component | 3 | 3 | 0 |
| **Total** | **16** | **16** | **0** |

No flaky or skipped tests exist in this suite — every test above ran and
passed on every execution during this build, including a from-clean
(`rm -rf node_modules && npm install`) re-run immediately before the
initial push to verify nothing in the dependency tree had drifted.
