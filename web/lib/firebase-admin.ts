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
 */

import { cert, getApps, getApp, initializeApp, type ServiceAccount } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";

function initAdminApp() {
  if (getApps().length > 0) {
    return getApp();
  }

  const serviceAccountJson = process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT;

  if (serviceAccountJson) {
    // Accepts either raw JSON or a base64-encoded JSON string.
    let parsed: ServiceAccount;
    try {
      const raw = Buffer.from(serviceAccountJson, "base64").toString("utf-8");
      parsed = JSON.parse(raw) as ServiceAccount;
    } catch {
      parsed = JSON.parse(serviceAccountJson) as ServiceAccount;
    }
    return initializeApp({ credential: cert(parsed) });
  }

  // Fall back to Application Default Credentials (works on Cloud Run, GCE, etc.)
  return initializeApp({
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
  });
}

export const adminApp = initAdminApp();
export const adminAuth = getAdminAuth(adminApp);
