# Data Model — ANWAR KPIFlow

The complete model lives in `backend/prisma/schema.prisma` (28 tables) and is
described by the BRD in §12.2–§12.3.

---

## 1. Data classes

| Class | Tables | Rules |
|---|---|---|
| **Master** | `business_unit`, `department`, `designation`, `user`, `role`, `user_role`, `user_role_scope`, `kpi_category`, `kpi_template`, `kpi_period`, `configuration_version`, `department_head`, `approver_delegation` | Soft-deactivate only; e-mail and employee code unique; role codes `SUPER_ADMIN`, `HR_ADMIN`, `DEPT_HEAD`, `EMPLOYEE`, `MGMT_VIEWER`, `SYS_ADMIN`; scope `departmentId = null` means group; templates and configuration are versioned and immutable once published; a period is unique per `(frequency, start_date)` |
| **Transactional** | `kpi`, `kpi_evidence`, `kpi_decision`, `kpi_adjustment`, `notification`, `escalation`, `correction_request`, `kpi_extension`, `kpi_assignment`, `session`, `token`, `invitation`, `email_log`, `export_job` | `kpi` holds `kpi_type`, the organisation snapshot, status, the locked flag, `current_version_no` and `row_version`; unique `(employee, period, name)` where not deleted; evidence stores `sha256` and `scan_status` |
| **Historical (insert-only)** | `kpi_version`, `calculation_log`, `performance_snapshot`, `audit_log`, `scheduled_job_run`, `idempotency_key` | `kpi_version` snapshots T, A, W, ACH, CS, FS, WS and the configuration version; `audit_log` is hash-chained |

---

## 2. Entity relationships

```
business_unit 1─────* department
     │                     │
     │                     ├─────* user
     │                     ├─────* department_head *─────1 user
     │                     └─────* user_role_scope
     │
     └─────* user
             │
             ├─────* user_role *─────1 role
             ├─────* user_role_scope  (roleId, departmentId?, businessUnitId?)
             ├─────* session
             ├─────* token
             ├─────* notification
             └─────* kpi (as employee)

kpi_period 1─────* kpi  *─────1 user (employee)
                    │    *─────1 user (approver, nullable → Super Admin queue)
                    │    *─────1 kpi_category
                    │    *─────1 kpi_template (nullable)
                    │    *─────1 configuration_version
                    │    *─────1 business_unit, department  (organisation snapshot)
                    │
                    ├─────* kpi_version          (insert-only snapshots)
                    ├─────* kpi_evidence
                    ├─────* kpi_decision
                    ├─────* kpi_adjustment
                    ├─────* calculation_log
                    ├─────* escalation
                    ├─────* correction_request
                    └─────* kpi_extension

kpi_assignment *─────1 kpi_template
kpi_assignment *─────1 department, user (assigner)

performance_snapshot *─────1 user, kpi_period   (unique per employee, period, frequency)
audit_log            *─────1 user (actor, nullable), user (subject, nullable), department (nullable)
export_job           *─────1 user, department (nullable)
email_log            *─────1 user (nullable)
invitation           *─────1 business_unit, department, user (inviter)
approver_delegation  *─────1 user (from), user (to), department
```

---

## 3. Key constraints that encode business rules

| Table | Constraint | Rule it enforces |
|---|---|---|
| `business_unit` | `code` unique | One row per BU code from the Excel master data |
| `department` | `@@unique([businessUnitId, name])` | **A department name is unique within its business unit** — the BU → Department relationship |
| `department` | `@@unique([businessUnitId, code])` | Stable department codes per BU |
| `user` | `email` unique, `employeeCode` unique | FR-AUTH-03 |
| `user_role` | `@@unique([userId, roleId])` | A role is granted once |
| `user_role_scope` | `@@unique([userId, roleId, departmentId])` | One scope row per user/role/department; `departmentId = null` means group |
| `department_head` | `@@unique([departmentId, userId])` | Several Department Heads per department are allowed, but not the same one twice |
| `kpi` | `@@unique([employeeId, periodId, name])` | `KPI-DUP` — one KPI name per employee and period |
| `kpi` | `kpiWeight BETWEEN 1 AND 100` (DB) plus the configured 5–50 in the application | `W-1`, `W-2` |
| `kpi_period` | `@@unique([frequency, startDate])` | One period per frequency and start date |
| `kpi_version` | `@@unique([kpiId, versionNo])` | Versions are a gapless sequence |
| `performance_snapshot` | `@@unique([employeeId, periodId, frequency])` | One snapshot per employee and period |
| `configuration_version` | `version` unique | Published versions are immutable |
| `escalation` / `correction_request` | status enum | Only a `PENDING` row can be decided |

