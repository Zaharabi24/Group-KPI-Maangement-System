# BRD Analysis — `Anwar_KPIFlow_Variable_KPI_BRD_v1.0`

This document records how the Business Requirements Document was read, what it
requires, and exactly where each requirement is implemented. It is the traceability
record between the BRD and the delivered system.

---

## 1. Document summary

| Field | Value |
|---|---|
| Document | Business Requirements Document — Variable KPI Phase 01 |
| Platform | ANWAR KPI · Module: Anwar KPIFlow |
| Version / status | v1.0 · submitted for stakeholder review |
| Date | 28 September 2026 |
| Classification | Internal & Confidential |
| Source workbooks | `Business Unit & Department List.xlsx` (355 rows, 354 data rows) |

The BRD defines a responsive web application with three role experiences, a
deterministic calculation engine, a workflow engine and an append-only audit log.

---

## 2. The business problem the BRD states

| # | Problem | Business impact |
|---|---|---|
| P1 | Variable KPI performance was reviewed manually | Slow cycles, unreproducible results |
| P2 | Targets, actuals and evidence lived in different places | Scores could not be verified |
| P3 | Scores could be subjective or inconsistent | Perceived unfairness weakened trust |
| P4 | Approvals showed a final number but not the calculation | Management could not defend a score |
| P5 | Performance data was unstructured | Reporting and trend analysis were limited |
| P6 | Manual adjustments had no audit trail | Governance and compliance risk |

**Required shift:** from `KPI Name → Score → Signature → Approval` to
`Target → Actual Achievement → Evidence Report → Score → Review → Approval`.

---

## 3. Product vision as implemented

> One platform where every variable KPI is set, evidenced, scored, reviewed and
> approved in a single, explainable and auditable journey.

| Vision element | Implementation |
|---|---|
| Employee workspace (Profile, My KPI, Performance Summary) | `/profile`, `/my-kpi`, `/performance-summary` |
| Department Head console (Pending Requests, Dashboard, Leaderboard) | `/approvals`, `/dashboard`, `/leaderboard` |
| Super Admin console (users, organisation, configuration, versions, reporting) | `/group-dashboard`, `/all-kpi-requests`, `/admin/*` |
| Deterministic calculation engine | `backend/src/modules/calculation/calculation.engine.ts` |
| Workflow engine | `backend/src/modules/approvals/approvals.service.ts` |
| Append-only audit log | `backend/src/modules/audit/audit.service.ts` (hash-chained) |

---

## 4. Scope decisions

### In scope for Phase 01 — delivered

- Variable KPI end to end: create, evidence, calculate, submit, review, adjust,
  return, reject, approve
- Profile, My KPI and Performance Summary (monthly, quarterly, yearly)
- Self-registration restricted to `@anwargroup.net`, password setup, login, reset
- Super Admin: invitations, organisation master data, users, roles, configuration,
  period management, version control and history
- Department Head: pending requests, decisions, dashboard, leaderboard
- KPI Library templates and assignment of KPIs to employees
- Reports, exports, in-app and e-mail notifications, audit log

### Out of scope for Phase 01 — deliberately not built

| Item | BRD reference | How the system stays ready |
|---|---|---|
| Fixed, Project, People & Culture and the fifth KPI type | §2.5, BR-12 | `kpi_type` enum and configuration-driven behaviour; AC-25 holds |
| Linking scores to variable-pay amounts | D-06 | RP-06 provides the source extract |
| Single sign-on with the corporate IdP | FR-AUTH-10 | MFA-ready account model; the local session layer is isolated |
| Automatic import of actuals from ERP/sales systems | §2.5 | Manual entry with mandatory evidence, as the BRD requires |
| Multi-level approval chains | §2.5 | Single approver plus Super Admin escalation, as specified |
| Native mobile apps | §2.5 | Responsive web from 360 px to 1920 px |

---

## 5. Business rules — where each is enforced

| Rule | Statement | Enforcement |
|---|---|---|
| BR-R01 | Only `@anwargroup.net` addresses may register or be invited | `AuthService.assertCompanyEmail`, `UsersService.invite` |
| BR-R02 | An employee may create their own KPIs; the ten source fields are mandatory at submission | `KpiService.submit` validation gate |
| BR-R03 | The approval person must be an active Department Head of the employee's own department; a Department Head's own KPI is approved by a Super Admin | `KpiService.resolveApprover` |
| BR-R04 | No user may approve, adjust or reject their own KPI | `ScopeService.assertCanDecide`, plus the approver drop-down never listing the requester |
| BR-R05 | Evidence is mandatory: at least one file per KPI | `KpiService.submit` (`EVIDENCE-REQUIRED`) |
| BR-R06 | Scores are never typed; only the engine produces them, and an override needs a reason | `calculateKpi` + `ApprovalsService.adjust` |
| BR-R07 | Total weight per employee, frequency and period may not exceed 100% | `KpiService.assertWeightCapacity` (`W-EXCEED`) |
| BR-R08 | Overrides beyond ±10 points escalate to a Super Admin | `bandTest` in `ApprovalsService.adjust` |
| BR-R09 | Approved KPIs are read-only; a correction needs Super Admin approval and creates a new version | `KpiService.update` guard + `requestCorrection` / `decideCorrection` |
| BR-R10 | A Department Head sees only their assigned department(s) | `ScopeService.kpiScopeWhere` on every query |
| BR-R11 | Every state change writes an immutable audit record | `AuditService.record` called inside every transaction |
| BR-R12 | Closed periods are locked and reopen only with a reason | `PeriodsService.close` / `reopen`, `isLocked` on KPIs |

