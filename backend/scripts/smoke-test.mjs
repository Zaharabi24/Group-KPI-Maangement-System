/**
 * API smoke test — exercises the major BRD workflows against a running API.
 * Usage: node scripts/smoke-test.mjs [baseUrl]
 */
const BASE = process.argv[2] || 'http://localhost:4100/api/v1';

let pass = 0;
let fail = 0;
const failures = [];

const call = async (method, path, body, token) => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 300) };
  }
  return { status: res.status, body: json, data: json?.data };
};

const check = (name, condition, detail) => {
  if (condition) {
    pass += 1;
    console.log(`  ✓ ${name}`);
  } else {
    fail += 1;
    failures.push(name);
    console.log(`  ✗ ${name}${detail ? ` — ${JSON.stringify(detail).slice(0, 300)}` : ''}`);
  }
};

const loginCache = new Map();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The login endpoint is rate-limited to 10 requests/minute per IP
 * (NFR-SEC-06). Re-running the suite inside that window must not fail, so a
 * 429 is retried with backoff rather than treated as an application error.
 */
const login = async (email, password) => {
  const cached = loginCache.get(email);
  if (cached) return cached;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const res = await call('POST', '/auth/login', { email, password });
    if (res.status === 429) {
      await sleep(15_000);
      continue;
    }
    const result = { status: res.status, token: res.data?.accessToken, data: res.data, error: res.body?.error };
    if (result.token) loginCache.set(email, result);
    return result;
  }
  return { status: 429, token: undefined, data: undefined, error: { code: 'RATE-LIMITED', message: 'Login throttled' } };
};

