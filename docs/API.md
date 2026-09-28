# API Reference — ANWAR KPIFlow

Base URL: `https://<host>/api/v1` (development: `http://localhost:4100/api/v1`)

---

## 1. Conventions (§13.1)

| Aspect | Rule |
|---|---|
| Format | REST/JSON |
| Authentication | A short-lived access token (15 minutes) in `Authorization: Bearer <token>`, plus a rotating refresh token in an `HttpOnly; Secure; SameSite=Strict` cookie |
| Envelope | Success: `{ "data": …, "meta": { "correlation_id", "timestamp" } }`. Error: `{ "error": { … } }` |
| Decimals | Serialised as **strings** — `"113.33"` — never as floats |
| Timestamps | ISO-8601 UTC |
| Lists | `page`, `size` (25/50/100), `sort`, `order` and filters |
| Optimistic locking | `If-Match: <row_version>` on state-changing KPI calls |
| Idempotency | `Idempotency-Key: <uuid>` accepted on submit and decision |
| Correlation | Send `X-Correlation-Id` or receive one; it is echoed and appears in every error |
| Rate limits | 300 requests/minute per client; 10 logins/minute per IP |

---

## 2. Error model (§13.3)

```json
{
  "error": {
    "code": "W-EXCEED",
    "message": "Weight exceeds 100% by 5.00%. Available: 0%",
    "field_errors": [
      { "field": "kpiWeight", "code": "W-EXCEED", "message": "Weight exceeds 100% by 5.00%. Available: 0%" }
    ],
    "correlation_id": "8f2c1d34-…",
    "path": "/api/v1/kpis",
    "timestamp": "2026-09-28T10:55:19.533Z"
  }
}
```

| Status | Meaning |
|---|---|
| 400 / 422 | Validation |
| 401 | Unauthenticated |
| 403 | Forbidden — **audited** |
| 404 | Not found, or out of scope (never reveals existence) |
| 409 | Conflict or business rule |
| 413 | File too large |
| 423 | Account locked |
| 429 | Rate limited |
| 500 / 503 | System error with a reference ID |

| Code | HTTP | Condition |
|---|---|---|
| `VALIDATION_FAILED` | 400 | The payload failed DTO validation |
| `V-TGT-01` | 422 | Target must be > 0 for higher-is-better KPIs |
| `V-NUM-02` | 422 | Negative value or too many decimal places |
| `V-MISSING` | 422 | A mandatory field is absent |
| `V-PASSWORD-01` | 422 | Password policy failure |
| `W-EXCEED` | 409 | Weight capacity exceeded |
| `W-MIN` / `W-MAX` | 422 | Weight outside the configured range |
| `MAX-KPI` | 409 | Maximum KPIs per period reached |
| `KPI-DUP` | 409 | Duplicate KPI name for the employee and period |
| `KPI-STATUS` | 409 | The action is not allowed in this status |
| `KPI-LOCKED` | 409 | The period is locked |
| `PERIOD-CLOSED` | 409 | The period is closed |
| `DEADLINE-PASSED` | 409 | The submission deadline has passed |
| `APPROVER-INVALID` | 403 | Not an active Department Head of the employee's department |
| `APPROVER-REQUIRED` | 409 | No approver available |
| `SELF-DECISION` | 403 | Attempted to decide on one's own KPI |
| `STALE-VERSION` | 409 | The record changed since it was opened |
| `REASON-REQUIRED` | 422 | A reason of at least 15 characters is required |
| `EVIDENCE-REQUIRED` | 422 | No evidence attached |
| `FILE-REJECTED` | 422/413 | Type, size or malware-scan failure |
| `CORRECTION-REQUIRED` | 409 | An approved KPI needs the correction flow |
| `PERIOD-PENDING-ITEMS` | 409 | Close blocked by pending items |
| `AUTH-UNAUTHENTICATED` | 401 | Missing or invalid credentials |
| `AUTH-ACCOUNT-LOCKED` | 423 | Locked for 15 minutes |
| `AUTH-ACCOUNT-INACTIVE` | 403 | Deactivated account |
| `AUTH-TOKEN-INVALID` / `AUTH-TOKEN-EXPIRED` | 422 | Token problem |
| `OUT-OF-SCOPE` | 403 | The record belongs to another department |
| `CONFLICT` | 409 | Generic uniqueness or referential conflict |
| `NOT-FOUND` | 404 | Unknown resource |
| `RATE-LIMITED` | 429 | Too many requests |

---

## 3. Endpoints

