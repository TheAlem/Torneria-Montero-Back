import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const workers = ['Juan Pérez','María Roca','Carlos Ruiz','Ana Martín'];
  for (const w of workers) {
    await prisma.worker.upsert({ where: { fullName: w }, update: {}, create: { fullName: w } });
  }

  // sample client
  await prisma.client.upsert({ where: { phone: '+59177711122' }, update: {}, create: {
    name: 'Industrias ABC', phone: '+59177711122', address: 'Calle Falsa 123', company: 'Industrias ABC', email: 'contacto@industriasabc.com'
  }});
}

main().then(()=>{ console.log('Seed done'); process.exit(0); }).catch(e=>{ console.error(e); process.exit(1); });
