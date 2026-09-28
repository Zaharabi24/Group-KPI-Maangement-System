# Business Rules — ANWAR KPIFlow

Every rule below is enforced server-side. The Chinese-wall rule of this platform
is simple: **no score is ever typed by a human**.

---

## 1. Calculation engine

### 1.1 Inputs and outputs

| Symbol | Name | Definition |
|---|---|---|
| T | Target | Numeric ≥ 0, or a rubric level for Qualitative |
| A | Actual | Numeric ≥ 0, or the achieved rubric level |
| W | KPI Weight | Integer percentage, 5–50 by default |
| DIR | Direction | `HIGHER` or `LOWER` |
| CAP / FLOOR | Score cap / floor | 120.00 and 0.00 by default, stored with the KPI's configuration version |
| ACH | Achievement % | Output: 2 dp, floored at 0, **not** capped |
| CS / FS | Calculated / Final Score | `CS = min(ACH, CAP)`; `FS` is the approved override if one exists, otherwise `CS` |
| WS | Weighted Score | `WS = round_half_up(FS × W ÷ 100, 2)` |

### 1.2 Achievement formulas

```
HIGHER, T > 0    ACH = (A ÷ T) × 100
LOWER,  T > 0    ACH = ((2 × T − A) ÷ T) × 100
LOWER,  T = 0    ACH = 100 when A = 0, otherwise 0          (zero tolerance)
HIGHER, T = 0    invalid — blocked at entry                 (V-TGT-01)
Rating           ACH = (A ÷ T) × 100, within the configured scale
Qualitative      ACH = MAP[level]  with L1=50 L2=75 L3=100 L4=110 L5=120
Then             ACH = max(round_half_up(ACH, 2), 0.00)
```

The lower-is-better formula rewards each unit below target by the same proportion
that higher-is-better rewards each unit above target. It reproduces the source
screens: a turnaround target of 5 days with an actual of 4 gives 120%, and a
complaint rate of 5 per 100 with an actual of 3 gives 140%.

### 1.3 Rounding and precision

`ROUND_HALF_UP` at every step: ACH → 2 dp, then WS → 2 dp, then totals → 2 dp.
Later steps use the rounded value from the step before, so a result can be
reproduced by hand. Arithmetic uses fixed-point decimals only — never binary
floating point.

### 1.4 Reference values (asserted by the automated tests)

| Input | ACH | CS | WS |
|---|---|---|---|
| T 15, A 17, W 20% | 113.33 | 113.33 | 22.67 |
| T 5 days, A 4 days, W 10% | 120.00 | 120.00 | 12.00 |
| T 5, A 3 per 100, W 15% | 140.00 | **120.00** | 18.00 |
| T 5, A 12, W 10% | 0.00 (floored from −40) | 0.00 | 0.00 |
| T 95%, A 90%, W 20% | 94.74 | 94.74 | 18.95 |
| T 0, A 0, W 10% | 100.00 | 100.00 | 10.00 |
| T 0, A 1, W 10% | 0.00 | 0.00 | 0.00 |
| Qualitative L4, W 10% | 110.00 | 110.00 | 11.00 |

### 1.5 Period aggregates (§4.5)

Let **S** be the employee's Approved KPIs for the frequency and period.

```
Total KPI Score       Σ WS over S                        → 0.00 – 120.00
Average Achievement   Σ(ACH × W) ÷ Σ W over S           → weighted, uncapped
Allocated Weight      Σ W excluding Rejected and Deleted→ shown as "x / 100%"
Approved KPIs         count(S) ÷ count(all except Deleted)
Previous KPI Score    the preceding period of the same frequency
Difference            current − previous, always labelled from the sign
KPI below target      count of KPI in S with ACH < 100.00
Pending evaluations   count of Submitted + Under Review + Escalated
Dept Average Achieve. mean of employees' Average Achievement where count(S) ≥ 1
Leaderboard rank      Total KPI Score desc, then Average Achievement desc; ties share a rank
RAG                   Green ≥ 95.00 · Amber 75.00–94.99 · Red < 75.00
```

The difference label is **always derived from the sign**: `78 − 75` renders as
"▲ 3.00 above previous period", correcting the source example's
"Below the Previous Month".

---

## 2. Weight rules

| Rule | Behaviour |
|---|---|
| W-1 | Weight is an integer percentage from 5 to 50 per KPI (configurable) |
| W-2 | Allocated weight = the sum of the employee's KPI weights for one frequency and period, excluding Rejected and Deleted. Any save that would exceed 100% is blocked with `Weight exceeds 100% by X%. Available: Y%` |
| W-3 | Below 100% is allowed while the period is open, with a visible warning on the form, the employee summary and the department dashboard |
| W-4 | Unallocated weight is **not** normalised — it contributes 0, so a KPI's value always equals its declared importance |
| W-5 | An approver may change a weight during review, with a reason, within the 100% limit; the change appears in the Adjustment History |
| W-6 | Maximum 10 active KPIs per employee, period and frequency (configurable) |

