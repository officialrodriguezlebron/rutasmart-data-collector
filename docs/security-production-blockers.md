# Security: production blockers

Items that are acceptable for local development but **must be resolved before
RutaSmart is deployed to a public domain**. Raised by the Phase 3A read-only
security audit, 2026-11-04. Nothing in this file has been changed in code —
it exists so these are decided deliberately rather than discovered in
production.

---

## BLOCKER-1 — `POST /auth/create` is open, unauthenticated self-registration

**Status:** open, deliberately left as-is in Phase 3A Step 1 to preserve the
current local signup workflow.

**Where:** `rutasmart-backend/app/routes/auth_routes.py` — `create_user`.

**Current behaviour.** Anyone who can reach the API may create a `CONDUCTOR`
account. The endpoint is rate-limited to 5/minute and refuses any role other
than `CONDUCTOR`, but it requires no authentication and no approval. Called
from `rutas-frontend/src/pages/Signup.jsx` (public route `/signup`) and from
`AdminConductors.jsx`.

**Why this is a production blocker.** A conductor account is not merely a login.
Once created it can call `POST /trip/start-trip` and `POST /log/`, which write
`trips` and `gps_logs` rows. Those tables *are* the thesis dataset. An open
registration endpoint therefore allows an anonymous third party to inject
records into the research data — a research-integrity problem before it is a
security one. It also permits unbounded account creation, subject only to the
per-IP rate limit.

**Resolve before deployment by one of:**

1. **Disable public signup.** Remove the `/signup` route from the frontend and
   require `ADMIN` on `POST /auth/create`. Conductors are then provisioned from
   the admin dashboard, which `AdminConductors.jsx` already supports. This is
   the recommended option and matches the README's stated model ("ADMIN
   accounts must be provisioned manually") — conductors should be too.
2. **Admin approval queue.** Keep self-registration but create accounts with
   `is_active = False`, and have an admin activate them. Requires a new admin
   screen and an activation endpoint; the `is_active` column already exists and
   every login path already filters on it.
3. **Invite code.** Require a shared enrolment secret on signup. Weakest option
   — the code leaks the moment it is given to a field conductor.

**Do not** rely on the `X-API-Key` middleware for this. The key is inlined into
the browser bundle via `VITE_API_KEY` and is readable by anyone who loads the
site, so it does not restrict who may call the endpoint.

---

## Related, tracked separately

These were identified in the same audit and are scheduled for Phase 3A
Steps 2-5 and Phase 3B. Listed here so the production checklist is complete.

| ID | Item | Phase |
|---|---|---|
| S1 | Tokens are now HMAC-signed and verifiable, but no endpoint enforces them | 3A Step 4b |
| S2 | No role authorization on any `/admin/*` endpoint, including `DELETE /admin/trip/{id}` and `POST /admin/import` | 3A Step 4b |
| S6 | `POST /auth/seed` is gated only by a defaulted `ENV` var and can mint the README-published admin account | 3A Step 5 |
| D1 | Interrupted queue flush can duplicate GPS rows — see below | 3A Step 4b/4c |
| — | `recorder_id` and `device_id` are client-supplied, so trip and log ownership is unverifiable | 3B |
| — | `ALLOWED_ORIGINS` still contains stale Vercel/Render hosts | pre-deploy cleanup |

### D1 — interrupted queue flush can duplicate GPS rows

**Status:** tracked, deliberately not fixed in the 4a data-preservation work.

`flushQueue` in `rutas-frontend/src/pages/Recording.jsx` uploads each queued
log in turn and only rewrites the queue once the loop finishes. If the page is
reloaded, navigated away from, or killed mid-flush, every log in that pass
stays queued — including any already accepted by the backend — and is sent
again on the next flush.

That ordering is deliberate and correct as a trade: it favours duplicates over
loss, and losing field GPS data is the worse outcome. The cost is that
`POST /log/` mints its own `log_id` server-side, so a duplicate submission
becomes a duplicate row in `gps_logs` rather than an idempotent no-op. Repeated
rows at one position would inflate the point counts DBSCAN clusters on, so this
is a research-data concern as well as a tidiness one.

Resolving it needs an idempotency key: the PWA already stamps `client_seq` per
trip, so `(trip_id, client_seq)` is a natural unique constraint, with the insert
becoming an upsert. That is a schema change plus a backend change, which is why
it is not folded into the frontend-only 4a commit.

---

## Resolved

| ID | Item | Resolved in |
|---|---|---|
| S3 | CORS was `allow_origins=["*"]` while a real allowlist sat unused | Phase 1 (`8146f8c`) |
| — | Invalid API key returned HTTP 500 instead of 401 | Phase 1 (`8146f8c`) |
| — | CORS preflight was rejected by the API-key middleware, breaking every cross-origin POST/DELETE | Phase 1 (`8146f8c`) |
| S4 | `/public/*` required an API key the anonymous passenger dashboard never sends | Phase 3A Step 1 |
| S5 | `AnalyticsEngine` called `run-all` and `dbscan` without `X-API-Key` | Phase 3A Step 1 |
| — | `ANALYST` row crashed `POST /auth/login/admin` with HTTP 500 | Phase 3A Step 1 |