---

## 6. Goals and objectives — measurable outcomes

| Goal | Objective | Evidence in the build |
|---|---|---|
| G1 Objectivity | 100% of scores are system-calculated | No score input exists anywhere; `calculateKpi` is the only producer |
| G2 Explainability | Every approved KPI shows formula, inputs, evidence and decision history on one screen | The KPI detail view and its six-row calculation path |
| G3 Control and auditability | 100% of edits, adjustments and decisions logged with actor, time, before/after and reason | Hash-chained `audit_log`, `kpi_adjustment`, `kpi_decision` |
| G4 Efficiency | Median submission → decision ≤ 3 working days | SLA tracking, `SlaBadge`, NT-15 reminders and escalation |
| G5 Management insight | Department and group dashboards in real time | `/dashboard`, `/group-dashboard`, RP-01…RP-13 |
| G6 Adoption | ≥ 95% of in-scope employees submit through the platform | Self-service My KPI, deadline reminders (NT-13/NT-14) |

---

## 7. Business Unit and Department data

The platform must support the group's business units and departments, and the
**BU → Department relationship must be maintained**. This was implemented from the
uploaded workbook rather than from assumptions.

| Aspect | Outcome |
|---|---|
| Source | `Business Unit & Department List.xlsx` — 354 data rows with duplicates |
| Distinct business units | **9** |
| Distinct departments | **104** |
| Relationship | Every department belongs to exactly one business unit; enforced by `@@unique([businessUnitId, name])` and a required foreign key |
| Data quality | The one typo in the source (`Accounts and Finance`) was normalised to `Accounts & Finance` |
| Every BU/Department field in the UI | A dropdown, with the Department list filtered by the selected Business Unit |
| Approver routing | Resolved through the department, which resolves to the BU |
| Reporting | Reports filter by BU and by BU-filtered department |

Generated from the workbook into `backend/prisma/seed-data.ts`; the seed is
idempotent so re-running it reconciles with the file.

---

## 8. Stakeholders and what each receives

| Stakeholder | Interest | Delivered |
|---|---|---|
| Deputy Managing Director (sponsor) | A fair, explainable, auditable process and group visibility | Group Dashboard, RP-13, the audit trail |
| Upper Management (Super Admin) | Control over configuration, approvers, versions | Configuration, Periods, Version history, all queues |
| HR (policy owner) | Consistent rules, KPI standards, joiners/leavers/transfers | KPI Library, bulk import, transfers, RP-06, RP-11 |
| Department Heads (approvers) | A fast review queue and a department overview | Pending requests, dashboard, leaderboard |
| Employees | Simple entry, transparent scoring, visible history | My KPI, the create drawer, KPI detail, Performance Summary |
| Group IT | A maintainable, secure, scalable build | Modular NestJS, Docker, health/system screens, docs |
| Internal audit | Tamper-evident records and reasons | Hash-chained audit log with a verifier and CSV export |

---

## 9. Assumptions adopted (BRD §21.1)

| ID | Assumption | Adopted |
|---|---|---|
| A-01 | Supporting fields (category, measurement type, unit, direction, frequency, description) are acceptable additions | Yes — all six are mandatory or optional per the BRD table |
| A-02 | HR Admin and Management Viewer roles may be added | Yes — both seeded and enforced |
| A-03 | Score = achievement capped at 120, floored at 0, with no curve | Yes — `CAP`/`FLOOR` are configuration |
| A-04 | Weight 5–50%, ≤ 100% per employee/period, maximum 10 KPIs | Yes — all four values are configuration |
| A-05 | 7-day grace, 7-day review window, 5-working-day SLA | Yes — configuration, Saturday–Thursday working week |
| A-06 | Negative targets/actuals unsupported | Yes — `V-NUM-02` |
| A-07 | Self-registration needs no approval to log in; the department is confirmed before the first submission | Yes — `organisationConfirmed` + the New registrations queue |
| A-08 | The technology stack follows the group's practice | Adjusted to the requested stack: NestJS + Prisma + PostgreSQL + React (the BRD listed FastAPI as an assumption) |
| A-09 | Each department belongs to one BU; group departments sit under a group unit | Yes — a required BU foreign key |
| A-10 | Qualitative rubric map L1–L5 = 50/75/100/110/120; reporting year January–December | Yes — both are configuration |

