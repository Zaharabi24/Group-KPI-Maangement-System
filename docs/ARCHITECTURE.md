# Architecture — ANWAR KPIFlow

## 1. Style

A stateless, containerised three-tier web application. The API is the only
component that talks to the data stores; the SPA is served as static assets.
Background workers handle e-mail, scheduled jobs, exports and snapshots. Each tier
scales independently.

```
┌──────────────────────────────────────────────────────────────────────┐
│  Presentation — React 18 · TypeScript · Vite · Tailwind CSS          │
│  Framer Motion · Anime.js · TanStack Query · React Hook Form · Recharts│
└───────────────────────────────┬──────────────────────────────────────┘
                                │ REST/JSON · /api/v1
                                │ Bearer access token (15 min, in memory)
                                │ + rotating refresh token (HttpOnly cookie)
┌───────────────────────────────▼──────────────────────────────────────┐
│  API — NestJS                                                        │
│  Guard chain: Throttler → JWT → Roles → Permissions                  │
│  Domain: KPI · Approvals · Calculation · Evidence · Periods ·        │
│          Configuration · Templates · Performance · Dashboards ·      │
│          Reports · Notifications · Audit                             │
│  Cross-cutting: correlation IDs · exception filter · transform       │
│                 interceptor · data-scope resolution                  │
└────┬────────────────────┬────────────────────┬───────────────────────┘
     │                    │                    │
┌────▼─────────┐  ┌───────▼────────┐  ┌────────▼─────────────────────┐
│ PostgreSQL   │  │ Redis 7        │  │ Evidence storage             │
│ Prisma ORM   │  │ BullMQ queues  │  │ random object keys           │
│ 28 tables    │  │ session cache  │  │ AES-256-GCM at rest          │
│ insert-only  │  │ rotation grace │  │ SHA-256 indexed              │
│ history      │  │ rate windows   │  │ signed 5-minute URLs         │
└──────────────┘  └───────┬────────┘  └──────────────────────────────┘
                          │
              ┌───────────▼──────────────────────────────────────────┐
              │  Workers (in-process BullMQ processors)              │
              │  email · export · scheduled                          │
              │  retries 1/5/15 min · 7 cron jobs                    │
              └──────────────────────────────────────────────────────┘
```

## 2. Module architecture (BRD Figure 19)

Presentation → API guard → domain services → persistence.

| Layer | Responsibility |
|---|---|
| **Presentation** | Screens, the design system, the KPI drawer, charts. Performs live calculation *preview only*, using the same algorithm as the server. |
| **API guard** | Throttling, authentication, role and permission checks, request metadata (IP, user agent, correlation ID) and response enveloping. |
| **Domain services** | Own the business rules: calculation, weight capacity, workflow transitions, band testing, period locking, snapshots, report assembly. |
| **Persistence** | Prisma models with `RESTRICT` foreign keys, unique constraints that encode the business rules, and partial indexes for the queues and dashboards. |

Domain modules and their responsibilities:

| Module | Owns |
|---|---|
| `auth` | Registration, activation, password policy, login, lockout, rotation, reset, sessions |
| `users` | Profiles, invitations, transfers, roles, delegations, bulk import, registration confirmation |
| `organisation` | Business units, departments, designations, the BU → Department relationship |
| `kpi` | KPI CRUD, submission, withdrawal, versions, restores, corrections, evidence orchestration |
| `evidence` | Content-verified MIME sniffing, malware scan hook, hashing, encryption, signed URLs |
| `calculation` | The pure, versioned scoring engine plus the stepper mapping |
| `approvals` | Queues, decisions, adjustments, band testing, escalation, bulk approve |
| `periods` | Period calendar, close/reopen, extensions, outstanding-item checks |
| `configuration` | Versioned business parameters and open-period recalculation |
| `templates` | KPI Library, template versioning, assignment with conflict listing |
| `performance` | Period aggregates, snapshots, leaderboard ranking, dashboards' shared maths |
| `dashboards` | Employee, department and group dashboards, drill-downs |
| `reports` | RP-01…RP-13 catalogue, scope enforcement, export payloads |
| `notifications` | In-app centre and e-mail dispatch |
| `audit` | Append-only hash-chained trail and the chain verifier |
| `platform` | Global search and health/system-health |

## 3. Data flow (BRD Figure 18, level 1)

**KPI submission**
```
employee → API: validate (period, weight, uniqueness, approver, target rule)
        → calculation engine → store achievement/CS/FS/WS
        → kpi_version (frozen) + calculation_log + audit_log
        → queue: NT-05 to the approver
```

