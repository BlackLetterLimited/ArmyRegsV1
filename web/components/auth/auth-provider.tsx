"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";
import { getIdToken, onIdTokenChanged, signInAnonymously, type User } from "firebase/auth";
import { auth, getFirebaseMissingConfigMessage, hasFirebaseConfig } from "../../lib/firebase";

interface FirebaseAuthContextValue {
  isLoading: boolean;
  isReady: boolean;
  user: User | null;
  idToken: string | null;
  error: string | null;
  hasConfig: boolean;
}

const FirebaseAuthContext = createContext<FirebaseAuthContextValue | null>(null);

function FirebaseAuthProviderInner({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [idToken, setIdToken] = useState<string | null>(null);
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
            await signInAnonymously(auth);
            return;
          }

          const token = await getIdToken(nextUser, true);
          setIdToken(token);
          setError(null);
        } catch (caught) {
          const message = caught instanceof Error ? caught.message : "Failed to initialize Firebase auth.";
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

  const value = useMemo(
    () => ({
      isLoading,
      isReady: Boolean(idToken && user),
      user,
      idToken,
      error,
      hasConfig: hasFirebaseConfig
    }),
    [error, idToken, isLoading, user]
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
