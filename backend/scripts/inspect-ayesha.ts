import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const main = async () => {
  const user = await prisma.user.findUnique({ where: { email: 'ayesha.siddiqua@anwargroup.net' } });
  if (!user) {
    console.log('user not found');
    return;
  }
  const period = await prisma.kpiPeriod.findUnique({ where: { code: '2026-09' } });
  const kpis = await prisma.kpi.findMany({
    where: { employeeId: user.id, periodId: period?.id },
    select: { name: true, kpiWeight: true, status: true, frequency: true },
  });
  console.log('Ayesha Sep-2026 KPIs:', JSON.stringify(kpis, null, 1));
  console.log(
    'allocated (excl. rejected/deleted):',
    kpis.filter((k) => k.status !== 'REJECTED' && k.status !== 'DELETED').reduce((a, k) => a + k.kpiWeight, 0),
  );
  await prisma.$disconnect();
};

main();