### 3.1 Authentication

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/auth/register` | public | Self-register with `@anwargroup.net`; creates a Pending Activation account and queues the setup link (NT-01) |
| POST | `/auth/resend-activation` | public | Resend the setup link (allowed after 60 s, 5/hour) |
| GET | `/auth/token/:token` | public | Inspect a setup token without consuming it |
| POST | `/auth/set-password` | token | Apply the password policy and activate the account |
| POST | `/auth/reset-password` | token | Reset with a 30-minute single-use token |
| POST | `/auth/password-policy` | public | Evaluate the live policy checklist |
| POST | `/auth/login` | public | Authenticate; returns the access token, the home route and permissions |
| POST | `/auth/refresh` | cookie | Rotate the refresh token and issue a new access token |
| POST | `/auth/logout` | any | Revoke the session |
| POST | `/auth/forgot-password` | public | Neutral confirmation; queues the reset link (NT-03) |
| POST | `/auth/change-password` | any | Change the password; revokes every session |
| GET | `/auth/sessions` | any | Active sessions |
| DELETE | `/auth/sessions/:id` | any | Revoke one session |
| GET | `/auth/me` | any | The authenticated principal |

```http
POST /api/v1/auth/login
Content-Type: application/json

{ "email": "rafi.ahmed@anwargroup.net", "password": "Anwar@KPI2026", "rememberMe": false }
```
```json
{
  "data": {
    "accessToken": "eyJhbGciOi…",
    "accessTokenExpiresIn": 900,
    "refreshTokenExpiresAt": "2026-09-28T22:55:52.129Z",
    "user": { "id": "…", "fullName": "Rafi Ahmed", "employeeCode": "E2002", "roles": ["EMPLOYEE"] },
    "home": "/my-kpi",
    "permissions": ["report:view"],
    "mustConfirmOrganisation": false
  },
  "meta": { "correlation_id": "…", "timestamp": "…" }
}
```

### 3.2 Organisation and users

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET | `/organisation/public/business-units` | public | The 9 business units for the registration form |
| GET | `/organisation/public/departments?businessUnitId=` | public | Departments **filtered by the selected business unit** |
| GET | `/organisation/business-units` · `/departments` | authenticated | Lists (with `includeInactive`) |
| POST/PATCH | `/organisation/business-units` · `/:id` | `org:manage` | Create / rename (code upper-cased, unique) |
| POST | `/organisation/business-units/:id/deactivate` | `org:manage` | Blocked while active departments or users exist |
| POST/PATCH | `/organisation/departments` · `/:id` | `org:manage` | Create (auto code) / update; a BU change is blocked when in use |
| POST | `/organisation/departments/:id/deactivate` | `org:manage` | Blocked while active employees exist |
| GET | `/organisation/tree` · `/designations` | `org:manage` | BU → Department tree; designations |
| GET | `/admin/users` · `/:id` | `user:manage` etc. | Filtered, paginated user list |
| POST | `/admin/invitations` | `user:invite` | Invite with a 72-hour set-password link (NT-02) |
| GET | `/admin/invitations` | `user:manage` | Pending invitations |
| POST | `/admin/invitations/:id/resend` · `/revoke` | `user:manage` | Resend / revoke |
| POST | `/admin/users/bulk-import` | `user:manage` | Row-level validation report |
| PATCH | `/admin/users/:id` | `user:manage` | Update identity and placement |
| POST | `/admin/users/:id/transfer` | `user:manage` | Transfer with a reason (audited) |
| POST | `/admin/users/:id/roles` | `user:manage` | Grant / revoke roles |
| POST | `/admin/users/:id/deactivate` · `/reactivate` | `user:manage` | Last-Department-Head guard |
| POST/GET/DELETE | `/admin/delegations` | `user:manage` | Approver delegation for a date range |
| GET | `/admin/registrations` | scope | Unconfirmed self-registrations |
| POST | `/admin/registrations/:id/confirm` | scope | Confirm the BU/department (FR-ORG-09) |
| GET | `/users/approvers?departmentId=` | any | The approver drop-down |
| GET | `/users/directory?search=` | any | Lightweight directory for pickers |

### 3.3 My KPI (M05)

| Method | Path | Purpose |
|---|---|---|
| GET | `/kpis?frequency=&periodId=&status=&search=&page=&size=` | Card list with status counts, the period, allocated and available weight |
| POST | `/kpis` | Create a Draft (validates period, target rule, weight, uniqueness, approver) |
| GET | `/kpis/:id` | Full detail: stepper, calculation path, evidence, adjustment and decision history, permission flags |
| PATCH | `/kpis/:id` | Edit (owner on Draft/Returned, or approver in review with a reason) |
| DELETE | `/kpis/:id` | Owner soft-deletes a Draft with a reason |
| POST | `/kpis/:id/submit` | Freeze the version, recalculate, set Submitted, queue NT-05 |
| POST | `/kpis/:id/withdraw` | Submitted → Draft before the approver opens it |
| POST | `/kpis/:id/restore` | Super Admin restores a deleted KPI as a Draft |
| POST | `/kpis/preview-calculation` | Stateless preview using the same algorithm |
| GET | `/kpis/meta/weights?periodId=&frequency=` | Weight availability, min/max, remaining KPI slots |
| GET | `/kpis/meta/approvers` | Approver options plus the routing mode |
| GET | `/kpis/meta/categories` · `/reference` | Categories; measurement types, reject categories |
| GET | `/kpis/:id/versions` | Version history |
| GET | `/kpis/:id/versions/:from/diff/:to` | Changed fields between two versions |
| POST | `/kpis/:id/versions/restore` | Restore as a **new** version |
| GET | `/kpis/:id/report` | The KPI report payload |
| GET | `/kpis/drill-down/:kind` | `below_target`, `pending`, `approved`, `rejected`, `not_submitted`, `weight_incomplete` |

```http
POST /api/v1/kpis/preview-calculation
{ "measurementType": "COUNT", "direction": "HIGHER", "target": 15, "actual": 17, "kpiWeight": 20 }
```
```json
{ "data": { "achievement": "113.33", "calculatedScore": "113.33", "finalScore": "113.33",
            "weightedScore": "22.67", "formulaText": "(actual 17 / target 15) × 100",
            "capped": false, "floored": false, "cap": "120.00", "floor": "0.00" } }
