// Import the generated Prisma Client directly to avoid runtime init issues
import { PrismaClient } from '../generated/prisma/index.js';
const prisma = new PrismaClient();

async function main() {
  const workers = ['Juan Pérez','María Roca','Carlos Ruiz','Ana Martín'];
  for (const w of workers) {
    const existingWorker = await prisma.worker.findFirst({ where: { fullName: w } });
    if (!existingWorker) {
      await prisma.worker.create({ data: { fullName: w } });
    }
  }

  // sample client (phone is not unique in schema, so use findFirst/create)
  const existingClient = await prisma.client.findFirst({ where: { phone: '+59177711122' } });
  if (!existingClient) {
    await prisma.client.create({ data: {
      name: 'Industrias ABC', phone: '+59177711122', address: 'Calle Falsa 123', company: 'Industrias ABC', email: 'contacto@industriasabc.com'
    }});
  }
}

main().then(()=>{ console.log('Seed done'); process.exit(0); }).catch(e=>{ console.error(e); process.exit(1); });
