import type { UserRecord } from "firebase-admin/auth";
import type { NextRequest } from "next/server";
import { requireAdminRequest } from "./server-auth";

export interface AdminUserDto {
  uid: string;
  email: string | null;
  displayName: string | null;
  disabled: boolean;
  providerIds: string[];
  createdAt: string | null;
  lastSignInAt: string | null;
  isAnonymous: boolean;
  isAdmin: boolean;
}

export async function assertAdminRequest(request: NextRequest) {
  return requireAdminRequest(request);
}

export function toAdminUser(user: UserRecord): AdminUserDto {
  const providerIds = user.providerData.map((provider) => provider.providerId);
  const isAnonymous = providerIds.length === 0 || providerIds.includes("anonymous");
  return {
    uid: user.uid,
    email: user.email ?? null,
    displayName: user.displayName ?? null,
    disabled: user.disabled,
    providerIds,
    createdAt: user.metadata.creationTime ?? null,
    lastSignInAt: user.metadata.lastSignInTime ?? null,
    isAnonymous,
    isAdmin: user.customClaims?.admin === true
  };
}

export function toBooleanOrUndefined(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  return undefined;
}

export function toStringOrUndefined(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
