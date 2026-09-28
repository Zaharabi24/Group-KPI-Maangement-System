<div align="center">

# ANWAR KPI · Anwar KPIFlow

**Variable KPI & Performance Management Platform — Phase 01**

A production-structured, fully auditable variable-KPI platform for **Anwar Group of Industries**:
targets, actuals, evidence, deterministic scoring, review, approval, escalation, dashboards and reports —
in one explainable journey.

Built from the Business Requirements Document `Anwar_KPIFlow_Variable_KPI_BRD_v1.0`
and the organisation master data in `Business Unit & Department List.xlsx`.

`NestJS` · `Prisma` · `PostgreSQL` · `React 18` · `TypeScript` · `Tailwind CSS` · `Framer Motion` · `Anime.js`
`JWT + RBAC` · `Redis` · `BullMQ` · `Docker` · `Nginx`

</div>

---

## Table of contents

1. [What the system does](#1-what-the-system-does)
2. [The five questions every KPI answers](#2-the-five-questions-every-kpi-answers)
3. [Roles and access model](#3-roles-and-access-model)
4. [The calculation engine](#4-the-calculation-engine)
5. [Workflow and status model](#5-workflow-and-status-model)
6. [Business Unit & Department data](#6-business-unit--department-data)
7. [Architecture](#7-architecture)
8. [Repository layout](#8-repository-layout)
9. [Quick start](#9-quick-start)
10. [Demo accounts](#10-demo-accounts)
11. [Feature map against the BRD](#11-feature-map-against-the-brd)
12. [API surface](#12-api-surface)
13. [Background jobs, e-mail and the queue](#13-background-jobs-e-mail-and-the-queue)
14. [Security and audit](#14-security-and-audit)
15. [Testing and verification](#15-testing-and-verification)
16. [Deployment](#16-deployment)
17. [Documentation index](#17-documentation-index)
18. [Configuration reference](#18-configuration-reference)

---

## 1. What the system does

Anwar KPIFlow digitises the full variable-KPI cycle and replaces the manual
`KPI Name → Score → Signature → Approval` process with
`Target → Actual Achievement → Evidence Report → Score → Review → Approval`.

| Capability | Where it lives |
|---|---|
| Self-registration restricted to `@anwargroup.net`, single-use setup links, password policy with a live checklist, lockout after 5 failures | Login / Register / Set password screens (M01) |
| Profile with a corporate phone, notification preference and session management | Profile (M02) |
| Business Units, Departments, users, invitations, transfers, delegations, bulk import | Users & Invitations, Organisation (M03) |
| KPI Library templates and template assignment with capacity/duplicate checks | KPI Library (M04) |
| **My KPI** — card grid with the six-step stepper, sticky Create KPI tile, status chips, weight meter, four-section create/edit drawer with a live score preview | My KPI (M05) |
| Evidence with content-checked MIME type, malware scan, SHA-256, AES-256-GCM at rest and 5-minute signed URLs | KPI detail (M06) |
| Pending-request queue, decision drawer, approve/adjust/return/reject/delete, ±10 escalation band, bulk approve, Super Admin queues | Approvals, Escalations, All requests, Department Head requests (M07) |
| One deterministic, versioned, server-side calculation engine | Calculation engine (M08) |
| Monthly / Quarterly / Yearly Performance Summary with 10-column records table and three bar charts | Performance Summary (M09) |
| Department Dashboard, leaderboard, drill-down lists | Department dashboard, Leaderboard (M10) |
| Group Dashboard with BU comparison, department heat table, escalations widget, BU → Department → Employee → KPI drill-down | Group dashboard (M11) |
| 13 reports with scope enforcement, paged preview and XLSX / CSV / PDF export | Reports (M12) |
| In-app notification centre and e-mail for NT-01 … NT-19 delivered by a BullMQ queue with retries | Notifications, mailer (M13) |
| Append-only, hash-chained audit trail with a verifier and version history/restore | Audit log, Version history (M14) |
| Period calendar, close/reopen, extensions, versioned configuration, recalculation | Periods, Configuration (M15) |
| Global search and consistent server-side pagination | Top bar, every list (M16) |

---

## 2. The five questions every KPI answers

The BRD requires each KPI to produce a defensible answer to five questions.
The platform answers them on one screen (the KPI detail view):

1. **What was the target?** — the target with its unit and direction.
2. **What was actually achieved?** — the latest actual, typed by the employee and validated against the measurement type.
3. **What evidence supports it?** — 1–5 files, each with its SHA-256, scan status and a time-limited download.
4. **How was the score calculated?** — the calculation path: Formula, Achievement, Calculated Score, Final Score, KPI Weight, Weighted Score.
5. **Who reviewed and approved it?** — the reviewer/approver, the decision history and the adjustment history.

Nothing is hidden behind a bare number: there is no free-typed score anywhere in
the system.

---

## 3. Roles and access model

Roles are additive — every user with an employee profile also holds the Employee
role, and other roles add capabilities on top. Access is decided by
**role + data scope**, enforced server-side on every request.

| Role | Data scope | Home screen |
|---|---|---|
| **Super Admin** (Upper Management) | Group | Group Dashboard |
| **HR Admin** | Group (read-only on KPI content) | Users |
| **Department Head** (Approver) | Assigned department(s) | Department Dashboard |
| **Employee** | Own records | My KPI |
| **Management Viewer** | Group or BU, read-only | Group Dashboard |
| **System Administrator (IT)** | Technical only — no KPI content | System Health |

Scope rules that are enforced in the data layer (never only in the UI):

- A Department Head assigned to several departments sees the **union** of those departments.
- No user may decide on their own KPI — the approver drop-down never lists the
  requester and the API rejects a self-decision with `SELF-DECISION` (403).
- A Department Head's own KPI is routed to the **Super Admin** queue.
- An out-of-scope record returns `OUT-OF-SCOPE` (403) and the attempt is audited.
- A System Administrator is refused every KPI endpoint with 403 unless an audited
  break-glass grant exists.

---

## 4. The calculation engine

One pure, deterministic, dependency-free implementation on the server
(`backend/src/modules/calculation/calculation.engine.ts`) and an identical client
mirror (`frontend/src/lib/calculation.ts`) so the UI preview, the API response and
the stored version always agree. All arithmetic uses fixed-point decimals with
`ROUND_HALF_UP` at every step; binary floating point is never used for scoring.

### Achievement %

| Case | Formula |
|---|---|
| Higher is better, target > 0 | `ACH = (actual ÷ target) × 100` |
| Lower is better, target > 0 | `ACH = ((2 × target − actual) ÷ target) × 100` |
| Lower is better, target = 0 | `ACH = 100` when actual = 0, otherwise `0` (zero tolerance) |
| Higher is better, target = 0 | Blocked at entry (`V-TGT-01`) |
| Rating | `ACH = (actual ÷ target) × 100` within the configured scale |
| Qualitative | `ACH = MAP[level]` with L1 = 50, L2 = 75, L3 = 100, L4 = 110, L5 = 120 |

Then `ACH = max(round_half_up(ACH, 2), 0.00)`.

### Score, cap and weighted score

```
Calculated Score  CS = min(ACH, CAP)          CAP = 120.00
Final Score       FS = approved override, else CS
Weighted Score    WS = round_half_up(FS × Weight ÷ 100, 2)
```

### Worked examples (all verified by the automated tests)

| Case | Input | Result |
|---|---|---|
| A | Target 15, actual 17, weight 20% | ACH 113.33 · CS 113.33 · WS 22.67 |
| Lower is better | Turnaround target 5 days, actual 4 | ACH 120.00 · CS 120.00 |
| Capped | Complaint rate target 5, actual 3 | ACH 140.00 · **CS 120.00** |
| Floored | Defects target 5, actual 12 | ACH −40 → **0.00** |
| Ratio of percentages | On-time delivery 95% → 90% | ACH 94.74 (not 94.74 pp) |
| Zero tolerance | Lost-time incidents target 0, actual 0 | ACH 100.00 |
| Zero tolerance | Lost-time incidents target 0, actual 1 | ACH 0.00 |

### Period aggregates (§4.5)

```
Total KPI Score       Σ WS over the Approved set S          → 0.00 – 120.00
Average Achievement   Σ(ACH × W) ÷ Σ W over S               → weighted, uncapped
Allocated Weight      Σ W excluding Rejected and Deleted    → shown as "x / 100%"
Approved KPIs         count(S) ÷ count(all except Deleted)  → shown as "6/7"
RAG                   Green ≥ 95.00 · Amber 75.00–94.99 · Red < 75.00
Leaderboard           Total KPI Score desc, then Average Achievement desc, ties share a rank
```

### Adjustments and the escalation band

- An approver may correct an input or override the final score — both require a
  reason of at least 15 characters.
- `Δ = |FS at approval − CS as submitted|`. `Δ ≤ 10.00` is approved directly;
  `Δ > 10.00` moves the KPI to **Escalated** and only a Super Admin can approve it.
- Weight-only changes are not band-tested but must respect the weight rules.

### Worked example: a full employee-period

| KPI | Type / direction | Target | Actual | ACH % | Score | W % | WS |
|---|---|---|---|---|---|---|---|
| Monthly Sales | Monetary ↑ | 1,00,00,000 | 98,33,486.62 | 98.33 | 98.33 | 30 | 29.50 |
| Upsell Revenue | Monetary ↑ | 5,00,000 | 6,10,000 | 122.00 | 120.00 | 15 | 18.00 |
| Proposal Turnaround | Time (days) ↓ | 5 | 4 | 120.00 | 120.00 | 10 | 12.00 |
| New Client Acquisitions | Count ↑ | 12 | 10 | 83.33 | 83.33 | 25 | 20.83 |
| Customer Rating | Rating 1–5 | 4.0 | 3.0 | 75.00 | 75.00 | 20 | 15.00 |
| **Period result** | | | | **95.63 avg** | | **100** | **95.33** |

`Total KPI Score = 95.33 (Green) · Average Achievement = 9,563.15 ÷ 100 = 95.63%`

---

## 5. Workflow and status model

```
Draft ──submit──► Submitted ──open──► Under Review ──approve──► Approved
  ▲                    │                   │  ▲                     ▲
  │ withdraw           │                   │  │ escalation          │ correction
  └────────────────────┘                   │  │ approved            │ (Super Admin)
                                           ▼  │                     │
                    Returned ◄──return─────┴──┘                     │
                        │                                           │
                        └──resubmit──────────────► Submitted        │
                                                                     │
                    Rejected (terminal) ◄──reject── Under Review ────┘
                    Escalated ──Super Admin approve──► Approved
```

| Status | Meaning | Editable by | Stepper |
|---|---|---|---|
| Draft | Created, may be incomplete | Owner | Steps tick as fields complete |
| Submitted | All fields valid, sent to the approver | Nobody (owner may withdraw) | Review is current |
| Under Review | The approver has opened the request | Approver (with reason) | Review is current (amber) |
| Returned | Sent back for correction with a comment | Owner | Review shown red |
| Escalated | Adjustment outside the ±10 band | Super Admin only | Approval is current (amber) |
| Approved | Final score accepted, version frozen | Nobody (correction request only) | All six steps green |
| Rejected | Terminal; the weight is released | Nobody | Approval shown red |
| Not Submitted | Still a Draft at the deadline, or Returned and not resubmitted | Extension or reopen only | Steps greyed |
| Deleted | Soft-deleted with a reason, restorable by a Super Admin | Nobody | Hidden |

`Locked` is a flag (not a status) set on every KPI of a closed period.

### Weight rules

| Rule | Behaviour |
|---|---|
| W-1 | Weight is an integer from 5% to 50% per KPI (configurable) |
| W-2 | The employee-period total may not exceed 100%; the block message is `Weight exceeds 100% by X%. Available: Y%` |
| W-3 | Below 100% is allowed while the period is open, with a visible warning |
| W-4 | Unallocated weight is **not** normalised — it contributes 0 |
| W-5 | An approver may change a weight during review, with a reason |
| W-6 | Maximum 10 active KPIs per employee, period and frequency (configurable) |

---

## 6. Business Unit & Department data

All Business Unit and Department fields across the platform are **dropdowns
populated from the organisation master data**, and the BU → Department
relationship is maintained everywhere:

- The registration form, the invite drawer, the user editor, the transfer modal,
  the KPI library assignment wizard and every report filter all load the
  Business Unit list and then **filter the Department list by the selected unit**.
- The backend enforces the relationship: creating a department requires a valid
  `businessUnitId`, a department cannot be moved to another BU once it is
  referenced, and a BU cannot be deactivated while it still has active
  departments or users.
- Approver routing, data scope and reporting all resolve through the department,
  which belongs to exactly one business unit.

The seed reproduces the uploaded master data exactly:

| | |
|---|---|
| Source file | `Business Unit & Department List.xlsx` (354 data rows, with duplicates) |
| Business Units | **9** |
| Departments | **104** unique departments |
| Normalisation | the source typo `Accounts and Finance` → `Accounts & Finance` |

| Code | Business Unit | Departments |
|---|---|---|
| ACL | Anwar Cement Limited | 21 |
| ACSL | Anwar Cement Sheet Limited | 22 |
| AIL | Anwar Ispat Limited | 19 |
| AOPL | A-One Polymer Limited | 29 |
| AGL | Anwar Galvanizing Limited | 6 |
| AESL | Anwar Enterprise Systems Limited (Anwar Technologies) | 4 |
| HDPML | Hossain Dyeing & Printing Mills Limited (Anwar Textile) | 1 |
| BHB | BHB — Anwar Landmark (Real Estate & Property) | 2 |
| AISPL | AISPL | 1 |

The full list lives in `backend/prisma/seed-data.ts` and is generated from the
uploaded workbook, so the platform always serves exactly the master data that HR
supplied.

---

## 7. Architecture

```
                         ┌──────────────────────────────────────────────┐
   Browser (React SPA)   │  Presentation  React 18 · TypeScript · Vite  │
   ─────────────────────►│  Tailwind CSS · Framer Motion · Anime.js     │
                         │  TanStack Query · React Hook Form · Recharts │
                         └───────────────────────┬──────────────────────┘
                                                 │ REST/JSON · /api/v1
                                                 │ Bearer access token +
                                                 │ HttpOnly refresh cookie
                         ┌───────────────────────▼──────────────────────┐
                         │  API  NestJS · guards: JWT → RBAC → scope    │
                         │  Domain: KPI · Approvals · Calculation ·     │
                         │  Periods · Configuration · Templates ·       │
                         │  Performance · Dashboards · Reports · Audit  │
                         │  Cross-cutting: audit, notifications, mailer │
                         └────┬───────────────┬──────────────┬──────────┘
                              │               │              │
                 ┌────────────▼───┐  ┌────────▼──────┐  ┌────▼─────────────┐
                 │ PostgreSQL 17  │  │ Redis 7       │  │ Evidence storage │
                 │ Prisma ORM     │  │ BullMQ queues │  │ AES-256-GCM      │
                 │ 28 tables      │  │ cache/sessions│  │ SHA-256 indexed  │
                 └────────────────┘  └────────┬──────┘  └──────────────────┘
                                              │
                              ┌───────────────▼───────────────────────────┐
                              │  Workers: e-mail (1/5/15 min retries),    │
                              │  async exports, scheduled jobs            │
                              │  (deadlines, SLA, verification, digests)  │
                              └───────────────────────────────────────────┘
```

**Layering.** The API is the only component that talks to the data stores. Guards
run in order `Throttler → JWT → Roles → Permissions`, and every domain query is
additionally narrowed by the caller's data scope.

**Data classes** (BRD §12.2):
*Master* — business units, departments, designations, users, roles, role scopes, KPI
categories, templates, periods, configuration versions.
*Transactional* — KPI, evidence, decisions, adjustments, notifications, escalations,
corrections, extensions.
*Historical (insert-only)* — KPI versions, calculation log, performance
snapshots, audit log.

**Integrity.** Foreign keys use `RESTRICT`; every KPI mutation increments
`rowVersion` for optimistic locking; `If-Match` and `Idempotency-Key` headers are
accepted on state-changing calls; closed periods read from snapshots so history
never changes silently; a nightly job re-computes every open-period KPI and alerts
on any mismatch.

---

## 8. Repository layout

```
.
├── backend/                      NestJS API + Prisma + workers
│   ├── prisma/
│   │   ├── schema.prisma         the complete data model (28 tables)
│   │   ├── seed.ts               roles, organisation, periods, demo data
│   │   ├── seed-data.ts          the 9 BUs and 104 departments from the Excel file
│   │   └── snapshot-helper.ts    period snapshot generation for the seed
│   ├── scripts/
│   │   ├── smoke-test.mjs        85 end-to-end workflow assertions
│   │   ├── evidence-check.mjs    15 evidence / signed-URL assertions
│   │   └── capture-screenshots.mjs
│   └── src/
│       ├── common/               prisma, redis, scope, decorators, guards,
│       │                         filters, interceptors, utils
│       ├── mailer/               SMTP transport + NT-01…NT-19 templates
│       ├── queue/                BullMQ queues, processors, scheduled jobs
│       └── modules/
│           ├── auth/ users/ organisation/
│           ├── kpi/ approvals/ calculation/ evidence/
│           ├── periods/ configuration/ templates/ performance/
│           ├── dashboards/ reports/ notifications/ audit/
│           └── platform/         global search + health
├── frontend/                     React 18 + Vite SPA
│   └── src/
│       ├── lib/                  api client, types, calculation mirror, formatting
│       ├── context/             auth + toasts
│       ├── components/ui/       the design system (buttons, cards, badges, drawer…)
│       ├── components/layout/   app shell, period selector, search, bell
│       ├── components/kpi/      the create/edit KPI drawer
│       └── pages/               auth, kpi, approvals, dashboards, admin, reports
├── docker/nginx/                SPA + API reverse proxy configuration
├── docs/                        BRD analysis, architecture, data model, API,
│                                business rules, testing, deployment
├── docker-compose.yml            postgres · redis · mailpit · api · web
├── vercel.json                   Vercel deployment (SPA + API rewrite)
└── .env.example                  root environment template
```

---

## 9. Quick start

### Option A — the whole stack in Docker (recommended)

```bash
git clone https://github.com/Zaharabi24/Group-KPI-Maangement-System.git
cd Group-KPI-Maangement-System
cp .env.example .env          # edit the secrets
docker compose up -d --build
```

| Service | URL |
|---|---|
| **Application** | http://localhost:8090 |
| API | http://localhost:4100/api/v1 |
| API health | http://localhost:4100/api/v1/health |
| Mailpit inbox (captured e-mails) | http://localhost:8026 |

The API container waits for PostgreSQL, applies the schema and seeds the database
on first boot.

### Option B — local development

```bash
# 1. Infrastructure only
docker compose up -d postgres redis mailpit

# 2. Backend
cd backend
cp .env.example .env
npm install
npx prisma generate
npx prisma migrate dev      # or: npx prisma db push
npm run seed
npm run start:dev           # http://localhost:4100/api/v1

# 3. Frontend (new terminal)
cd frontend
npm install
npm run dev                 # http://localhost:5273
```

The Vite dev server proxies `/api` to the API, so the refresh-token cookie stays
first-party during development.

---

## 10. Demo accounts

Seeded for local testing and demonstration. **Change every password before any
real deployment.**

| Role | E-mail | Password |
|---|---|---|
| Super Admin | `superadmin@anwargroup.net` | `Anwar@KPI2026` |
| HR Admin | `hradmin@anwargroup.net` | `Anwar@KPI2026` |
| Department Head | `kamrul.hasan@anwargroup.net` | `Anwar@KPI2026` |
| Employee | `rafi.ahmed@anwargroup.net` | `Anwar@KPI2026` |
| Management Viewer | `management.viewer@anwargroup.net` | `Anwar@KPI2026` |
| System Administrator | `sysadmin@anwargroup.net` | `Anwar@KPI2026` |

Seeded data: 9 business units · 104 departments · 27 users · 51 periods ·
~400 KPIs across four closed months plus the open month · 382 real evidence files ·
64 performance snapshots.

---

## 11. Feature map against the BRD

Legend: **✔** implemented and covered by the automated tests · **◐** implemented,
configurable · **○** out of Phase 01 scope per the BRD.

| BRD | Requirement | Status |
|---|---|---|
| BR-01 | Capture every variable KPI as one structured record | ✔ |
| BR-02 | Calculate achievement, score and weighted score automatically | ✔ |
| BR-03 | Explainable scores with a calculation path and adjustment history | ✔ |
| BR-04 | Controlled review/approval with department-scoped approvers and escalation | ✔ |
| BR-05 | Immutable, reason-bearing audit trail for every change | ✔ |
| BR-06 | Employee self-service KPI visibility by month, quarter, year | ✔ |
| BR-07 | Department Head queue, dashboard and ranked leaderboard | ✔ |
| BR-08 | Group-wide control, visibility, version control and history | ✔ |
| BR-09 | Role and organisational-scope data access, server-enforced | ✔ |
| BR-10 | Structured reports with XLSX, CSV and PDF export | ✔ |
| BR-11 | Onboarding restricted to `@anwargroup.net` | ✔ |
| BR-12 | Data model ready for the other KPI types without redesign | ✔ (`kpi_type` + configuration) |
| FR-AUTH-01…09 | Registration, activation, password policy, login, reset, lockout, invitations | ✔ |
| FR-PRF-01…05 | Profile, corporate phone, read-only identity, change password, digest preference | ✔ |
| FR-ORG-01…09 | BU/department masters, invitations, users, transfers, roles, last-approver guard, bulk import, delegation, registration confirmation | ✔ |
| FR-LIB-01…05 | Templates, create-from-template, assignment with conflict listing, locked targets, template versioning | ✔ |
| FR-KPI-01…11 | My KPI cards, filters, create drawer, validation, submit, withdraw, edit/resubmit, detail, adjustments, report, server checks | ✔ |
| FR-EVD-01…05 | Upload, content checks, hashing, immutability, signed downloads, inline preview | ✔ |
| FR-APR-01…12 | Queue, filters, decision actions, adjustment band, escalation, self-decision block, optimistic locking, bulk approve, Super Admin queues | ✔ |
| FR-CAL-01…04 | Versioned engine, calculation log, recalculation on change, nightly verification | ✔ |
| FR-PSM-01…04 | Period filter, metric cards, 10-column table, three charts | ✔ |
| FR-DHD-01…03 | Department filters, six cards with drill-down, leaderboard | ✔ |
| FR-SAD-01…02 | Group dashboard with drill-down; Super Admin sees Department Head KPIs | ✔ |
| FR-RPT-01…02 | RP-01…RP-13 with scope, paged preview, exports, async delivery over 10,000 rows | ✔ |
| FR-NTF-01…02 | In-app centre and queued e-mail with retries | ✔ |
| FR-AUD-01…04 | Append-only audit, version history and diff, restore, audit viewer with export | ✔ |
| FR-CFG-01…04 | Period calendar, versioned configuration, close/reopen with snapshots, extensions | ✔ |
| FR-SRC-01…02 | Global search; server-side pagination everywhere | ✔ |
| NFR-SEC-01…07 | Security headers, Argon2id, RBAC + scope, encryption, session policy, rate limits, secure files | ✔ |
| NFR-SEC | Multi-factor authentication | ○ (MFA-ready design) |
| FR-AUTH-10 | Corporate single sign-on | ○ (Phase 02) |
| §2.5 | Fixed, Project, People & Culture KPI types | ○ (model ready — `kpi_type`) |
| §4.9 / D-06 | Linking Total KPI Score to variable-pay amounts | ○ (RP-06 is the source extract) |

Acceptance criteria AC-01 … AC-25 are exercised by `scripts/smoke-test.mjs` and
`scripts/evidence-check.mjs`; see [docs/TESTING.md](docs/TESTING.md).

---

## 12. API surface

REST/JSON under `/api/v1`. Access tokens are short-lived (15 minutes) and the
rotating refresh token lives in an `HttpOnly`, `SameSite=Strict` cookie. Decimals
are serialised as strings; timestamps are ISO-8601 UTC. State-changing KPI calls
accept `If-Match: <row_version>` and `Idempotency-Key`.

<details>
<summary><strong>Authentication and profile</strong></summary>

```
POST   /auth/register                  self-registration (@anwargroup.net only)
POST   /auth/resend-activation         resend the setup link (60 s, 5/hour)
GET    /auth/token/:token              inspect a setup token
POST   /auth/set-password              activate / set the password
POST   /auth/reset-password            reset with a 30-minute token
POST   /auth/password-policy           live policy evaluation
POST   /auth/login                     session + routing
POST   /auth/refresh                   rotate the refresh token
POST   /auth/logout                    revoke the session
POST   /auth/forgot-password           neutral confirmation
POST   /auth/change-password           from Profile
GET    /auth/sessions · DELETE /auth/sessions/:id
GET    /auth/me                        the authenticated principal
GET    /me · PATCH /me                 the full profile
```
</details>

<details>
<summary><strong>Organisation, users and invitations</strong></summary>

```
GET    /organisation/public/business-units          no auth (registration form)
GET    /organisation/public/departments              no auth, filtered by businessUnitId
GET    /organisation/business-units · POST · PATCH /:id · POST /:id/deactivate
GET    /organisation/departments · POST · PATCH /:id · POST /:id/deactivate
GET    /organisation/tree · GET /organisation/designations
GET    /admin/users · GET /admin/users/:id · PATCH /admin/users/:id
POST   /admin/invitations · GET · POST /:id/resend · POST /:id/revoke
POST   /admin/users/bulk-import
POST   /admin/users/:id/transfer · /roles · /deactivate · /reactivate
POST   /admin/delegations · GET · DELETE /:id
GET    /admin/registrations · POST /admin/registrations/:id/confirm
GET    /users/approvers · GET /users/directory
```
</details>

<details>
<summary><strong>KPI, evidence and calculation</strong></summary>

```
GET    /kpis                           My KPI list + status chip counts + weight meter
POST   /kpis                           create a Draft
GET    /kpis/:id                       the full detail with the calculation path
PATCH  /kpis/:id                       owner (Draft/Returned) or approver (in review)
DELETE /kpis/:id                       soft delete with a reason
POST   /kpis/:id/submit · /withdraw · /restore
POST   /kpis/preview-calculation       stateless preview (same algorithm)
GET    /kpis/meta/weights · /approvers · /categories · /reference
POST   /kpis/:id/evidence              upload 1–5 files
POST   /kpis/:id/evidence/:eid/replace · DELETE /kpis/:id/evidence/:eid
GET    /evidence/:id/url               a 5-minute signed URL
GET    /evidence/:id/download          signed download (token authorises it)
GET    /evidence/:id/preview           inline PDF/image preview
GET    /kpis/:id/versions · /versions/:from/diff/:to · POST /versions/restore
GET    /kpis/:id/report                 KPI report payload
GET    /kpis/drill-down/:kind          dashboard drill-down lists
POST   /corrections · GET · POST /corrections/:id/decision
```
</details>

<details>
<summary><strong>Approvals, escalations and dashboards</strong></summary>

```
GET    /approvals                      the pending queue (filters, oldest first)
POST   /kpis/:id/review-start          Under Review + NT-06
POST   /kpis/:id/decision              approve | adjust | return | reject | delete
POST   /approvals/bulk-approve         up to 20 unadjusted requests
GET    /approvals/department-heads     Department Head KPIs (Super Admin)
GET    /approvals/all                  group-wide queue (Super Admin)
GET    /approvals/counts               sidebar badge counts
GET    /escalations · POST /escalations/:id/decision
GET    /dashboard/employee · /department · /group · /drill-down
GET    /leaderboard
```
</details>

<details>
<summary><strong>Periods, configuration, templates and reports</strong></summary>

```
GET    /periods/selectable             the global period picker
GET    /admin/periods · POST /calendar · POST · PATCH /:id
POST   /admin/periods/:id/close · /reopen · GET /:id/outstanding
POST   /admin/periods/extensions · GET
GET    /admin/configuration-versions · /active · POST
POST   /admin/configuration-versions/recalculate
GET    /kpi-library/templates · /:id · POST · PATCH /:id · POST /:id/publish
POST   /kpi-library/assignments · GET /kpi-library/categories
GET    /reports                        the catalogue for the caller's role
GET    /reports/meta/filters · /meta/exports/mine
GET    /reports/:code                  paged preview
POST   /reports/:code/export           XLSX / CSV / PDF (async above 10,000 rows)
GET    /reports/:code/download/:jobId
```
</details>

<details>
<summary><strong>Notifications, audit, search and health</strong></summary>

```
GET    /notifications · /unread-count · PATCH /read · POST /read-all
POST   /notifications/preview          template preview (System Administrator)
GET    /audit-logs · /verify · /entity-types · /export
GET    /search                         employees + KPIs within scope
GET    /health                         public liveness probe
GET    /health/system                  queues, storage, mail, jobs (admin)
```
</details>

### Error model

```json
{
  "error": {
    "code": "W-EXCEED",
    "message": "Weight exceeds 100% by 5.00%. Available: 0%",
    "field_errors": [{ "field": "kpiWeight", "code": "W-EXCEED", "message": "…" }],
    "correlation_id": "8f2c…",
    "path": "/api/v1/kpis",
    "timestamp": "2026-09-28T10:55:19.533Z"
  }
}
```

HTTP `400/422` validation · `401` unauthenticated · `403` forbidden (audited) ·
`404` not found or out of scope · `409` conflict or business rule · `413` file too
large · `423` account locked · `429` rate limited · `500/503` system error.

Business codes: `V-TGT-01`, `V-NUM-02`, `W-EXCEED`, `KPI-DUP`,
`PERIOD-CLOSED` / `DEADLINE-PASSED`, `APPROVER-INVALID` / `SELF-DECISION`,
`STALE-VERSION`, `REASON-REQUIRED`, `FILE-REJECTED`.

---

## 13. Background jobs, e-mail and the queue

Redis + BullMQ run three queues. E-mail delivery retries after **1, 5 and 15
minutes** and every attempt is recorded in `email_log`.

| Queue | Work |
|---|---|
| `email` | NT-01 … NT-19 rendered from managed templates and deep-linked to the record |
| `export` | Report generation above 10,000 rows; the finished file is delivered as a notification with a 24-hour link |
| `scheduled` | The seven automated jobs below |

| Scheduled job | Cadence | Purpose |
|---|---|---|
| Deadline reminders | daily 08:00 | NT-13 three days and one day before the deadline |
| Overdue sweep | daily 00:05 | NT-14 — Drafts and expired returns become **Not Submitted** |
| Review SLA check | daily 08:30 | NT-15 at 5 working days to the approver, at 8 to the Super Admin |
| Nightly verification | daily 02:00 | FR-CAL-04 — re-computes open-period KPIs and alerts on any mismatch |
| Hash-chain verification | weekly, Sunday 03:00 | §18 — detects any gap or edit in the audit trail |
| Daily digest | daily 07:00 | FR-PRF-05 — users who chose a digest instead of immediate e-mail |
| Retention purge | daily 03:15 | Expired tokens, sessions, idempotency keys and export links |

Every run is recorded in `scheduled_job_run` and surfaced on **System Health**.

Notification catalogue: NT-01 registration · NT-02 invitation · NT-03 reset/lockout ·
NT-04 KPI assigned · NT-05 submitted (to the approver) · NT-06 review started ·
NT-07 approved · NT-08 approved with adjustment · NT-09 returned · NT-10 rejected ·
NT-11 adjustment escalated · NT-12 escalation decided · NT-13 deadline approaching ·
NT-14 deadline missed · NT-15 review SLA breached · NT-16 period closed ·
NT-17 KPI deleted · NT-18 correction/reopen/extension · NT-19 inputs edited during review.

In development, Mailpit captures every message at http://localhost:8026.

---

## 14. Security and audit

| Area | Implementation |
|---|---|
| Passwords | Argon2id (19 MiB, t=2, p=1), policy 10–64 chars with upper/lower/digit/symbol and no e-mail name |
| Login protection | Lockout for 15 minutes after 5 consecutive failures, with an e-mail notice; generic failure messages |
| Sessions | 15-minute access token · 30-minute idle timeout · 12-hour absolute timeout · logout and password change revoke refresh tokens · single-flight rotation with a 120-second reuse grace window |
| Tokens | Single-use, hashed at rest; activation 24 h, invitation 72 h, reset 30 min |
| Authorisation | RBAC plus data scope enforced server-side; an automated authorisation test covers every role/endpoint combination exercised by the smoke suite |
| Rate limits | 10 logins/minute per IP, 300 API requests/minute per client |
| Files | MIME type verified from content (magic bytes), macro-enabled Office and executables refused, EICAR rejected, ≤ 10 MB, ≤ 5 files, SHA-256 stored, AES-256-GCM at rest, 5-minute signed URLs, served as attachments with `nosniff` |
| Transport | Helmet security headers, HSTS in production, strict CORS allow-list |
| Secrets | Environment only — never committed |
| Audit | Append-only, hash-chained (`previousHash` + `recordHash`), actor + role + entity + before/after + reason + IP + user agent + correlation ID, weekly chain verification, 7-year retention |

The audit trail covers authentication, user and role changes, every KPI mutation,
evidence upload/download, every workflow decision, every calculation run,
configuration publication, period close/reopen, report views and exports, 403
denials and audit-log views.

---

## 15. Testing and verification

Both suites run against a live API and a seeded database.

```bash
cd backend
node scripts/smoke-test.mjs        # 85 assertions — all major workflows
node scripts/evidence-check.mjs    # 15 assertions — evidence and signed URLs
```

`smoke-test.mjs` covers, among others:

- domain restriction on registration, wrong-password rejection, the three role
  home screens
- **all seven §4.6 calculation examples**, including the cap, the floor, the
  zero-tolerance rule and `V-TGT-01`
- the six-field calculation path with no `Curve Applied` / `Adjustment` /
  `Score Version` rows (AC-13)
- `W-EXCEED` with the exact "Available: Y%" copy (AC-06) and the self-approver
  block (`BR-R04`)
- departmental scope isolation, employee 403s and the audit-log access matrix
- metric cards, the 10-column records table and the 12/4/5 chart series with
  `has_data` flags (AC-14, AC-15)
- RP-01…RP-13 availability and per-role access, plus the CSV export footer (AC-19)
- return requiring a reason, resubmission, approval and the state machine (AC-11)
- notification centre and unread counts
- nine business units, BU-filtered departments and the public registration lists
- the period calendar, active configuration and the "employee cannot generate the
  calendar" guard
- audit hash-chain integrity and verification (AC-23)
- global search, profile validation and E.164 phone normalisation
- System Administrator isolation from KPI content

`evidence-check.mjs` covers: SHA-256 integrity (the downloaded bytes hash to the
stored digest), the 5-minute signed URL, tampered and expired signatures rejected,
and `.exe`, `.docm`, EICAR and 12 MB uploads refused (AC-07).

See [docs/TESTING.md](docs/TESTING.md) for the manual UAT script that walks the
BRD acceptance criteria.

---

## 16. Deployment

Full instructions in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

### Docker Compose (complete stack)

```bash
cp .env.example .env      # set strong secrets, COOKIE_SECURE=true, CORS_ORIGINS
docker compose up -d --build
# → http://localhost:8090
```

### Vercel (front end) + a managed API

1. Deploy the API (Railway / Render / Fly / a VPS) with PostgreSQL, Redis and a
   persistent volume for evidence.
2. Import the repository into Vercel — the root `vercel.json` builds `frontend/`.
3. Set `VITE_API_BASE_URL=/api/v1` and point the `/api` rewrite in `vercel.json`
   at your API origin so the refresh cookie stays first-party.
4. On the API set `CORS_ORIGINS` and `APP_URL` to the Vercel domain, and
   `COOKIE_SECURE=true` with `COOKIE_SAMESITE=none` if you serve the API from a
   different origin.

---

## 17. Documentation index

| Document | Contents |
|---|---|
| [docs/BRD-ANALYSIS.md](docs/BRD-ANALYSIS.md) | The BRD read end-to-end: scope, actors, requirements, rules, decisions and how each was implemented |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System, module, data-flow and security architecture |
| [docs/DATA-MODEL.md](docs/DATA-MODEL.md) | Every table, relationship, index and integrity rule |
| [docs/BUSINESS-RULES.md](docs/BUSINESS-RULES.md) | The calculation engine, weight rules, status machine, escalation band, validation catalogue |
| [docs/API.md](docs/API.md) | Endpoint catalogue, conventions, error model, examples |
| [docs/TESTING.md](docs/TESTING.md) | Automated suites and the manual UAT script mapped to the acceptance criteria |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Docker, Vercel and local topologies, secrets, backups |

---

## 18. Configuration reference

Every business parameter is configuration, not code (FR-CFG-02). The active
version is visible and publishable from **Configuration**.

| Parameter | Default | BRD |
|---|---|---|
| Score cap / floor | 120.00 / 0.00 | D-07, D-09 |
| Adjustment band | ±10.00 points | D-01 |
| Weight range | 5–50% per KPI | A-04, W-1 |
| Maximum KPIs per employee/period/frequency | 10 | A-04, W-6 |
| Submission grace | 7 calendar days after period end | A-05 |
| Review window / review SLA | 7 days / 5 working days | A-05 |
| Extension maximum | 7 days | FR-CFG-04 |
| Minimum reason length | 15 characters | ADJ-1 |
| Evidence limits | 5 files, 10 MB each | FR-EVD-01 |
| Qualitative rubric map | L1 50 · L2 75 · L3 100 · L4 110 · L5 120 | A-10 |
| RAG thresholds | Green ≥ 95 · Amber ≥ 75 | §4.5 |
| Categories | Financial · Customer · Internal Process · People & Learning | A-01 |
| Working week | Saturday–Thursday (Friday is the weekly holiday) | §21.2 |
| Timezone / currency | Asia/Dhaka · BDT with lakh/crore grouping | §1.4 |

Key environment variables are documented in `.env.example` and
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

---

<div align="center">

**ANWAR KPIFlow** · Variable KPI Phase 01 · Anwar Group of Industries

*Internal & Confidential*

</div>
