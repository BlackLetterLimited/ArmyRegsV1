"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";
import { getIdTokenResult, onIdTokenChanged, type User } from "firebase/auth";
import { auth, getFirebaseMissingConfigMessage, hasFirebaseConfig } from "../../lib/firebase";
import { signInAsGuest as _signInAsGuest, signOutUser, createServerSession } from "../../lib/auth-actions";

interface FirebaseAuthContextValue {
  isLoading: boolean;
  isReady: boolean;
  user: User | null;
  idToken: string | null;
  isAdmin: boolean;
  error: string | null;
  hasConfig: boolean;
  signInAsGuest: () => Promise<void>;
  signOut: () => Promise<void>;
}

const FirebaseAuthContext = createContext<FirebaseAuthContextValue | null>(null);

function FirebaseAuthProviderInner({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [idToken, setIdToken] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!hasFirebaseConfig) {
      setError(getFirebaseMissingConfigMessage());
      setIsLoading(false);
      return;
    }

    if (!auth) {
      setError("Firebase auth is not initialized");
      setIsLoading(false);
      return;
    }

    const unsubscribe = onIdTokenChanged(
      auth,
      async (nextUser) => {
        try {
          setUser(nextUser);

          if (!nextUser) {
            setIdToken(null);
            setIsAdmin(false);
            setIsLoading(false);
            return;
          }

          const tokenResult = await getIdTokenResult(nextUser, true);
          setIdToken(tokenResult.token);
          setIsAdmin(tokenResult.claims.admin === true);

          // Keep the server-side session cookie in sync whenever the token refreshes.
          await createServerSession(tokenResult.token);

          setError(null);
        } catch (caught) {
          const message =
            caught instanceof Error ? caught.message : "Failed to initialize Firebase auth.";
          setError(message);
        } finally {
          setIsLoading(false);
        }
      },
      () => {
        setError("Firebase auth failed to initialize");
        setIsLoading(false);
      }
    );

    return () => {
      unsubscribe();
    };
  }, []);

  const signInAsGuest = useCallback(async () => {
    try {
      setError(null);
      await _signInAsGuest();
      // onIdTokenChanged fires automatically and updates state.
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : "Failed to sign in as guest.";
      setError(message);
      throw caught;
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      setError(null);
      await signOutUser();
      setUser(null);
      setIdToken(null);
      setIsAdmin(false);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Failed to sign out.";
      setError(message);
      throw caught;
    }
  }, []);

  const value = useMemo(
    () => ({
      isLoading,
      isReady: Boolean(idToken && user),
      user,
      idToken,
      isAdmin,
      error,
      hasConfig: hasFirebaseConfig,
      signInAsGuest,
      signOut
    }),
    [error, idToken, isAdmin, isLoading, signInAsGuest, signOut, user]
  );

  return <FirebaseAuthContext.Provider value={value}>{children}</FirebaseAuthContext.Provider>;
}

export function FirebaseAuthProvider({ children }: { children: ReactNode }) {
  return <FirebaseAuthProviderInner>{children}</FirebaseAuthProviderInner>;
}

export function useFirebaseAuth(): FirebaseAuthContextValue {
  const context = useContext(FirebaseAuthContext);

  if (!context) {
    throw new Error("useFirebaseAuth must be used inside FirebaseAuthProvider.");
  }

  return context;
}
