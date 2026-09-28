/**
 * Screenshot tour of the running platform for documentation and hand-over.
 * Usage: node scripts/capture-screenshots.mjs
 * Requires the API on :4100 and the web app on :5273.
 */
import { chromium } from 'playwright';
import { mkdirSync, existsSync } from 'fs';
import { resolve, join } from 'path';

const APP = process.env.APP_URL || 'http://localhost:5273';
const OUT = resolve(process.env.SCREENSHOT_DIR || './screenshots');
const PASSWORD = process.env.SEED_DEMO_PASSWORD || 'Anwar@KPI2026';

const ACCOUNTS = {
  employee: 'rafi.ahmed@anwargroup.net',
  head: 'kamrul.hasan@anwargroup.net',
  superAdmin: process.env.SEED_SUPER_ADMIN_EMAIL || 'superadmin@anwargroup.net',
  hrAdmin: 'hradmin@anwargroup.net',
  viewer: 'management.viewer@anwargroup.net',
  sysAdmin: 'sysadmin@anwargroup.net',
};

const TOUR = [
  { name: '01-login', path: '/login', as: null },
  { name: '02-register', path: '/register', as: null },
  { name: '03-my-kpi', path: '/my-kpi', as: 'employee', wait: 1200 },
  { name: '04-performance-summary', path: '/performance-summary', as: 'employee', wait: 1600 },
  { name: '05-profile', path: '/profile', as: 'employee' },
  { name: '06-notifications', path: '/notifications', as: 'employee' },
  { name: '07-department-dashboard', path: '/dashboard', as: 'head', wait: 1600 },
  { name: '08-approvals', path: '/approvals', as: 'head', wait: 1400 },
  { name: '09-leaderboard', path: '/leaderboard', as: 'head', wait: 1400 },
  { name: '10-group-dashboard', path: '/group-dashboard', as: 'superAdmin', wait: 1800 },
  { name: '11-all-requests', path: '/all-kpi-requests', as: 'superAdmin', wait: 1200 },
  { name: '12-head-kpi-requests', path: '/head-kpi-requests', as: 'superAdmin', wait: 1000 },
  { name: '13-escalations', path: '/escalations', as: 'superAdmin', wait: 1000 },
  { name: '14-admin-users', path: '/admin/users', as: 'superAdmin', wait: 1200 },
  { name: '15-organisation', path: '/admin/organisation', as: 'superAdmin', wait: 1200 },
  { name: '16-periods', path: '/admin/periods', as: 'superAdmin', wait: 1200 },
  { name: '17-configuration', path: '/admin/configuration', as: 'superAdmin', wait: 1000 },
  { name: '18-kpi-library', path: '/kpi-library', as: 'superAdmin', wait: 1000 },
  { name: '19-reports', path: '/reports', as: 'superAdmin', wait: 1200 },
  { name: '20-audit-log', path: '/admin/audit-log', as: 'superAdmin', wait: 1200 },
  { name: '21-system-health', path: '/admin/system-health', as: 'sysAdmin', wait: 1400 },
];

const APP_NAME = 'ANWAR KPIFlow';

if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const loginAs = async (context, email, password) => {
  // A fresh context guarantees a clean session, so the login form is always present.
  const page = await context.newPage();
  await page.goto(`${APP}/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#email', { timeout: 25_000 });
  await page.fill('#email', email);
  await page.fill('#password', password);
  await page.click('button[type="submit"]');
  await page
    .waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 })
    .catch(() => null);
  await page.waitForTimeout(1200);
  return page;
};

const main = async () => {
  const browser = await chromium.launch();
  const password = PASSWORD;
  let currentKey = null;
  let context = null;

  for (const step of TOUR) {
    try {
      if (step.as !== currentKey) {
        if (context) await context.close();
        context = await browser.newContext({
          viewport: { width: 1440, height: 900 },
          deviceScaleFactor: 1,
          reducedMotion: 'reduce',
        });
        if (step.as) {
          await loginAs(context, ACCOUNTS[step.as], password);
        }
        currentKey = step.as;
      }
      const pages = context.pages();
      const page = pages.length ? pages[pages.length - 1] : await context.newPage();
      await page.goto(`${APP}${step.path}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(step.wait ?? 900);
      await page.screenshot({ path: join(OUT, `${step.name}.png`), fullPage: false });
      console.log(`  ✓ ${step.name}.png`);
    } catch (error) {
      console.log(`  ✗ ${step.name}: ${error.message}`);
    }
  }

  if (context) await context.close();
  await browser.close();
  console.log(`\nScreenshots written to ${OUT}\n`);
};

main().catch((error) => {
  console.error('Screenshot tour failed:', error);
  process.exit(1);
});

void APP_NAME;