---

## 4. Indexes for the queues and dashboards

| Index | Serves |
|---|---|
| `kpi(approverId, status)` | The approver's pending-request queue |
| `kpi(departmentId, periodId, status)` | The department dashboard and RP-03 |
| `kpi(employeeId, frequency, periodId)` | My KPI, Performance Summary and RP-02 |
| `kpi(code)` | Search by KPI code |
| `user(departmentId, status)` | Approver lists and department headcount |
| `user(businessUnitId)` | BU roll-ups |
| `audit_log(actorId, createdAt)`, `audit_log(entityType, entityId)`, `audit_log(createdAt)` | The audit viewer and per-entity history |
| `notification(userId, status)` | The notification centre and unread count |
| `escalation(status, createdAt)` | The escalations queue (oldest first) |
| `performance_snapshot(periodId, departmentId)` | Closed-period dashboards and RP-02/RP-12 |
| `calculation_log(kpiId, createdAt)` | The calculation path on the KPI detail |

---

## 5. Ranges, precision and money

| Value | Type | Why |
|---|---|---|
| `target`, `actual` | `NUMERIC(18,2)` | Money and precise measures; never floating point |
| `achievement` | `NUMERIC(12,2)` | Uncapped achievement can exceed 100 by a wide margin |
| `calculated_score`, `final_score`, `weighted_score` | `NUMERIC(7,2)` | Bounded by the cap of 120 |
| `kpi_weight` | `SMALLINT` | Integer percentages |
| `total_kpi_score` | `NUMERIC(7,2)` | Period aggregate |
| `average_achievement` | `NUMERIC(12,2)` | Weighted average, uncapped |
| Timestamps | `TIMESTAMPTZ` (Prisma `DateTime`) | ISO-8601 UTC on the wire; displayed in Asia/Dhaka |
| Dates | `DATE` for period boundaries and extensions | Avoids off-by-one at midnight |

Money is displayed with **lakh/crore** grouping (`1,00,00,000.00`) and short
forms on cards (`BDT 1.00 Cr`, `BDT 6.10 L`), as §1.4 and §4.4 require.

---

## 6. Integrity rules

- Foreign keys use `RESTRICT` on delete so a referenced record cannot be removed;
  users and departments are **deactivated** instead.
- Deleting a KPI is a soft delete: `status = DELETED`, with `deletedAt`,
  `deletedById` and `deletedReason`; the weight is released and a Super Admin can
  restore it as a Draft.
- Every KPI mutation increments `rowVersion`, which backs optimistic locking and
  the `STALE-VERSION` error.
- Every audit row stores `previousHash` and `recordHash`; removing or editing any
  row breaks the chain and is detected by the weekly verification job.
- `kpi_version` rows are only ever inserted. A restore creates a new version.
- Periods, once closed, set `isLocked` on every KPI in them; only a reason-bearing
  reopen clears it, and only for non-approved rows.

---

## 7. Seed data

| Entity | Count | Source |
|---|---|---|
| Business units | 9 | `Business Unit & Department List.xlsx` |
| Departments | 104 | the same workbook, deduplicated |
| Designations | 18 | curated |
| KPI categories | 4 | BRD §3.3 S1 |
| Configuration version | 1 | BRD §4, §3.7, §21.4 |
| Periods | 51 | 2025–2027 × (12 monthly + 4 quarterly + 1 yearly) |
| Users | 27 | 4 administrators + 7 Department Heads + 16 employees |
| KPI Library templates | 10 | the BRD's worked examples |
| KPIs | ~400 | 4 closed months plus the open month |
| Evidence files | 382 | real CSV extracts with genuine SHA-256 digests |
| Performance snapshots | 64 | the closed months |

See `backend/prisma/seed.ts` and `backend/prisma/seed-data.ts`.
