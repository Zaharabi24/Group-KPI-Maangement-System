# Testing — ANWAR KPIFlow

Two automated suites run against a live API and a seeded database, and a manual
UAT script walks the BRD's acceptance criteria.

---

## 1. Automated suites

### 1.1 Prerequisites

```bash
docker compose up -d postgres redis mailpit      # infrastructure
cd backend
npx prisma migrate deploy                        # or: npx prisma migrate dev
npm run seed
npm run start:dev                                # or: node dist/main.js
```

### 1.2 Workflow suite — 85 assertions

```bash
cd backend
node scripts/smoke-test.mjs                       # defaults to http://localhost:4100/api/v1
node scripts/smoke-test.mjs http://host/api/v1    # against another environment
```

| Group | What is asserted |
|---|---|
| Health | `/health` returns `ok`; the database and Redis report `up` |
| Authentication (M01) | `gmail.com` rejected; wrong password rejected; all six roles sign in and land on their correct home screen; `/auth/me` returns permissions |
| Calculation (M08) | All seven §4.6 examples, including the cap at 120, the floor at 0, the zero-tolerance rule and the `V-TGT-01` block (AC-05) |
| My KPI (M05) | Card list with status counts, the weight meter, the six-field calculation path with **no** Curve/Adjustment/Score-Version rows, evidence and history panels, the approver drop-down, and the self-approver block (BR-R04) |
| Weight rule (W-2) | Saving above 100% is blocked with the exact "Available: Y%" copy (AC-06) |
| Data scope (§5.3) | A Department Head sees their queue; a peer BU approver sees their own; an employee gets 403; a Management Viewer gets 403 on the audit log (AC-16, AC-22) |
| Dashboards (M09–M11) | Metric cards, the 10-column records table, the 12/4/5 chart series with `has_data` flags, the signed difference label, department cards, a unique-per-employee ranked leaderboard, group BU comparison and the Department Head 403 (AC-14, AC-15, AC-20) |
| Reports (M12) | The catalogue lists RP-01…RP-13, RP-01/02/03/05/11 produce rows, RP-06 is denied to an employee, and the CSV export carries a footer (AC-19) |
| Approvals (M07) | Opening a request sets Under Review, a return without a reason is blocked, a return with a comment succeeds, the state machine holds, an employee cannot decide, escalations are Super-Admin-only, bulk approve validates (AC-09…AC-12) |
| Notifications (§15) | The centre returns items and an unread count |
| Organisation (M03) | Readable by any authenticated user; nine business units; **departments are filtered by the selected business unit and every returned department belongs to it**; the public lists work without auth |
| Periods & configuration (M15) | Selectable periods, the active configuration, the calendar with counters, closed periods present, and an employee blocked from generating a calendar (AC-18) |
| Audit (§18) | Hash-chained records with 64-character hashes; the chain verifier returns a result (AC-23) |
| Search (FR-SRC-01) | Scoped employee results; unauthenticated search is rejected |
| Profile (M02) | Identity and approvers; an invalid phone is rejected; a valid phone is normalised to E.164 (US-03) |
| Security (NFR-SEC) | Unauthenticated requests are rejected; a System Administrator sees technical events only and is refused KPI content (§5.2) |

Expected result: `Passed: 85   Failed: 0`.

### 1.3 Evidence suite — 15 assertions

```bash
cd backend
node scripts/evidence-check.mjs
```

| Assertion | Requirement |
|---|---|
| A KPI with evidence exists and the detail exposes its SHA-256 (64-character hex) | FR-EVD-02 |
| A signed download URL is issued with a 300-second TTL | FR-EVD-04 |
| The signed URL downloads the file and the downloaded bytes hash to the **stored** SHA-256 | Tamper-evidence |
| A tampered signature is rejected with 403 | FR-EVD-04 |
| An expired signature is rejected with 403 | FR-EVD-04 |
| An `.exe` upload is rejected with 422 | AC-07 |
| A macro-enabled `.docm` upload is rejected with 422 | FR-EVD-02 |
| The EICAR test file is rejected with 422 | AC-07 |
| A 12 MB upload is rejected | AC-07 |

Expected result: `Passed: 15   Failed: 0`.

### 1.4 Type and build checks

```bash
cd backend  && npx tsc --noEmit -p tsconfig.json    # 0 errors
cd frontend && npx tsc --noEmit -p tsconfig.json    # 0 errors
cd frontend && npm run build                        # tsc --noEmit && vite build
```

### 1.5 Screenshot tour

```bash
cd backend
node scripts/capture-screenshots.mjs                # writes ./screenshots
```

---