---

## 10. Decisions and open questions

| ID | Decision | Implemented |
|---|---|---|
| D-01 | Adjustment band ±10 points with escalation | Yes — configurable |
| D-02 | Separate target-approval step | Deferred to Phase 01b, as the BRD recommends |
| D-03 | No scoring curve or minimum threshold in Phase 01 | Yes — cap and floor only |
| D-04 | January–December reporting year, fiscal basis configurable | Yes |
| D-05 | No normalisation when allocated weight < 100% | Yes — unallocated weight contributes 0 |
| D-06 | No link to variable-pay amounts | Deferred; RP-06 is the extract |
| D-07/D-08/D-09 | Rubric map, weight limits, score cap | Adopted as configuration defaults |

Open questions the BRD leaves to stakeholders (OQ-01 fifth KPI type, OQ-02
quarter length, OQ-03 employee leaderboard visibility, OQ-04 group departments,
OQ-05 Super Admin KPIs, OQ-06 minimum KPIs, OQ-07 retention) are answered with the
BRD's own recommendations: the model supports a fifth type, a quarter is three
months, employees do not see the department leaderboard, group departments sit
under a group unit, another Super Admin approves a Super Admin's KPI, there is no
minimum KPI count, and audit/evidence are retained 7 years.

---

## 11. Source coverage (BRD Appendix A)

| Source requirement | Implemented at |
|---|---|
| Business units and departments; five KPI types with Variable KPI in Phase 01 | Section 7 above; `kpi_type` |
| Account creation with 5 fields, domain validation, setup e-mail, password with eye toggle, match check, login | `/register`, `/set-password`, `/login` |
| Sidebar Profile (corporate phone), My KPI, Performance Summary; Create KPI with 10 required fields | App shell; `/profile`, `/my-kpi` |
| KPI card layout, Create KPI (+) always visible, cards inside a scrollable card | `MyKpiPage` with the sticky Create KPI tile |
| View Detail; Curve Applied, Adjustment and Score Version removed; KPI Weight included; approver changes shown; adjustment history | `KpiDetailPage` with the six-row calculation path |
| Performance Summary with monthly/quarterly/yearly metrics, 10-column table, three coloured bar charts | `PerformanceSummaryPage` |
| Super Admin: full control, department-wise employees, receives/edits/approves all KPIs, invites several approvers per department, sees Department Head KPIs, version control and history | `/group-dashboard`, `/all-kpi-requests`, `/head-kpi-requests`, `/admin/*` |
| Department Head: My KPI and Performance Summary, Pending Requests (view, edit, update, delete), approve/reject/adjust/return, M/Q/Y filters, Employee Name and ID | `/approvals` with the decision drawer |
| Department Head dashboard (average achievement bar, pending, approved, rejected, below target) and ranked leaderboard | `/dashboard`, `/leaderboard` |

---

## 12. Non-functional requirements

| Requirement | Implementation |
|---|---|
| NFR-PER-01…05 performance | Indexed queries, server-side pagination, chart series computed in one pass, async exports over 10,000 rows |
| NFR-SCA-01 scalability | Stateless API, horizontally scalable workers, durable queues |
| NFR-REL-01 reliability | Transactional writes, durable BullMQ queues, 1/5/15-minute e-mail retries |
| NFR-SEC-01…07 security | Helmet, Argon2id, RBAC + scope, AES-256-GCM evidence, session policy, rate limits, content-verified uploads |
| NFR-PRV-01 privacy | Least-privilege scope, audited exports, footer watermarks, no personal data in logs |
| NFR-INT-01 integrity | Fixed-point decimals, FK constraints, idempotency, optimistic locking, nightly verification |
| NFR-AUD-01 auditability | Append-only hash chain, weekly verification, 7-year retention |
| NFR-MNT-01 maintainability | Modular services, versioned migrations, configuration not code |
| NFR-ACC-01 accessibility | WCAG 2.1 AA patterns, keyboard operation, focus rings, status never colour-only |
| NFR-CMP-01 browsers | Latest Chrome, Edge, Firefox, Safari; 360–1920 px |
| NFR-BAK-01 / DR-01 | Documented backup and DR procedures in `docs/DEPLOYMENT.md` |
| NFR-LOG-01 monitoring | Structured logs with a correlation ID; System Health screen |
| NFR-ERR-01 error handling | The standard envelope with friendly messages and a reference ID |
