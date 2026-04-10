import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "../../../../../lib/firebase-admin";
import { jsonError } from "../../../../../lib/api-response";
import {
  assertAdminRequest,
  toAdminUser,
  toBooleanOrUndefined,
  toStringOrUndefined
} from "../../../../../lib/admin-api";

interface RouteContext {
  params: Promise<{ uid: string }>;
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    await assertAdminRequest(request);
    const { uid } = await context.params;
    const user = await adminAuth.getUser(uid);
    return NextResponse.json({ user: toAdminUser(user) }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Forbidden";
    const status = message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 400;
    return jsonError(message, status);
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const actor = await assertAdminRequest(request);
    const { uid } = await context.params;
    const body = (await request.json().catch(() => ({}))) as {
      email?: unknown;
      displayName?: unknown;
      disabled?: unknown;
      admin?: unknown;
      password?: unknown;
    };

    const updatePayload: Parameters<typeof adminAuth.updateUser>[1] = {};
    const email = toStringOrUndefined(body.email);
    const displayName = toStringOrUndefined(body.displayName);
    const password = toStringOrUndefined(body.password);
    const disabled = toBooleanOrUndefined(body.disabled);
    const wantsAdmin = toBooleanOrUndefined(body.admin);

    if (email) updatePayload.email = email;
    if (displayName) updatePayload.displayName = displayName;
    if (disabled !== undefined) updatePayload.disabled = disabled;
    if (password) updatePayload.password = password;

    if (Object.keys(updatePayload).length > 0) {
      await adminAuth.updateUser(uid, updatePayload);
    }

    if (wantsAdmin !== undefined) {
      const current = await adminAuth.getUser(uid);
      const existingClaims = current.customClaims ?? {};
      await adminAuth.setCustomUserClaims(uid, {
        ...existingClaims,
        admin: wantsAdmin
      });
      await adminDb.collection("admin_roles").doc(uid).set(
        {
          uid,
          admin: wantsAdmin,
          updatedBy: actor.uid,
          updatedAt: new Date().toISOString()
        },
        { merge: true }
      );
    }

    const updated = await adminAuth.getUser(uid);
    return NextResponse.json({ user: toAdminUser(updated) }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update user";
    const status = message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 400;
    return jsonError(message, status);
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    await assertAdminRequest(request);
    const { uid } = await context.params;
    await adminAuth.deleteUser(uid);
    await adminDb.collection("admin_roles").doc(uid).delete().catch(() => undefined);
    return NextResponse.json({ status: "ok" }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete user";
    const status = message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 400;
    return jsonError(message, status);
  }
}
