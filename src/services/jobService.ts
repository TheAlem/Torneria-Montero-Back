import { prisma } from '../prisma/client.js';
import { CreateJobBody } from '../validators/jobValidator.js';
import NotificationService from './notificationService.js';

function mapPriority(p: string) {
  const m = p.toLowerCase();
  if (m === 'baja') return 'BAJA';
  if (m === 'alta') return 'ALTA';
  return 'MEDIA';
}

function mapPaymentStatus(p: string) {
  return p.toLowerCase() === 'pagado' ? 'PAGADO' : 'PENDIENTE';
}

export async function createFromForm(payload: CreateJobBody) {
  // normalize
  const code = payload.code.trim();
  const assignedWorkerName = payload.assignedWorker.trim();

  // check worker
  const worker = await prisma.worker.findUnique({ where: { fullName: assignedWorkerName } });
  if (!worker) throw { status: 404, message: 'Assigned worker not found' };

  // transaction: find or create client, upsert app account, create job
  return await prisma.$transaction(async (tx: any) => {
    // find client by email -> phone -> name+company/phone
    let client = null;
    if (payload.clientEmail) client = await tx.client.findUnique({ where: { email: payload.clientEmail } });
    if (!client) client = await tx.client.findFirst({ where: { phone: payload.clientPhone } });
    if (!client) client = await tx.client.findFirst({ where: { name: payload.clientName, OR: [{ company: payload.clientCompany || '' }, { phone: payload.clientPhone }] } });

    if (!client) {
      client = await tx.client.create({ data: {
        name: payload.clientName.trim(),
        company: payload.clientCompany?.trim() || null,
        phone: payload.clientPhone.trim(),
        email: payload.clientEmail?.trim() || null,
        address: payload.clientAddress.trim()
      }});
    } else {
      // update minimal fields if empty
      client = await tx.client.update({ where: { id: client.id }, data: {
        company: client.company || payload.clientCompany?.trim() || null,
        email: client.email || payload.clientEmail?.trim() || null,
        address: client.address || payload.clientAddress.trim()
      }});
    }

    // upsert app account
    if (payload.clientAppEmail || payload.clientAppPhone) {
      await tx.clientAppAccount.upsert({
        where: { clientId: client.id },
        update: {
          appEmail: payload.clientAppEmail?.trim() || null,
          appPhone: payload.clientAppPhone?.trim() || null
        },
        create: {
          clientId: client.id,
          appEmail: payload.clientAppEmail?.trim() || null,
          appPhone: payload.clientAppPhone?.trim() || null
        }
      });
    }

    // create job
    const existing = await tx.job.findUnique({ where: { code } });
    if (existing) throw { status: 409, message: 'Job code already exists' };

    const job = await tx.job.create({ data: {
      code,
      clientId: client.id,
      workType: payload.workType.trim(),
      description: payload.description.trim(),
      priority: mapPriority(payload.priority) as any,
      estimatedDelivery: new Date(payload.estimatedDelivery),
      assignedWorkerId: worker.id,
      paymentAmount: payload.paymentAmount as any,
      paymentStatus: mapPaymentStatus(payload.paymentStatus) as any,
      materials: payload.materials?.trim() || null,
      specifications: payload.specifications?.trim() || null,
      status: 'PENDIENTE',
      dateCreated: new Date(payload.dateCreated)
    }});

    if (payload.sendAppInstructions) {
      await NotificationService.sendAppAccess(payload.clientAppEmail, payload.clientAppPhone, job.code);
    }

    const jobWithRelations = await tx.job.findUnique({ where: { id: job.id }, include: { client: { include: { appAccount: true } }, assignedWorker: true } });
    return jobWithRelations;
  });
}

export default { createFromForm };