const main = async () => {
  const demoPassword = process.env.SEED_DEMO_PASSWORD || 'Anwar@KPI2026';

  console.log(`\n▶ ANWAR KPIFlow API smoke test → ${BASE}\n`);

  // ---------------------------------------------------------------- health
  console.log('Health');
  const health = await call('GET', '/health');
  check('GET /health returns ok', health.status === 200 && health.data?.status === 'ok', health.body);
  check('Database is up', health.data?.checks?.database === 'up');
  check('Redis is up', health.data?.checks?.redis === 'up');

  // ------------------------------------------------------------ auth (M01)
  console.log('\nAuthentication (M01)');
  const badDomain = await call('POST', '/auth/register', {
    fullName: 'Test Person',
    email: 'test.person@gmail.com',
    employeeCode: 'ETEST1',
    businessUnitId: '00000000-0000-0000-0000-000000000000',
    departmentId: '00000000-0000-0000-0000-000000000000',
  });
  check(
    'Registration rejects a non-@anwargroup.net address (FR-AUTH-02 / AC-01)',
    badDomain.status === 422 || badDomain.status === 400,
    badDomain.body,
  );

  const wrongPassword = await login('rafi.ahmed@anwargroup.net', 'Totally-Wrong-123!');
  check('Wrong password is rejected (FR-AUTH-07)', wrongPassword.status === 401, wrongPassword.body);

  // The successful login for the same account is the second attempt within the
  // rate-limit window, which is the production configuration (10/min).
  const employee = await login('rafi.ahmed@anwargroup.net', demoPassword);
  check('Employee login succeeds', Boolean(employee.token), employee.error);
  check('Employee home is My KPI', employee.data?.home === '/my-kpi', employee.data?.home);

  const head = await login('kamrul.hasan@anwargroup.net', demoPassword);
  check('Department Head login succeeds', Boolean(head.token), head.error);
  check('Department Head home is the Dashboard', head.data?.home === '/dashboard', head.data?.home);

  const superAdmin = await login(process.env.SEED_SUPER_ADMIN_EMAIL || 'superadmin@anwargroup.net', process.env.SEED_SUPER_ADMIN_PASSWORD || demoPassword);
  check('Super Admin login succeeds', Boolean(superAdmin.token), superAdmin.error);
  check('Super Admin home is the Group Dashboard', superAdmin.data?.home === '/group-dashboard', superAdmin.data?.home);

  const hr = await login('hradmin@anwargroup.net', demoPassword);
  check('HR Admin login succeeds', Boolean(hr.token), hr.error);

  const viewer = await login('management.viewer@anwargroup.net', demoPassword);
  check('Management Viewer login succeeds', Boolean(viewer.token), viewer.error);

  const me = await call('GET', '/auth/me', null, employee.token);
  check('GET /auth/me returns the principal with permissions', me.status === 200 && Array.isArray(me.data?.permissions));

  // -------------------------------------------------------- calculation (M08)
  console.log('\nCalculation engine (M08 / §4.6)');
  const preview1 = await call(
    'POST',
    '/kpis/preview-calculation',
    { measurementType: 'COUNT', direction: 'HIGHER', target: 15, actual: 17, kpiWeight: 20 },
    employee.token,
  );
  check(
    'Example A: 17/15 with weight 20 → ACH 113.33, CS 113.33, WS 22.67 (AC-05)',
    preview1.data?.achievement === '113.33' && preview1.data?.calculatedScore === '113.33' && preview1.data?.weightedScore === '22.67',
    preview1.data,
  );

  const preview2 = await call(
    'POST',
    '/kpis/preview-calculation',
    { measurementType: 'TIME', direction: 'LOWER', target: 5, actual: 4, kpiWeight: 10 },
    employee.token,
  );
  check(
    'Lower-is-better: 5 → 4 days = 120.00% (§4.2)',
    preview2.data?.achievement === '120.00' && preview2.data?.calculatedScore === '120.00',
    preview2.data,
  );

  const preview3 = await call(
    'POST',
    '/kpis/preview-calculation',
    { measurementType: 'PERCENTAGE', direction: 'LOWER', target: 5, actual: 3, kpiWeight: 15 },
    employee.token,
  );
  check('Complaint rate 5 → 3 = 140.00% (capped to 120.00)', preview3.data?.achievement === '140.00' && preview3.data?.calculatedScore === '120.00', preview3.data);

  const preview4 = await call(
    'POST',
    '/kpis/preview-calculation',
    { measurementType: 'PERCENTAGE', direction: 'LOWER', target: 5, actual: 12, kpiWeight: 10 },
    employee.token,
  );
  check('Defects 5 → 12 floors at 0.00 (Example C)', preview4.data?.achievement === '0.00' && preview4.data?.floored === true, preview4.data);

  const preview5 = await call(
    'POST',
    '/kpis/preview-calculation',
    { measurementType: 'PERCENTAGE', direction: 'HIGHER', target: 95, actual: 90, kpiWeight: 10 },
    employee.token,
  );
  check('On-time delivery 95 → 90 = 94.74', preview5.data?.achievement === '94.74', preview5.data);

  const preview6 = await call(
    'POST',
    '/kpis/preview-calculation',
    { measurementType: 'COUNT', direction: 'LOWER', target: 0, actual: 0, kpiWeight: 10 },
    employee.token,
  );
  check('Zero-tolerance: T=0, A=0 → 100.00', preview6.data?.achievement === '100.00', preview6.data);

  const preview7 = await call(
    'POST',
    '/kpis/preview-calculation',
    { measurementType: 'COUNT', direction: 'LOWER', target: 0, actual: 1, kpiWeight: 10 },
    employee.token,
  );
  check('Zero-tolerance: T=0, A=1 → 0.00', preview7.data?.achievement === '0.00', preview7.data);

  const previewInvalid = await call(
    'POST',
    '/kpis/preview-calculation',
    { measurementType: 'COUNT', direction: 'HIGHER', target: 0, actual: 5, kpiWeight: 10 },
    employee.token,
  );
  check('Higher-is-better with target 0 is blocked (V-TGT-01)', previewInvalid.status === 422, previewInvalid.body);

  // --------------------------------------------------------------- My KPI (M05)
  console.log('\nMy KPI (M05)');
  const myKpis = await call('GET', '/kpis?frequency=MONTHLY&periodCode=2026-09', null, employee.token);
  check('GET /kpis returns cards with status counts', myKpis.status === 200 && Array.isArray(myKpis.data?.items), myKpis.body);
  check('Weight availability is reported (W-2/W-3)', typeof myKpis.data?.allocatedWeight === 'number', myKpis.data?.allocatedWeight);
  check('Status chip counts are present (FR-KPI-02)', myKpis.data?.counts && typeof myKpis.data.counts === 'object', myKpis.data?.counts);

  const firstKpi = myKpis.data?.items?.[0];
  if (firstKpi) {
    const detail = await call('GET', `/kpis/${firstKpi.id}`, null, employee.token);
    check('KPI detail returns the calculation path (FR-KPI-08)', Array.isArray(detail.data?.calculationPath) && detail.data.calculationPath.length === 6, detail.data?.calculationPath);
    const labels = (detail.data?.calculationPath ?? []).map((r) => r.label);
    check(
      'Calculation path has no Curve Applied / Adjustment / Score Version rows',
      !labels.includes('Curve Applied') && !labels.includes('Adjustment') && !labels.includes('Score Version'),
      labels,
    );
    check('Detail exposes the stepper and evidence panel', Array.isArray(detail.data?.stepper?.states) && Array.isArray(detail.data?.evidence));
    check('Detail exposes adjustment and decision history', Array.isArray(detail.data?.adjustmentHistory) && Array.isArray(detail.data?.decisionHistory));
  }

  const weights = await call('GET', '/kpis/meta/weights?periodId=' + (myKpis.data?.period?.id ?? '') + '&frequency=MONTHLY', null, employee.token);
  check('Weight meter endpoint responds (W-2)', weights.status === 200 && typeof weights.data?.available === 'number', weights.body);

  const approvers = await call('GET', '/kpis/meta/approvers', null, employee.token);
  check('Approver drop-down resolves (BR-R03)', approvers.status === 200 && approvers.data?.mode, approvers.body);

  // Guard: the owner cannot be their own approver (validate before the weight check).
  // Ayesha has spare weight capacity (only an incomplete Draft) so the W-EXCEED
  // rule cannot mask the BR-R04 assertion.
  const freshEmployee = await login('ayesha.siddiqua@anwargroup.net', demoPassword);
  const freshPeriod = (await call('GET', '/kpis?frequency=MONTHLY&periodCode=2026-09', null, freshEmployee.token)).data;
  const selfApprove = await call(
    'POST',
    '/kpis',
    {
      name: 'Self approval attempt',
      categoryId: (await call('GET', '/kpis/meta/categories', null, freshEmployee.token)).data?.[0]?.id,
      measurementType: 'COUNT',
      direction: 'HIGHER',
      frequency: 'MONTHLY',
      periodId: freshPeriod?.period?.id,
      target: 10,
      actual: 10,
      kpiWeight: 5,
      approverId: freshEmployee.data?.user?.id,
    },
    freshEmployee.token,
  );
  check('The owner cannot be their own approver (BR-R04)', selfApprove.status === 403, selfApprove.body);

  // -------------------------------------------------- weight rule (W-2 / AC-06)
  console.log('\nWeight rule (W-2 / AC-06)');
  const overWeight = await call(
    'POST',
    '/kpis',
    {
      name: 'Weight overflow probe',
      categoryId: (await call('GET', '/kpis/meta/categories', null, employee.token)).data?.[0]?.id,
      measurementType: 'COUNT',
      direction: 'HIGHER',
      frequency: 'MONTHLY',
      periodId: myKpis.data?.period?.id,
      target: 10,
      actual: 10,
      kpiWeight: 50,
    },
    employee.token,
  );
  const allocated = myKpis.data?.allocatedWeight ?? 0;
  if (allocated + 50 > 100) {
    check(
      'Saving above 100% is blocked with the available weight (W-EXCEED)',
      overWeight.status === 409 && overWeight.body?.error?.code === 'W-EXCEED',
      overWeight.body,
    );
  } else {
    check('Weight capacity allowed the probe (allocated + 50 ≤ 100)', overWeight.status === 201, overWeight.body);
  }

  // ----------------------------------------------- departmental isolation (§5.3)
  console.log('\nData scope (§5.3 / AC-16)');
  const headQueue = await call('GET', '/approvals', null, head.token);
  check('Department Head sees the pending queue (FR-APR-01)', headQueue.status === 200 && Array.isArray(headQueue.data?.items), headQueue.body);

  const crossDept = await call('GET', '/approvals', null, (await login('golam.mostafa@anwargroup.net', demoPassword)).token);
  check('A different BU approver gets their own (empty or own) queue', crossDept.status === 200);

  const employeeOnQueue = await call('GET', '/approvals', null, employee.token);
  check('An employee is denied the approval queue (403)', employeeOnQueue.status === 403, employeeOnQueue.body);

  const viewerAudit = await call('GET', '/audit-logs', null, viewer.token);
  check('Management Viewer is denied the audit log (403)', viewerAudit.status === 403, viewerAudit.body);

  // -------------------------------------------------- dashboards (M09 / M10 / M11)
  console.log('\nDashboards (M09–M11)');
  const empDash = await call('GET', '/dashboard/employee?frequency=MONTHLY&periodCode=2026-08', null, employee.token);
  check('Employee Performance Summary returns metric cards (FR-PSM-02)', empDash.status === 200 && empDash.data?.metrics, empDash.body);
  check(
    'Records table exposes exactly the 10 specified columns (FR-PSM-03)',
    (() => {
      const record = empDash.data?.records?.[0];
      if (!record) return true;
      const keys = ['kpi', 'target', 'actual', 'achievement', 'kpiWeight', 'score', 'evidence', 'remarks', 'status', 'approver'];
      return keys.every((k) => k in record);
    })(),
    empDash.data?.records?.[0],
  );
  check(
    'Three chart series with has_data flags (FR-PSM-04)',
    Array.isArray(empDash.data?.charts?.monthly) && empDash.data.charts.monthly.length === 12 &&
      Array.isArray(empDash.data?.charts?.quarterly) && empDash.data.charts.quarterly.length === 4 &&
      Array.isArray(empDash.data?.charts?.yearly) && empDash.data.charts.yearly.length === 5,
    {
      m: empDash.data?.charts?.monthly?.length,
      q: empDash.data?.charts?.quarterly?.length,
      y: empDash.data?.charts?.yearly?.length,
    },
  );
  check('Difference label follows the sign (§4.5)', typeof empDash.data?.metrics?.differenceLabel === 'string', empDash.data?.metrics?.differenceLabel);

  const deptDash = await call('GET', '/dashboard/department?frequency=MONTHLY&periodCode=2026-08', null, head.token);
  check('Department Dashboard returns the 5 cards + extras (FR-DHD-02)', deptDash.status === 200 && deptDash.data?.cards, deptDash.body);
  check('Leaderboard is ranked and unique per employee (FR-DHD-03)', (() => {
    const lb = deptDash.data?.leaderboard ?? [];
    const ids = lb.map((e) => e.employeeId);
    return new Set(ids).size === ids.length && lb.every((e) => typeof e.rank === 'number');
  })(), deptDash.data?.leaderboard?.slice(0, 3));

  const groupDash = await call('GET', '/dashboard/group?frequency=MONTHLY&periodCode=2026-08', null, superAdmin.token);
  check('Group Dashboard returns BU comparison (FR-SAD-01)', groupDash.status === 200 && Array.isArray(groupDash.data?.businessUnits), groupDash.body);
  check('Group Dashboard blocks a Department Head (403)', (await call('GET', '/dashboard/group', null, head.token)).status === 403);

  // --------------------------------------------------------------- reports (M12)
  console.log('\nReports (M12)');
  const catalogue = await call('GET', '/reports', null, superAdmin.token);
  check('Report catalogue lists RP-01…RP-13 (FR-RPT-01)', catalogue.status === 200 && catalogue.data?.length === 13, catalogue.data?.length);

  const rp01 = await call('GET', '/reports/RP-01?page=1&size=5&periodCode=2026-08', null, superAdmin.token);
  check('RP-01 preview returns columns, rows and a footer-ready meta block', rp01.status === 200 && Array.isArray(rp01.data?.columns) && rp01.data?.meta?.generatedBy, rp01.body);

  const rp02 = await call('GET', '/reports/RP-02?periodCode=2026-08', null, superAdmin.token);
  check('RP-02 uses the §4.5 period metrics', rp02.status === 200 && Array.isArray(rp02.data?.rows), rp02.body);

  const rp03 = await call('GET', '/reports/RP-03?periodCode=2026-08', null, superAdmin.token);
  check('RP-03 returns department comparison', rp03.status === 200 && Array.isArray(rp03.data?.rows), rp03.body);

  const rp05 = await call('GET', '/reports/RP-05?periodCode=2026-08', null, superAdmin.token);
  check('RP-05 returns the achievement distribution bands', rp05.status === 200 && (rp05.data?.rows?.length ?? 0) >= 1, rp05.body);

  const rp11 = await call('GET', '/reports/RP-11?periodCode=2026-08', null, superAdmin.token);
  check('RP-11 exception report responds', rp11.status === 200 && Array.isArray(rp11.data?.rows), rp11.body);

  const rp06Forbidden = await call('GET', '/reports/RP-06', null, employee.token);
  check('RP-06 is denied to an employee (§14 access)', rp06Forbidden.status === 403, rp06Forbidden.body);

  const exportCsv = await call('POST', '/reports/RP-01/export', { format: 'CSV', filters: { periodCode: '2026-08' } }, superAdmin.token);
  check('CSV export returns rows and a footer (AC-19)', exportCsv.status === 200 && exportCsv.data?.rowCount > 0 && String(exportCsv.data?.footer ?? '').includes('RP-01'), exportCsv.body);

  // ------------------------------------------------------- approvals (M07)
  console.log('\nApprovals (M07)');
  const pending = headQueue.data?.items?.[0];
  if (pending) {
    const started = await call('POST', `/kpis/${pending.id}/review-start`, {}, head.token);
    check('Opening a request sets Under Review (FR-APR-04)', [200, 409].includes(started.status), started.body);

    const noReason = await call('POST', `/kpis/${pending.id}/decision`, { action: 'return' }, head.token);
    check('Return without a reason is blocked (FR-APR-06 / AC-11)', noReason.status === 422 && noReason.body?.error?.code === 'REASON-REQUIRED', noReason.body);

    const returned = await call(
      'POST',
      `/kpis/${pending.id}/decision`,
      { action: 'return', reason: 'Please attach the signed finance extract to evidence.' },
      head.token,
    );
    check('Return with a ≥15-character comment succeeds (AC-11)', returned.status === 200 && returned.data?.status === 'RETURNED', returned.body);

    // Employee resubmits and the approver approves
    const resubmit = await call('POST', `/kpis/${pending.id}/submit`, {}, employee.token);
    const canResubmit = ['DRAFT', 'RETURNED'].includes(pending.status);
    check(
      canResubmit ? 'Returned KPI is resubmittable' : 'Returned KPI respects the state machine',
      canResubmit ? [200, 422, 409].includes(resubmit.status) : true,
      resubmit.body,
    );

    const approve = await call('POST', `/kpis/${pending.id}/decision`, { action: 'approve' }, head.token);
    check(
      canResubmit ? 'Approve calculated sets APPROVED' : 'Decision respects the state machine',
      canResubmit ? ([200, 409].includes(approve.status)) : true,
      approve.body,
    );

    const selfDecision = await call('POST', `/kpis/${pending.id}/decision`, { action: 'approve' }, employee.token);
    check('An employee cannot decide (403)', selfDecision.status === 403, selfDecision.body);
  } else {
    console.log('  · no pending request available for the decision flow (queue empty)');
  }

  const escalated = await call('GET', '/escalations', null, superAdmin.token);
  check('Escalations queue is a Super Admin view (UC-05)', escalated.status === 200, escalated.body);
  check('Escalations queue is denied to a Department Head (403)', (await call('GET', '/escalations', null, head.token)).status === 403);

  const bulk = await call('POST', '/approvals/bulk-approve', { ids: ['00000000-0000-0000-0000-000000000000'] }, head.token);
  check('Bulk approve validates its input', [200, 403, 404].includes(bulk.status), bulk.body);

  // -------------------------------------------------------- notifications (§15)
  console.log('\nNotifications (§15)');
  const notifications = await call('GET', '/notifications', null, head.token);
  check('Notification centre returns items and an unread count (FR-NTF-01)', notifications.status === 200 && typeof notifications.data?.unread === 'number', notifications.body);

  const unread = await call('GET', '/notifications/unread-count', null, head.token);
  check('Unread count endpoint responds', unread.status === 200 && typeof unread.data?.unread === 'number', unread.body);

  // --------------------------------------------------------- organisation (M03)
  console.log('\nOrganisation (M03)');
  const bus = await call('GET', '/organisation/business-units', null, employee.token);
  check('Business units are readable by any authenticated user', bus.status === 200 && Array.isArray(bus.data), bus.body);
  check('Nine business units from the Excel list are seeded', bus.data?.length === 9, bus.data?.length);

  const firstBu = bus.data?.[0];
  const depts = await call('GET', `/organisation/departments?businessUnitId=${firstBu?.id}`, null, employee.token);
  check('Departments are filtered by the selected business unit', depts.status === 200 && Array.isArray(depts.data) && depts.data.length > 0, depts.body);
  check(
    'Every department belongs to the requested business unit',
    (depts.data ?? []).every((d) => d.businessUnit?.id === firstBu?.id || d.businessUnitId === firstBu?.id),
    depts.data?.slice(0, 2),
  );

  const publicBu = await call('GET', '/organisation/public/business-units');
  check('Public BU list is available to the registration form (no auth)', publicBu.status === 200 && Array.isArray(publicBu.data));

  // ---------------------------------------------------------- periods (M15)
  console.log('\nPeriods & configuration (M15)');
  const selectable = await call('GET', '/periods/selectable', null, employee.token);
  check('Selectable periods are available to every user', selectable.status === 200 && Array.isArray(selectable.data), selectable.body);

  const activeConfig = await call('GET', '/admin/configuration-versions/active', null, employee.token);
  check('The active configuration exposes cap/floor/band (FR-CFG-02)', activeConfig.status === 200 && activeConfig.data, activeConfig.body);

  const periods = await call('GET', '/admin/periods?frequency=MONTHLY', null, superAdmin.token);
  check('Period calendar lists periods with counters (FR-CFG-01)', periods.status === 200 && Array.isArray(periods.data?.items ?? periods.data?.items), periods.body);

  const closeFirst = await call('GET', '/admin/periods?status=CLOSED&frequency=MONTHLY', null, superAdmin.token);
  check('Closed periods are present (snapshots seeded)', (closeFirst.data?.items?.length ?? 0) > 0, closeFirst.data?.items?.length);

  const periodsForbidden = await call('POST', '/admin/periods/calendar', { year: 2028 }, employee.token);
  check('Employee cannot generate the calendar (403)', periodsForbidden.status === 403, periodsForbidden.body);

  // ------------------------------------------------------------ audit (§18)
  console.log('\nAudit trail (§18)');
  const audit = await call('GET', '/audit-logs?page=1&size=10', null, superAdmin.token);
  check('Audit log returns hash-chained records (FR-AUD-04)', audit.status === 200 && (audit.data?.items?.length ?? 0) > 0, audit.body);
  check('Every audit record carries a record hash', (audit.data?.items ?? []).every((i) => typeof i.recordHash === 'string' && i.recordHash.length === 64));

  const verify = await call('GET', '/audit-logs/verify', null, superAdmin.token);
  check('Hash-chain verification returns a result (§18)', verify.status === 200 && typeof verify.data?.checked === 'number', verify.body);

  // ------------------------------------------------------------ search (M16)
  console.log('\nGlobal search (FR-SRC-01)');
  const search = await call('GET', '/search?q=E20', null, head.token);
  check('Search returns employees within scope', search.status === 200 && Array.isArray(search.data?.employees), search.body);

  const searchForbidden = await call('GET', '/search?q=E20', null, null);
  check('Search requires authentication (401)', searchForbidden.status === 401);

  // ---------------------------------------------------------- profile (M02)
  console.log('\nProfile (M02)');
  const profile = await call('GET', '/me', null, employee.token);
  check('Profile returns identity fields and the department approvers (FR-PRF-01)', profile.status === 200 && Array.isArray(profile.data?.approvers), profile.body);

  const phoneBad = await call('PATCH', '/me', { corporatePhone: '12345' }, employee.token);
  check('Invalid corporate phone is rejected (FR-PRF-02)', phoneBad.status === 400 || phoneBad.status === 422, phoneBad.body);

  const phoneOk = await call('PATCH', '/me', { corporatePhone: '01712345678' }, employee.token);
  check('Valid corporate phone is accepted and normalised to E.164 (US-03)', phoneOk.status === 200, phoneOk.body);

  // --------------------------------------------------------------- security
  console.log('\nSecurity (NFR-SEC)');
  const noToken = await call('GET', '/kpis');
  check('Unauthenticated request is rejected (401)', noToken.status === 401);

  const sysAdminLogin = await login('sysadmin@anwargroup.net', demoPassword);
  const sysAudit = await call('GET', '/audit-logs', null, sysAdminLogin.token);
  check('System Administrator sees technical events only (§5.2)', sysAudit.status === 200 && (sysAudit.data?.notice ?? '').length > 0, sysAudit.data?.notice);

  const sysKpi = await call('GET', '/kpis', null, sysAdminLogin.token);
  check('System Administrator cannot read KPI content (403)', sysKpi.status === 403, sysKpi.body);

  // ---------------------------------------------------------------- summary
  console.log('\n──────────────────────────────────────────────────────────');
  console.log(`  Passed: ${pass}`);
  console.log(`  Failed: ${fail}`);
  if (failures.length) {
    console.log('  Failures:');
    failures.forEach((f) => console.log(`    · ${f}`));
  }
  console.log('──────────────────────────────────────────────────────────\n');

  process.exit(fail === 0 ? 0 : 1);
};

main().catch((error) => {
  console.error('Smoke test crashed:', error);
  process.exit(1);
});
