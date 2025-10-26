// prisma/seed.ts
// Import the generated Prisma Client directly to avoid runtime init issues
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  // 1) Usuarios base (credenciales)
  const usuariosData = [
    { nombre: 'Admin', email: 'admin@local.test', telefono: '+59170000001', password_hash: 'changeme', rol: 'ADMIN' },
    { nombre: 'Cliente Demo', email: 'cliente@local.test', telefono: '+59170000002', password_hash: 'changeme', rol: 'CLIENTE' },
    { nombre: 'Tornero Demo', email: 'tornero@local.test', telefono: '+59170000003', password_hash: 'changeme', rol: 'TORNERO' },
  ] as any[];

  for (const u of usuariosData) {
    const existing = await prisma.usuarios.findFirst({ where: { email: u.email } });
    if (!existing) {
      await prisma.usuarios.create({ data: u });
    }
  }

  // 2) Clientes (referenciando usuario cliente si existe)
  const cliEmail = '+59177711122';
  const existingClient = await prisma.clientes.findFirst({ where: { telefono: cliEmail } });
  if (!existingClient) {
    // intenta enlazar con el usuario cliente creado arriba
    const usuarioCliente = await prisma.usuarios.findFirst({ where: { email: 'cliente@local.test' } });
    await prisma.clientes.create({
      data: {
        nombre: 'Industrias ABC',
        telefono: cliEmail,
        direccion: 'Calle Falsa 123',
        email: 'contacto@industriasabc.com',
        company: undefined,
        usuario_id: usuarioCliente ? usuarioCliente.id : undefined,
      } as any,
    });
  }

  // 3) Trabajadores (referenciando usuario tornero si existe)
  const trabajadoresNombres = ['Juan Pérez', 'María Roca', 'Carlos Ruiz', 'Ana Martín'];
  const usuarioTornero = await prisma.usuarios.findFirst({ where: { email: 'tornero@local.test' } });
  for (const nombre of trabajadoresNombres) {
    // usamos CI único ficticio para evitar duplicados
    const ci = `CI-${nombre.replace(/\s+/g, '').toUpperCase().slice(0,8)}`;
    const exists = await prisma.trabajadores.findFirst({ where: { ci } });
    if (!exists) {
      await prisma.trabajadores.create({
        data: {
          usuario_id: usuarioTornero ? usuarioTornero.id : undefined,
          ci,
          direccion: 'Taller Central',
          rol_tecnico: 'Tornero',
          estado: 'Activo',
          skills: { torneado: 4 } as any,
          disponibilidad: { lunes: true, martes: true } as any,
        } as any,
      });
    }
  }

  console.log('Seed completed');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); process.exit(0); });