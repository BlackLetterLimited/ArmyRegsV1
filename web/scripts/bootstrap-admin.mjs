import admin from "firebase-admin";

const TARGET_UID = "FSSzdcILGrYu4Z0IrWsPkFdlLaH3";

function initAdminApp() {
  if (admin.apps.length > 0) {
    return admin.app();
  }

  const serviceAccountJson = process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT;
  if (serviceAccountJson) {
    let parsed;
    try {
      const raw = Buffer.from(serviceAccountJson, "base64").toString("utf-8");
      parsed = JSON.parse(raw);
    } catch {
      parsed = JSON.parse(serviceAccountJson);
    }
    return admin.initializeApp({ credential: admin.credential.cert(parsed) });
  }

  return admin.initializeApp({
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
  });
}

async function run() {
  initAdminApp();
  const auth = admin.auth();
  const db = admin.firestore();

  const user = await auth.getUser(TARGET_UID);
  const claims = user.customClaims ?? {};
  await auth.setCustomUserClaims(TARGET_UID, {
    ...claims,
    admin: true
  });

  await db.collection("admin_roles").doc(TARGET_UID).set(
    {
      uid: TARGET_UID,
      admin: true,
      email: user.email ?? null,
      updatedAt: new Date().toISOString(),
      updatedBy: "bootstrap-admin-script"
    },
    { merge: true }
  );

  const updated = await auth.getUser(TARGET_UID);
  if (updated.customClaims?.admin !== true) {
    throw new Error("Failed to set admin claim.");
  }

  console.log(`Admin claim applied to UID ${TARGET_UID} (${updated.email ?? "no-email"}).`);
}

run().catch((error) => {
  console.error("bootstrap-admin failed:", error);
  process.exitCode = 1;
});