```

### 3.4 Evidence (M06)

| Method | Path | Purpose |
|---|---|---|
| POST | `/kpis/:id/evidence` | Multipart upload, 1–5 files |
| POST | `/kpis/:id/evidence/:evidenceId/replace` | Replace while Returned (new file version) |
| DELETE | `/kpis/:id/evidence/:evidenceId` | Remove while Draft/Returned |
| GET | `/evidence/:id/url` | A 5-minute signed URL (audited) |
| GET | `/evidence/:id/download?token=` | Signed download — the signature authorises it |
| GET | `/evidence/:id/preview?token=` | Inline PDF/image preview |

Upload validation: content-sniffed MIME type, extension allow-list, macro/executable
and EICAR refusal, ≤ 10 MB, SHA-256 computed, AES-256-GCM at rest.

### 3.5 Approvals (M07)

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET | `/approvals` | `kpi:review` | Pending queue, oldest first, with filters and SLA age |
| POST | `/kpis/:id/review-start` | `kpi:review` | Submitted → Under Review, queues NT-06 |
| POST | `/kpis/:id/decision` | `kpi:review` | `approve` · `adjust` · `return` · `reject` · `delete` |
| POST | `/approvals/bulk-approve` | `kpi:review` | Up to 20 unadjusted requests |
| GET | `/approvals/department-heads` | `kpi:approve-head` | Department Head KPIs for the Super Admin |
| GET | `/approvals/all` | `kpi:approve-head` | Group-wide queue |
| GET | `/approvals/counts` | review permissions | Sidebar badge counts |
| GET | `/escalations` | `kpi:approve-head` | Pending escalations |
| POST | `/escalations/:id/decision` | `kpi:approve-head` | Approve or decline an escalated adjustment |
| POST | `/corrections` | approver | Raise a correction on an approved KPI |
| POST | `/corrections/:id/decision` | `kpi:approve-correction` | Approve (new version) or decline |
| GET | `/corrections` | reviewer | Correction queue |

```http
POST /api/v1/kpis/{id}/decision
{ "action": "adjust",
  "changes": { "actual": 12 },
  "overrideScore": 95,
  "reason": "Actual corrected to 12 clients after the finance extract was reconciled.",
  "rowVersion": 4 }
```
```json
{ "data": { "id": "…", "status": "ESCALATED", "escalated": true,
            "delta": "11.67", "proposedScore": "95.00",
            "message": "Δ 11.67 is outside the ±10.00 band — escalated to a Super Admin." } }
