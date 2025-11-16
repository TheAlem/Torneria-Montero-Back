import admin from 'firebase-admin';
import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger.js';
import { prisma } from '../prisma/client.js';

type PushPayload = {
  title: string;
  body: string;
  data?: Record<string, string>;
};

let firebaseApp: admin.app.App | null = null;
let bootstrapAttempted = false;

function resolveCredential() {
  const base64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64 || process.env.GOOGLE_CREDENTIALS_BASE64;
  if (base64) {
    try {
      const json = Buffer.from(base64, 'base64').toString('utf8');
      return JSON.parse(json);
    } catch (err) {
      logger.error({ msg: '[FirebaseMessaging] Invalid base64 credentials', err: (err as any)?.message });
      return null;
    }
  }

  const filePath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (filePath) {
    try {
      const resolved = path.resolve(process.cwd(), filePath);
      const content = fs.readFileSync(resolved, 'utf8');
      return JSON.parse(content);
    } catch (err) {
      logger.error({ msg: '[FirebaseMessaging] Cannot read credentials file', path: filePath, err: (err as any)?.message });
      return null;
    }
  }

  return null;
}

function ensureApp(): admin.app.App | null {
  if (firebaseApp) return firebaseApp;
  if (bootstrapAttempted) return null;
  bootstrapAttempted = true;

  try {
    if (admin.apps.length > 0) {
      firebaseApp = admin.app();
      return firebaseApp;
    }

    const credentials = resolveCredential();
    if (!credentials) {
      logger.warn('[FirebaseMessaging] Credentials not configured. Skipping push initialization.');
      return null;
    }

    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert(credentials as admin.ServiceAccount),
    });
    logger.info('[FirebaseMessaging] Initialized Firebase Admin SDK');
    return firebaseApp;
  } catch (err) {
    logger.error({ msg: '[FirebaseMessaging] Initialization failed', err: (err as any)?.message });
    firebaseApp = null;
    return null;
  }
}

export async function sendToToken(token: string, payload: PushPayload) {
  const app = ensureApp();
  if (!app || !token) return false;
  try {
    await admin.messaging(app).send({
      token,
      notification: { title: payload.title, body: payload.body },
      data: payload.data ?? {},
    });
    return true;
  } catch (err) {
    const code = (err as any)?.code;
    if (code === 'messaging/registration-token-not-registered') {
      logger.warn({ msg: '[FirebaseMessaging] Token not registered. Consider removing.', token });
    } else {
      logger.warn({ msg: '[FirebaseMessaging] Failed to send push', err: (err as any)?.message });
    }
    return false;
  }
}

export async function sendToCliente(clienteId: number, payload: PushPayload) {
  if (!clienteId) return false;
  try {
    const cliente = await prisma.clientes.findUnique({ where: { id: clienteId }, select: { device_id: true } });
    if (!cliente?.device_id) return false;
    return await sendToToken(cliente.device_id, payload);
  } catch (err) {
    logger.warn({ msg: '[FirebaseMessaging] Cannot resolve cliente token', clienteId, err: (err as any)?.message });
    return false;
  }
}

export default { sendToToken, sendToCliente };
