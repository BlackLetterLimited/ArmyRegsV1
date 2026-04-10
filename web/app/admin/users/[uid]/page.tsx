"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

interface AdminUser {
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

interface PageProps {
  params: {
    uid: string;
  };
}

export default function AdminUserDetailPage({ params }: PageProps) {
  const uid = decodeURIComponent(params.uid);
  const [user, setUser] = useState<AdminUser | null>(null);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [tempPassword, setTempPassword] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadUser = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/admin/users/${encodeURIComponent(uid)}`);
      const payload = (await response.json().catch(() => ({}))) as {
        user?: AdminUser;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to load user.");
      }
      if (!payload.user) {
        throw new Error("User was not found.");
      }
      setUser(payload.user);
      setEmail(payload.user.email ?? "");
      setDisplayName(payload.user.displayName ?? "");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to load user.");
    } finally {
      setIsLoading(false);
    }
  }, [uid]);

  useEffect(() => {
    void loadUser();
  }, [loadUser]);

  const patchUser = useCallback(async (body: Record<string, unknown>, successMessage: string) => {
    setIsSaving(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/admin/users/${encodeURIComponent(uid)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const payload = (await response.json().catch(() => ({}))) as {
        user?: AdminUser;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to update user.");
      }
      if (payload.user) {
        setUser(payload.user);
        setEmail(payload.user.email ?? "");
        setDisplayName(payload.user.displayName ?? "");
      }
      setNotice(successMessage);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to update user.");
    } finally {
      setIsSaving(false);
    }
  }, [uid]);

  const sendPasswordReset = useCallback(async () => {
    setIsSaving(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/admin/users/${encodeURIComponent(uid)}/password-reset`, {
        method: "POST"
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        email?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to send password reset email.");
      }
      setNotice(`Password reset email sent to ${payload.email ?? "user"}.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to send password reset email.");
    } finally {
      setIsSaving(false);
    }
  }, [uid]);

  const statusText = useMemo(() => {
    if (!user) return "";
    return user.disabled ? "disabled" : "active";
  }, [user]);

  if (isLoading) {
    return (
      <div className="admin-section">
        <div className="admin-section__header ds-panel">
          <h1 className="admin-section-title">Loading user...</h1>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="admin-section">
        <div className="admin-section__header ds-panel">
          <h1 className="admin-section-title">User not found</h1>
          <Link href="/admin/users" className="ds-button ds-button--ghost">
            Back to Users
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-section">
      <div className="admin-section__header ds-panel">
        <div>
          <h1 className="admin-section-title">User Detail</h1>
          <p className="admin-muted">{user.uid}</p>
        </div>
        <Link href="/admin/users" className="ds-button ds-button--ghost">
          Back to Users
        </Link>
      </div>

      {error ? <p className="chat-error">{error}</p> : null}
      {notice ? <p className="admin-notice">{notice}</p> : null}

      <section className="admin-detail-grid">
        <div className="ds-panel admin-detail-card">
          <h2 className="admin-section-title">Profile</h2>
          <label className="admin-field">
            <span>Email</span>
            <input
              className="admin-input"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="email@example.com"
            />
          </label>
          <label className="admin-field">
            <span>Display Name</span>
            <input
              className="admin-input"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="Display name"
            />
          </label>
          <button
            type="button"
            className="ds-button ds-button--primary"
            disabled={isSaving}
            onClick={() =>
              void patchUser(
                {
                  email: email.trim() || null,
                  displayName: displayName.trim() || null
                },
                "Profile updated."
              )
            }
          >
            Save Profile
          </button>
        </div>

        <div className="ds-panel admin-detail-card">
          <h2 className="admin-section-title">Access and Recovery</h2>
          <div className="admin-key-values">
            <p><strong>Role:</strong> {user.isAdmin ? "admin" : "member"}</p>
            <p><strong>Status:</strong> {statusText}</p>
            <p><strong>Providers:</strong> {user.providerIds.join(", ") || (user.isAnonymous ? "anonymous" : "unknown")}</p>
          </div>
          <div className="admin-actions">
            <button
              type="button"
              className="ds-button ds-button--ghost"
              disabled={isSaving}
              onClick={() => void patchUser({ admin: !user.isAdmin }, user.isAdmin ? "Admin role removed." : "Admin role granted.")}
            >
              {user.isAdmin ? "Remove Admin" : "Make Admin"}
            </button>
            <button
              type="button"
              className="ds-button ds-button--ghost"
              disabled={isSaving}
              onClick={() => void patchUser({ disabled: !user.disabled }, user.disabled ? "User enabled." : "User disabled.")}
            >
              {user.disabled ? "Enable User" : "Disable User"}
            </button>
            <button
              type="button"
              className="ds-button ds-button--ghost"
              disabled={isSaving || !user.email}
              onClick={() => void sendPasswordReset()}
            >
              Send Reset Email
            </button>
          </div>
          <label className="admin-field">
            <span>Temporary Password</span>
            <input
              className="admin-input"
              type="password"
              value={tempPassword}
              onChange={(event) => setTempPassword(event.target.value)}
              placeholder="Enter temporary password"
            />
          </label>
          <button
            type="button"
            className="ds-button ds-button--ghost"
            disabled={isSaving || tempPassword.trim().length < 8}
            onClick={() => {
              const password = tempPassword.trim();
              if (password.length < 8) return;
              void patchUser({ password }, "Temporary password set.");
              setTempPassword("");
            }}
          >
            Set Temp Password
          </button>
        </div>
      </section>
    </div>
  );
}
