/**
 * auth-actions.ts
 *
 * Thin wrappers around Firebase Auth SDK calls.
 * Keeping all SDK imports here means every page/component that calls auth
 * only imports from this module, making the entire auth layer trivially
 * mockable in unit tests with jest.mock('../../lib/auth-actions').
 */

import { FirebaseError } from "firebase/app";
import {
  createUserWithEmailAndPassword,
  FacebookAuthProvider,
  GoogleAuthProvider,
  isSignInWithEmailLink,
  sendPasswordResetEmail,
  sendSignInLinkToEmail,
  signInAnonymously,
  signInWithEmailAndPassword,
  signInWithEmailLink,
  signInWithPopup,
  updateProfile,
  type ActionCodeSettings,
  type User
} from "firebase/auth";
import { auth } from "./firebase";

function formatFirebaseAuthError(error: unknown): string {
  if (error instanceof FirebaseError) {
    switch (error.code) {
      case "auth/operation-not-allowed":
      case "auth/admin-restricted-operation":
        return (
          "Anonymous sign-in is disabled for this Firebase project. In Firebase Console open " +
          "Authentication → Sign-in method → enable Anonymous, then try again."
        );
      case "auth/network-request-failed":
        return "Network error while contacting Firebase. Check your connection and try again.";
      default:
        return error.message;
    }
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Authentication failed. Please try again.";
}

function requireAuth() {
  if (!auth) {
    throw new Error("Firebase auth is not initialized. Check your environment variables.");
  }
  return auth;
}

// ---------------------------------------------------------------------------
// Email + password
// ---------------------------------------------------------------------------

export async function signInWithEmail(email: string, password: string): Promise<User> {
  const a = requireAuth();
  const result = await signInWithEmailAndPassword(a, email, password);
  return result.user;
}

export async function signUpWithEmail(email: string, password: string): Promise<User> {
  const a = requireAuth();
  const result = await createUserWithEmailAndPassword(a, email, password);
  return result.user;
}

export async function updateUserProfile(
  user: User,
  profile: { displayName?: string; photoURL?: string }
): Promise<void> {
  await updateProfile(user, profile);
}

export async function resetPassword(email: string): Promise<void> {
  const a = requireAuth();
  await sendPasswordResetEmail(a, email);
}

// ---------------------------------------------------------------------------
// Google
// ---------------------------------------------------------------------------

export async function signInWithGoogle(): Promise<User> {
  const a = requireAuth();
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  const result = await signInWithPopup(a, provider);
  return result.user;
}

// ---------------------------------------------------------------------------
// Facebook
// ---------------------------------------------------------------------------

export async function signInWithFacebook(): Promise<User> {
  const a = requireAuth();
  const provider = new FacebookAuthProvider();
  provider.addScope("email");
  const result = await signInWithPopup(a, provider);
  return result.user;
}

// ---------------------------------------------------------------------------
// Magic link (email link / passwordless)
// ---------------------------------------------------------------------------

const MAGIC_LINK_EMAIL_KEY = "armyregs_magic_link_email";

export async function sendMagicLink(email: string, redirectUrl: string): Promise<void> {
  const a = requireAuth();
  const actionCodeSettings: ActionCodeSettings = {
    url: redirectUrl,
    handleCodeInApp: true
  };
  await sendSignInLinkToEmail(a, email, actionCodeSettings);
  // Persist email so the confirmation page can access it even after a tab close.
  if (typeof window !== "undefined") {
    window.localStorage.setItem(MAGIC_LINK_EMAIL_KEY, email);
  }
}

export function isMagicLinkUrl(href: string): boolean {
  if (!auth) return false;
  return isSignInWithEmailLink(auth, href);
}

export async function confirmMagicLink(href: string, emailHint?: string): Promise<User> {
  const a = requireAuth();
  let email = emailHint;
  if (!email && typeof window !== "undefined") {
    email = window.localStorage.getItem(MAGIC_LINK_EMAIL_KEY) ?? undefined;
  }
  if (!email) {
    throw new Error("Email address is required to confirm magic link sign-in.");
  }
  const result = await signInWithEmailLink(a, email, href);
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(MAGIC_LINK_EMAIL_KEY);
  }
  return result.user;
}

// ---------------------------------------------------------------------------
// Anonymous
// ---------------------------------------------------------------------------

export async function signInAsGuest(): Promise<User> {
  const a = requireAuth();

  if (a.currentUser?.isAnonymous) {
    return a.currentUser;
  }
  if (a.currentUser) {
    throw new Error("Already signed in. Sign out first if you need a new guest session.");
  }

  try {
    const result = await signInAnonymously(a);
    return result.user;
  } catch (e) {
    throw new Error(formatFirebaseAuthError(e));
  }
}

// ---------------------------------------------------------------------------
// Sign out + session cookie management
// ---------------------------------------------------------------------------

export async function signOutUser(): Promise<void> {
  const a = requireAuth();
  await a.signOut();
  // Revoke the server-side session cookie so the middleware redirects correctly.
  await fetch("/api/auth/session", { method: "DELETE" });
}

/**
 * After any sign-in, post the fresh ID token to the session API route so it
 * sets an HTTP-only __session cookie. This is what the middleware reads.
 */
export async function createServerSession(idToken: string): Promise<void> {
  const response = await fetch("/api/auth/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken })
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(
      (data as { error?: string }).error ?? "Failed to create server session."
    );
  }
}
