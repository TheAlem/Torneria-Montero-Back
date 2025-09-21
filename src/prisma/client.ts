// Use the generated Prisma Client directly to avoid runtime init issues with @prisma/client
import { PrismaClient } from '../../generated/prisma/index.js';

const prisma = new PrismaClient();

export { prisma };