**Decision**
```
approver → API: assert scope and not-the-owner → optimistic lock check
        → band test Δ = |FS − CS_submitted|
        → Δ ≤ band: Approved (freeze, new version, NT-07/NT-08)
        → Δ > band: Escalated (create escalation, NT-11 to every Super Admin)
        → refresh aggregates (≤ 5 s)
```

**Period close**
```
Super Admin → check no Submitted/Under Review/Escalated items
           → transaction: lock every KPI + close the period
           → generate performance snapshots (rank, RAG, previous/difference)
           → NT-16 to every participating employee
```

**Evidence**
```
upload → content sniff → type allow-list → malware scan → SHA-256
       → AES-256-GCM encrypt → random object key on disk → evidence row
download → authorised scope check → sign(evidenceId, now + 5 min)
         → audited → stream as an attachment
```

## 4. Security architecture

| Control | Where |
|---|---|
| Password hashing | Argon2id (19 MiB, t=2, p=1) |
| Access token | JWT, 15 minutes, held in memory only |
| Refresh token | 256-bit random, SHA-256 hashed at rest, in an `HttpOnly; Secure; SameSite=Strict` cookie, rotated on every use |
| Rotation race | A 120-second Redis grace window maps the previous hash to the session so a double-mounted effect or a second tab is not treated as token reuse |
| Idle / absolute timeout | 30 minutes / 12 hours, enforced on both the strategy and the refresh path |
| Revocation | `session_version` bump invalidates every token; logout and password change revoke refresh tokens |
| RBAC | Six roles with a declarative permission matrix; `PermissionsGuard` per route |
| Data scope | `ScopeService` narrows every list, search, dashboard, report and export query; a department scope is not widened by the business unit |
| Segregation of duties | Self-decision is impossible at the query level and rejected at the API level |
| Rate limits | 10 logins/minute/IP, 300 API requests/minute |
| Transport | Helmet, HSTS in production, a strict CORS allow-list |
| Evidence | Content-verified types, macro/executable/EICAR rejection, AES-256-GCM, signed URLs, `nosniff`, attachment disposition |
| Audit | Append-only, hash-chained, weekly verification, 403 denials recorded |
| System Administrator | Refused every KPI endpoint unless an audited break-glass grant exists |

## 5. Reliability and integrity

- Every state-changing KPI operation runs in a transaction; the audit record is
  written **inside** that transaction so a rollback cannot leave a phantom entry.
- `rowVersion` on every KPI plus an optional `If-Match` header prevents lost updates.
- `Idempotency-Key` is accepted on submissions and decisions.
- The calculation engine is pure: identical inputs always produce identical outputs.
- A nightly job re-computes every open-period KPI and notifies when a stored value
  differs from the engine output.
- Closed periods read from `performance_snapshot`, so historical results never
  change silently. A reopened period re-snapshots and keeps the previous one.
- Queues are durable (Redis AOF) and jobs are retried with explicit
  backoff (1/5/15 minutes for e-mail).

## 6. Scalability

| Concern | Approach |
|---|---|
| Stateless API | No server-side session affinity; horizontal scaling behind a load balancer |
| Reference data | Redis caches session revocation and rate windows; permission and scope resolution is a single indexed query |
| Queues | Separate `email`, `export` and `scheduled` queues scale independently |
| Heavy reads | Dashboards take one pass over the period's KPIs; reports are paginated; exports over 10,000 rows move to a worker |
| Future growth | The BRD targets 15,000 accounts, 1,000 concurrent sessions and 1.5M KPI versions per year; the schema is indexed for that shape |

## 7. Configuration over code

Cap, floor, adjustment band, weight limits, maximum KPIs, grace days, review
window, SLA, extension maximum, minimum reason length, evidence limits, the
qualitative rubric map, RAG thresholds and the category list are all rows in
`configuration_version`. Publishing a new version never changes an existing KPI,
because each KPI stores the configuration version that was current when it was
created.

## 8. Extension points

| Extension | How |
|---|---|
| New KPI type | Add a `kpi_type` value and its configuration — no table changes (AC-25) |
| ERP actuals import | Write to the existing `actual` field and recalculate |
| Different approval chain | Replace `ApprovalsService.decide` with a chain-aware service; the queue contract stays |
| SSO | Add a provider that issues the same JWT payload and creates the same session rows |
| Object storage | Swap `EvidenceStorageService` for an S3 implementation; the signed-URL contract is unchanged |