Rejecting or deleting a KPI releases its weight immediately, which is what allows
a replacement to be created inside the resubmission window.

---

## 3. Validation catalogue

| Condition | Code | System behaviour |
|---|---|---|
| Zero target, higher is better | `V-TGT-01` | Blocked: "Target must be greater than 0" |
| Zero target, lower is better | — | Allowed; the zero-tolerance rule applies |
| Negative value | `V-NUM-02` | Blocked — Phase 01 does not support negatives |
| Too many decimal places for the measurement type | `V-NUM-02` | Blocked with the allowed precision |
| Actual above 1,000% | `V-NUM-02` | Blocked |
| Rating target outside the scale | `V-NUM-02` | Blocked |
| Missing target or actual | `V-MISSING` | Submission blocked; the card shows "Actual required" |
| Remarks shorter than 10 characters | `V-TEXT-01` | Submission blocked |
| No evidence | `EVIDENCE-REQUIRED` | Submission blocked |
| Evidence failed the scan | `FILE-REJECTED` | Blocked; a replacement is required |
| Duplicate KPI name for the employee and period | `KPI-DUP` | Blocked |
| Weight total above 100% | `W-EXCEED` | Blocked with the available weight |
| More than the maximum KPIs | `MAX-KPI` | Blocked |
| Period closed | `PERIOD-CLOSED` | Blocked; a Super Admin must reopen |
| Submission deadline passed | `DEADLINE-PASSED` | Blocked; the extension route is offered |
| Approver not an active Department Head of the employee's department | `APPROVER-INVALID` | Blocked |
| No approver configured for the department | `APPROVER-REQUIRED` | Blocked with guidance |
| Approver is the owner | `SELF-DECISION` | Blocked (403) |
| Record changed since it was opened | `STALE-VERSION` | Blocked: "Reload to continue" |
| Reason shorter than 15 characters | `REASON-REQUIRED` | The action stays disabled |
| Reject without a category | `V-MISSING` | The action stays disabled |
| File type, size or scan failure | `FILE-REJECTED` | Rejected with the reason |
| Period close with pending items | `PERIOD-PENDING-ITEMS` | Blocked; the outstanding list is shown |
| Correction on a non-approved KPI | `KPI-STATUS` | Blocked — edit it directly instead |

---

## 4. Workflow rules

### 4.1 Editable by status

| Status | Owner | Approver | Super Admin |
|---|---|---|---|
| Draft | Full edit, delete | — | Full edit |
| Submitted | Withdraw only | Open (→ Under Review) | Full edit |
| Under Review | — | Edit with a reason, decide | Full edit |
| Returned | Edit and resubmit (version +1) | Decide | Full edit |
| Escalated | — | — | Approve or decline the adjustment |
| Approved | — | Request a correction | Correction flow only |
| Rejected | — | — | Restore, then edit |
| Not Submitted | Extension only (Department Head or Super Admin) | — | Extension, reopen |
| Deleted | — | — | Restore as a Draft |

### 4.2 Deadlines and windows (§3.5)

- Submission deadline = period end + 7 calendar days of grace.
- A KPI can be created from the first day of its period until the deadline.
- Resubmission window = the later of the deadline and 3 working days after a return.
- Review window = the submission deadline + 7 calendar days; the SLA is 5 working days.
- Working week: **Saturday–Thursday**, Friday is the weekly holiday.
- A period closes after the review window; closing locks every KPI in it.
- The card shows "N days remaining", "Due today", or an overdue state.

### 4.3 Superseded weight on rejection

A Rejected KPI is terminal and its weight is released. A replacement may be created
within the resubmission window. Any unreplaced weight scores 0.

---

## 5. Adjustments and escalation (ADJ-1 … ADJ-5)

| Rule | Behaviour |
|---|---|
| ADJ-1 | An approver may (a) correct an input — target, actual, weight, rubric level, evidence — or (b) override the final score from 0.00 to 120.00. Both require a reason of at least 15 characters |
| ADJ-2 | Band test on every approval, including "Approve calculated" after an input edit: `Δ = |FS at approval − CS as submitted|`. `Δ ≤ 10.00` means the adjustment **is** the approval; `Δ > 10.00` moves the KPI to Escalated and requires a Super Admin |
| ADJ-3 | Weight-only changes do not change FS and are not band-tested, but must respect W-1 and W-2 |
| ADJ-4 | The employee sees every adjustment in the Adjustment History: field, old value, new value, actor, time, reason. The calculation path separately shows Calculated Score and Final Score |
| ADJ-5 | Worked examples: CS 83.33 → 90.00 (Δ 6.67) is approved directly; CS 83.33 → 95.00 (Δ 11.67) escalates; an actual corrected from 10 to 12 clients gives CS 100.00 (Δ 16.67) and escalates |

