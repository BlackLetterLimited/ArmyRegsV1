/**
 * firebase-admin.ts
 *
 * Server-only Firebase Admin SDK initialization.
 * This file must NEVER be imported by client components — it runs exclusively
 * in Node.js API routes and server actions.
 *
 * The Admin SDK can be initialized with a service account JSON
 * (FIREBASE_ADMIN_SERVICE_ACCOUNT env var, base64-encoded) or, when running
 * on Google Cloud infrastructure, with Application Default Credentials by
 * simply omitting credential options.
 *
 * Uses the root `firebase-admin` entry (not `firebase-admin/app`) so Next.js
 * webpack resolves the package reliably.
 */

import admin from "firebase-admin";

function initAdminApp(): admin.app.App {
  if (admin.apps.length > 0) {
    return admin.app();
  }

  const serviceAccountJson = process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT;

  if (serviceAccountJson) {
    let parsed: admin.ServiceAccount;
    try {
      const raw = Buffer.from(serviceAccountJson, "base64").toString("utf-8");
      parsed = JSON.parse(raw) as admin.ServiceAccount;
    } catch {
      parsed = JSON.parse(serviceAccountJson) as admin.ServiceAccount;
    }
    return admin.initializeApp({ credential: admin.credential.cert(parsed) });
  }

  return admin.initializeApp({
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  });
}

export const adminApp = initAdminApp();
export const adminAuth = admin.auth(adminApp);