## 2. Acceptance criteria coverage

| AC | Criterion | Covered by |
|---|---|---|
| AC-01 | `gmail.com` fails with the domain message; `@anwargroup.net` creates a Pending Activation account and sends a setup e-mail | smoke: registration; verified in Mailpit |
| AC-02 | Each eye toggle changes only its own field; Create Password stays disabled until valid; a used or expired link cannot be reused | `SetPasswordPage` live checklist + `inspectToken`; token inspection asserted |
| AC-03 | The 5th consecutive failure locks for 15 minutes; login routes by role | smoke: wrong password + three role home screens (lockout e-mail visible in Mailpit) |
| AC-04 | Submit stays disabled until all ten fields and ≥ 1 evidence file are valid; Save Draft works with partial data | `CreateKpiDrawer` gating + the seeded Draft with an empty actual |
| AC-05 | Every §4.6 example matches across preview, API and the stored version | smoke: seven calculation assertions |
| AC-06 | With 90% allocated, weight 15 cannot be saved (`W-EXCEED`, available 10%); rejected/deleted release weight | smoke: weight rule |
| AC-07 | 12 MB, `.exe` and EICAR files are rejected; an accepted file shows its SHA-256 and the link expires after 5 minutes | evidence suite (all five) |
| AC-08 | On submit the status becomes Submitted, version 1 is frozen, the approver receives NT-05, steps 1–4 tick | smoke: submit; NT-05 in Mailpit |
| AC-09 | The queue lists Employee Name and ID, oldest first; filters work; opening sets Under Review | smoke: approvals + `ApprovalsPage` |
| AC-10 | Approve calculated sets FS = CS and Approved, freezes, sends NT-07, refreshes dashboards | smoke: approve; NT-07 in Mailpit |
| AC-11 | Return/Reject/Delete/Adjustment need ≥ 15 characters; Reject also needs a category; each sends its notification | smoke: return without/with a reason |
| AC-12 | Δ ≤ 10 is approved directly; Δ = 10.01 escalates and notifies Super Admins; a declined escalation returns to Under Review | `bandTest` + `ApprovalsService.adjust` / `decideEscalation`; smoke: escalations |
| AC-13 | The detail shows Calculated Score, Final Score and an Adjustment History entry; the calculation path has no Curve/Adjustment/Score-Version rows | smoke: calculation path labels |
| AC-14 | Summary cards equal the §4.5 formulas for M/Q/Y; the difference label follows the sign | smoke: metric cards + difference label |
| AC-15 | The records table shows exactly the 10 columns; three bar charts with distinct colours and "No data" for empty periods | smoke: column check + chart series |
| AC-16 | An HR approver sees only HR; a second HR approver can be added; a cross-department URL returns 403 and is audited | smoke: data scope; the seeded second HR Department Head |
| AC-17 | Assigning to 5 employees with one over capacity creates 4 and lists 1 conflict; targets are read-only | `TemplatesService.assign`; KPI Library assignment wizard |
| AC-18 | A period with pending requests cannot be closed; after close every KPI is locked and snapshots exist | smoke: period checks; `PeriodsService.close` guard |
| AC-19 | Each export contains only in-scope rows, matches the preview, carries a footer, and creates an audit entry | smoke: CSV export footer |
| AC-20 | Dashboard values reconcile with RP-03; each employee appears once on the leaderboard, ordered per §4.5 | smoke: dashboard + unique ranked leaderboard |
| AC-21 | Every change after submission creates a new version; comparing two versions highlights changes; a restore creates a new version | `VersionHistoryPage` diff + `/kpis/:id/versions/restore` |
| AC-22 | An automated authorisation suite covers every endpoint × role combination | smoke: the scope and security groups |
| AC-23 | A UAT audit sweep finds an entry for 100% of §18 actions; the hash chain verifies | smoke: audit assertions |
| AC-24 | Load test at 300 concurrent users; the restore drill meets RTO/RPO | Operational — procedures in `docs/DEPLOYMENT.md` |
| AC-25 | Adding a new KPI type requires only a new `kpi_type` value and configuration | `kpi_type` enum; no per-type tables |

---

## 3. Manual UAT script

Sign in as each role and complete the steps below.

### 3.1 Employee journey