**Declining an escalation** returns the KPI to Under Review with the adjustment
reversed and the calculated score restored.

---

## 6. Evidence rules

| Rule | Behaviour |
|---|---|
| Count and size | 1–5 files, ≤ 10 MB each |
| Allowed types | PDF, JPG, PNG, XLSX, XLS, CSV, DOCX |
| Always refused | Macro-enabled Office files (`.docm`, `.xlsm`, `.pptm`), executables, scripts, archives, the EICAR test file |
| Verification | The MIME type is determined from the file **content** (magic bytes), never from the extension |
| Hashing | SHA-256 is computed and stored for every file |
| At rest | AES-256-GCM under a random object key |
| Immutability | Evidence cannot change after submission; replacing it while Returned creates a new file version and keeps the old one |
| Download | A 5-minute signed URL; every download is audited |
| Preview | PDF and images may be previewed inline; everything else downloads |

---

## 7. Period and configuration rules

| Rule | Behaviour |
|---|---|
| Calendar | Generated per frequency: 12 monthly, 4 quarterly, 1 yearly, with a unique key on `(frequency, startDate)` |
| Close | Blocked while any Submitted, Under Review or Escalated KPI exists; outstanding items are listed |
| On close | Every KPI is locked and a `performance_snapshot` is written per employee (total, average, allocated weight, approved count, RAG, rank, previous, difference) |
| Reopen | Reason ≥ 15 characters; audited and notified; only non-approved rows are unlocked |
| Reports | Closed periods read snapshots; open periods read live approved data |
| No retroactive configuration | Each KPI stores the configuration version current at creation; publishing a new version affects only periods opened afterwards |
| Recalculate | A Super Admin may explicitly recalculate an open period with the current configuration, with a reason; every changed KPI is listed and audited |
| Extensions | Up to 7 days, with a reason, granted by the Department Head or a Super Admin; a Not Submitted KPI returns to Draft so the employee can finish |

---

## 8. Data-scope and segregation rules

- Scope is `(role, department | null for group)`. A Department Head assigned to
  several departments sees the union.
- A department scope is **not** widened by the business unit — otherwise a Head
  could see a peer department's request that they are not allowed to decide.
- No user may decide on their own KPI: the approver drop-down never lists the
  requester, the queue excludes own records, and the API rejects it with 403.
- A Department Head's own KPI is routed to the Super Admin queue.
- An out-of-scope record returns 403 and the attempt is written to the audit log.
- A System Administrator has no KPI access; every attempt is refused and logged.
- Employee transfers keep approved KPIs on their original organisation snapshot;
  Drafts move to the new department and the approver is reselected.

---

## 9. Notification rules

Every event creates an in-app notification and, where the channel says so, an
e-mail delivered through the queue with retries after 1, 5 and 15 minutes.

Critical events can never be switched off: password reset or lockout, a returned
KPI, a rejected KPI, a deleted KPI, an escalated adjustment, an escalation
decision, and a closed period. All other e-mails may be switched to a daily digest.

E-mails deep-link to the record and never contain evidence files or passwords.

---

## 10. Audit rules

Captured for every record: actor id and role, action, entity type and id, changed
fields with previous and new values, reason, UTC timestamp, IP address, user agent,
correlation ID, previous hash and record hash.

Auditable actions include registration, activation, every login attempt, lockout,
password reset and change, logout and refresh anomalies; invitations, role grants
and revocations, transfers, deactivation, delegation and admin profile changes;
KPI create, edit, submit, withdraw, delete, evidence upload/replace/download and
version restore; review start, approve, adjust (per field), return, reject,
escalate, escalation decision, correction request and decision, extension;
every calculation run, override, period recalculation and configuration
publication; period open, close, reopen and snapshot generation; every report view
and export; every 403 denial; break-glass access; and every view of the audit log
itself.

Access: Super Admin sees everything; HR Admin read-only excluding system-setting
events; a Department Head read-only for their department; an employee sees their own
history through the KPI views; a System Administrator sees technical logs only.

The application role has insert-only rights on `audit_log` at the application
layer — the service exposes no update or delete path — and a weekly job verifies
the hash chain, alerting on any gap or mismatch.