```

### 3.6 Dashboards and reports

| Method | Path | Purpose |
|---|---|---|
| GET | `/dashboard/employee?frequency=&periodId=&employeeId=` | Metric cards, the 10-column records list, three chart series |
| GET | `/dashboard/department?frequency=&periodId=&departmentId=` | Cards, leaderboard, weight-incomplete and below-target lists |
| GET | `/dashboard/group?frequency=&periodId=` | Headline, BU comparison, department heat table, escalations |
| GET | `/dashboard/drill-down?level=&businessUnitId=&departmentId=&employeeId=` | BU → Department → Employee → KPI |
| GET | `/leaderboard?frequency=&periodId=&departmentId=` | Ranked entries with RAG bars |
| GET | `/reports` | The catalogue permitted for the caller's role |
| GET | `/reports/meta/filters` · `/meta/exports/mine` | Filter sources; export history |
| GET | `/reports/:code?page=&size=&<filters>` | Paged preview with columns, rows, totals and a footer |
| POST | `/reports/:code/export` | `{ format: XLSX \| CSV \| PDF, filters }` — synchronous, or `{ async: true, exportJobId }` above 10,000 rows |
| GET | `/reports/:code/download/:jobId` | Download a completed asynchronous export |

### 3.7 Periods, configuration, templates

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET | `/periods/selectable` | any | The global period picker |
| GET | `/admin/periods` | period/dashboard | Calendar with counters and deadline state |
| POST | `/admin/periods/calendar` | `period:manage` | Generate a year (idempotent) |
| POST/PATCH | `/admin/periods` · `/:id` | `period:manage` | Create or adjust a period |
| GET | `/admin/periods/:id/outstanding` | `period:manage` | Pending, not-submitted and weight-incomplete lists |
| POST | `/admin/periods/:id/close` | `period:manage` | Locks KPIs, writes snapshots, queues NT-16 |
| POST | `/admin/periods/:id/reopen` | `period:manage` | Reason ≥ 15 characters; audited and notified |
| POST | `/admin/periods/extensions` | period/dept | Grant up to 7 days with a reason |
| GET | `/admin/configuration-versions` · `/active` | config/any | Version history; the effective parameters |
| POST | `/admin/configuration-versions` | `config:manage` | Publish a new version |
| POST | `/admin/configuration-versions/recalculate` | `config:manage` | Recalculate an open period, listing every changed KPI |
| GET | `/kpi-library/templates` · `/:id` | any | Templates visible to the caller |
| POST/PATCH | `/kpi-library/templates` · `/:id` | template/dept | Create; editing creates a new version |
| POST | `/kpi-library/templates/:id/publish` | `template:manage` | Publish or unpublish |
| POST | `/kpi-library/assignments` | `kpi:assign` | Assign with per-row capacity and duplicate conflicts |
| GET | `/kpi-library/categories` | any | Categories |

### 3.8 Notifications, audit, search, health

| Method | Path | Purpose |
|---|---|---|
| GET | `/notifications?page=&size=&unreadOnly=` | The notification centre with the unread count |
| GET | `/notifications/unread-count` | The bell badge |
| PATCH | `/notifications/read` · POST `/notifications/read-all` | Mark read |
| POST | `/notifications/preview` | Template preview (System Administrator) |
| GET | `/audit-logs?page=&size=&actorId=&action=&entityType=&from=&to=` | Filtered audit viewer (per §18 access) |
| GET | `/audit-logs/verify` | Hash-chain verification |
| GET | `/audit-logs/entity-types` | Filter values |
| GET | `/audit-logs/export` | CSV export |
| GET | `/search?q=&limit=` | Employees and KPIs within scope |
| GET | `/health` | Public liveness probe |
| GET | `/health/system` | Queues, storage, mail and job diagnostics |

---

## 4. Status codes by flow

| Flow | Success | Typical failures |
|---|---|---|
| Register | 201 | 422 domain/invalid, 429 throttled |
| Set password | 200 | 422 policy, 422 token expired/used |
| Login | 200 | 401 credentials, 423 locked, 403 inactive, 429 throttled |
| Create KPI | 201 | 409 `W-EXCEED` / `KPI-DUP` / `MAX-KPI`, 422 `V-TGT-01`, 403 `APPROVER-INVALID` |
| Submit | 200 | 422 missing fields/evidence, 409 `DEADLINE-PASSED` / `STALE-VERSION` |
| Decide | 200 | 403 `SELF-DECISION` / `OUT-OF-SCOPE`, 422 `REASON-REQUIRED`, 409 `STALE-VERSION` |
| Upload evidence | 201 | 422 `FILE-REJECTED`, 413 too large, 409 `KPI-STATUS` |
| Close period | 200 | 409 `PERIOD-PENDING-ITEMS` |
| Export | 200 | 403 out of role, 200 with `async: true` above 10,000 rows |
