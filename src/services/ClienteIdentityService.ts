import { prisma } from '../prisma/client.js';

/**
 * Resuelve el perfil y el id de cliente asociados al usuario autenticado.
 * Retorna { profile: null, clienteId: null } si el usuario no existe o no está vinculado.
 * También intenta vincular automáticamente el cliente con el usuario si se detecta por email.
 */
export async function resolveClienteIdentity(userId: number): Promise<{
  profile: Awaited<ReturnType<typeof prisma.usuarios.findUnique>> | null;
  clienteId: number | null;
}> {
  const profile = await prisma.usuarios.findUnique({ where: { id: Number(userId) }, include: { cliente: true } });
  if (!profile) return { profile: null, clienteId: null };

  let clienteId = profile.cliente?.id ?? null;
  if (!clienteId) {
    const orConditions: any[] = [{ usuario_id: profile.id }];
    if (profile.email) orConditions.push({ email: profile.email });
    const fallback = await prisma.clientes.findFirst({ where: { OR: orConditions } });
    if (fallback) {
      clienteId = fallback.id;
      if (!fallback.usuario_id) {
        await prisma.clientes.update({ where: { id: fallback.id }, data: { usuario_id: profile.id } }).catch(() => {});
      }
    }
  }

  return { profile, clienteId };
}

export default { resolveClienteIdentity };
