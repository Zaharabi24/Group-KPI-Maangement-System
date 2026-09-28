/**
 * Evidence end-to-end check: signed URL issuance, download, hash verification
 * and the 5-minute expiry contract (FR-EVD-02/04, AC-07).
 * Usage: node scripts/evidence-check.mjs [baseUrl]
 */
const BASE = process.argv[2] || 'http://localhost:4100/api/v1';
const PASSWORD = process.env.SEED_DEMO_PASSWORD || 'Anwar@KPI2026';

const call = async (method, path, body, token) => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  return { status: res.status, data: json?.data, body: json };
};

let pass = 0;
let fail = 0;
const check = (name, ok, detail) => {
  if (ok) {
    pass += 1;
    console.log(`  ✓ ${name}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${name}${detail ? ` — ${JSON.stringify(detail).slice(0, 300)}` : ''}`);
  }
};

const main = async () => {
  console.log(`\n▶ Evidence end-to-end check → ${BASE}\n`);

  const login = await call('POST', '/auth/login', { email: 'rafi.ahmed@anwargroup.net', password: PASSWORD });
  const token = login.data?.accessToken;
  check('Signed in as the demo employee', Boolean(token), login.body);

  const list = await call('GET', '/kpis?frequency=MONTHLY&periodCode=2026-09', null, token);
  const kpi = (list.data?.items ?? []).find((k) => k.evidenceCount > 0);
  check('A KPI with evidence exists', Boolean(kpi), (list.data?.items ?? []).length);

  if (!kpi) {
    process.exit(1);
  }

  const detail = await call('GET', `/kpis/${kpi.id}`, null, token);
  const evidence = detail.data?.evidence?.[0];
  check('KPI detail exposes the evidence with a SHA-256', Boolean(evidence?.sha256), detail.data?.evidence);
  check('SHA-256 is a 64-character hex digest', /^[0-9a-f]{64}$/.test(evidence?.sha256 ?? ''), evidence?.sha256);

  const url = await call('GET', `/evidence/${evidence.id}/url`, null, token);
  check('A signed, time-limited download URL is issued (FR-EVD-04)', Boolean(url.data?.url), url.body);
  check('The link expires in 300 seconds', url.data?.ttlSeconds === 300, url.data?.ttlSeconds);

  // Download through the signed URL (no bearer token — the signature authorises it)
  const absolute = url.data.url.startsWith('http') ? url.data.url : `http://localhost:4100${url.data.url}`;
  const download = await fetch(absolute);
  check('The signed URL downloads the file', download.status === 200, download.status);
  const buffer = Buffer.from(await download.arrayBuffer());
  const digest = (await import('node:crypto')).createHash('sha256').update(buffer).digest('hex');
  check('The downloaded bytes match the stored SHA-256 (tamper-evident)', digest === evidence.sha256, {
    stored: evidence.sha256,
    downloaded: digest,
  });

  // A tampered signature must be rejected
  const tampered = await fetch(`${absolute.slice(0, absolute.lastIndexOf('token=') + 6)}deadbeef.123`);
  check('A tampered signature is rejected (403)', tampered.status === 403, tampered.status);

  // An expired signature must be rejected
  const forged = await fetch(`${absolute.slice(0, absolute.lastIndexOf('token=') + 6)}1.abc`);
  check('An expired signature is rejected (403)', forged.status === 403, forged.status);

  // A disallowed file type must be refused — use a Draft so the immutability
  // rule does not fire before the type check.
  const drafts = await call('GET', '/kpis?frequency=MONTHLY&periodCode=2026-09&status=DRAFT', null, token);
  const draft = drafts.data?.items?.[0];
  check('A Draft KPI is available for the upload checks', Boolean(draft), drafts.data?.counts);

  if (draft) {
    const form = new FormData();
    form.append('files', new Blob([Buffer.from('MZ\x90\x00 fake executable')], { type: 'application/octet-stream' }), 'malware.exe');
    const uploadRes = await fetch(`${BASE}/kpis/${draft.id}/evidence`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    const uploadBody = await uploadRes.json();
    check('An .exe upload is rejected (AC-07)', uploadRes.status === 422, uploadBody);

    // A macro-enabled Office file must be refused by extension
    const macroForm = new FormData();
    macroForm.append('files', new Blob([Buffer.from('PK\x03\x04 fake docm')], { type: 'application/octet-stream' }), 'report.docm');
    const macroRes = await fetch(`${BASE}/kpis/${draft.id}/evidence`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: macroForm,
    });
    check('A macro-enabled .docm upload is rejected (FR-EVD-02)', macroRes.status === 422, await macroRes.json());

    // The EICAR test file must be refused by the malware scan (AC-07)
    const eicarForm = new FormData();
    eicarForm.append(
      'files',
      new Blob([Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*')], { type: 'text/csv' }),
      'eicar.csv',
    );
    const eicarRes = await fetch(`${BASE}/kpis/${draft.id}/evidence`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: eicarForm,
    });
    check('The EICAR test file is rejected (AC-07)', eicarRes.status === 422, await eicarRes.json());
  }

  // A 12 MB file must be refused (AC-07)
  const big = new FormData();
  big.append('files', new Blob([Buffer.alloc(12 * 1024 * 1024, 0x41)], { type: 'text/csv' }), 'huge.csv');
  const bigRes = await fetch(`${BASE}/kpis/${kpi.id}/evidence`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: big,
  });
  check('A 12 MB upload is rejected (AC-07)', bigRes.status === 413 || bigRes.status === 422, bigRes.status);

  console.log('\n──────────────────────────────────────────────────────────');
  console.log(`  Passed: ${pass}   Failed: ${fail}`);
  console.log('──────────────────────────────────────────────────────────\n');
  process.exit(fail === 0 ? 0 : 1);
};

main().catch((error) => {
  console.error('Evidence check crashed:', error);
  process.exit(1);
});