1. **Register** with `yourname@gmail.com` → the domain message appears and nothing is created.
2. **Register** with a valid `@anwargroup.net` address → confirm the setup e-mail in Mailpit at http://localhost:8026 within 2 minutes (AC-01).
3. Open the setup link → the checklist turns green as you type; the eye toggle changes only its own field; **Create Password** stays disabled until both fields match and the policy is met (AC-02).
4. Sign in → you land on **My KPI**.
5. Click **Create KPI** → the drawer opens with four sections.
6. Enter Measurement Type `Time (days)`, Direction `Lower is better`, Target `5`, Actual `4`, Weight `10` → the live panel shows **Achievement 120.00, Score 120.00, Weighted 12.00** (AC-05).
7. Attach a CSV → the SHA-256 appears; the Submit button becomes enabled (AC-04).
8. **Submit KPI** → the card moves to Submitted and steps 1–4 tick (AC-08).
9. Check Mailpit → the approver received NT-05.

### 3.2 Department Head journey

1. Sign in as `kamrul.hasan@anwargroup.net` → you land on the **Department Dashboard**.
2. Open **KPI Pending Requests** → the queue is oldest first and shows name, Employee ID and SLA age (AC-09).
3. Click **View Request** → the status becomes Under Review and the employee receives NT-06 (AC-09).
4. Click **Return to employee** with no comment → the action stays disabled; add a comment of 15+ characters → it succeeds and NT-09 is sent (AC-11).
5. Reopen the request, choose **Apply adjustment**, set the Final Score to `95` when the calculated score is `83.33` → the band indicator warns that it will escalate. Confirm → the status becomes Escalated and every Super Admin receives NT-11 (AC-12).
6. Open the **Leaderboard** → each employee appears once, ranked, with a RAG bar (AC-20).

### 3.3 Super Admin journey

1. Sign in as `superadmin@anwargroup.net` → you land on the **Group Dashboard**.
2. Open **Escalations** → the proposed score, the calculated score and Δ are shown side by side. **Approve** → the employee and the approver receive NT-12 (AC-12).
3. Open **Department Head KPI Requests** → the two seeded Department Head KPIs are waiting (FR-APR-08).
4. Open a KPI → **Version history** → compare v1 and v2, the changed fields are highlighted; a restore creates v3 (AC-21).
5. Open **Reports** → pick RP-03 for August 2026 → export CSV, then confirm the footer carries the filters, the user and the timestamp (AC-19).
6. Open **Periods** → try to close September 2026 → the close is blocked with the outstanding list (AC-18).
7. Open **Organisation** → choose a Business Unit and confirm the Department list changes to that unit only.
8. Open **Audit Log** → filter by action, expand a row to see before/after, then click **Verify hash chain** → `ok: true` (AC-23).
9. Open **Configuration** → publish a new version and confirm it applies forward only.

### 3.4 Cross-cutting checks

| Check | How |
|---|---|
| Responsive | Narrow the window to 360 px: the sidebar becomes off-canvas, cards stack, tables scroll with a frozen first column |
| Accessibility | Tab through a form; the focus ring is visible; status badges carry text, not only colour |
| Rate limiting | Attempt 11 logins in a minute → the 11th returns 429 with a friendly message |
| Stale version | Open the same KPI in two tabs, save in one, then save in the other → `STALE-VERSION` with "Reload to continue" |
| Session policy | Leave a session idle for 30 minutes → the next request asks you to sign in again |
| Notifications | Trigger an approval → the bell badge increments without a page reload |

---

## 4. Test data

| Account | Password | Role |
|---|---|---|
| `superadmin@anwargroup.net` | `Anwar@KPI2026` | Super Admin |
| `hradmin@anwargroup.net` | `Anwar@KPI2026` | HR Admin |
| `kamrul.hasan@anwargroup.net` | `Anwar@KPI2026` | Department Head (Sales & Marketing, ACL) |
| `rezaul.karim@anwargroup.net` | `Anwar@KPI2026` | Department Head (Marketing & Communication, ACL) |
| `abdul.momin@anwargroup.net` | `Anwar@KPI2026` | Department Head (Accounts & Finance, ACL) |
| `nazmul.huda@anwargroup.net` | `Anwar@KPI2026` | Second Department Head (Group HR, ACL) |
| `rafi.ahmed@anwargroup.net` | `Anwar@KPI2026` | Employee (five KPIs, 100% weight) |
| `ayesha.siddiqua@anwargroup.net` | `Anwar@KPI2026` | Employee (one incomplete Draft, 90% weight free) |
| `management.viewer@anwargroup.net` | `Anwar@KPI2026` | Management Viewer |
| `sysadmin@anwargroup.net` | `Anwar@KPI2026` | System Administrator |

Seeded state: four closed months (May–August 2026) fully approved with snapshots,
and September 2026 open with a mix of Drafts, Submitted, Under Review and Approved
KPIs, plus two Department Head KPIs waiting in the Super Admin queue.
