"use client";

import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { User, onAuthStateChanged, getIdTokenResult } from "firebase/auth";
import { auth } from "./firebase";

export type Role = "SuperAdmin" | "Admin" | "Responsable_Editorial" | "Editor" | "Autor" | "Traductor";

interface ImpersonatedProfile {
  uid: string;
  email: string;
  displayName?: string;
  role: Role;
  organizationId: string | null;
}

interface AuthContextType {
  // Real auth state
  user: User | null;
  realRole: Role | null;
  realOrganizationId: string | null;
  loading: boolean;

  // Effective values (impersonated if active, else real)
  role: Role | null;
  organizationId: string | null;

  // Impersonation
  impersonated: ImpersonatedProfile | null;
  startImpersonation: (profile: ImpersonatedProfile) => void;
  stopImpersonation: () => void;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  realRole: null,
  realOrganizationId: null,
  loading: true,
  role: null,
  organizationId: null,
  impersonated: null,
  startImpersonation: () => {},
  stopImpersonation: () => {},
});

export const useAuth = () => useContext(AuthContext);

const IMPERSONATION_KEY = "caliope_impersonation";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [realRole, setRealRole] = useState<Role | null>(null);
  const [realOrganizationId, setRealOrganizationId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [impersonated, setImpersonated] = useState<ImpersonatedProfile | null>(null);

  // Restore impersonation from sessionStorage (survives page refresh, not tab close)
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(IMPERSONATION_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (saved) setImpersonated(JSON.parse(saved));
    } catch {}
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      if (firebaseUser) {
        try {
          const tokenResult = await getIdTokenResult(firebaseUser);
          setRealRole((tokenResult.claims.role as Role) || "Autor");
          setRealOrganizationId((tokenResult.claims.organizationId as string) || null);
        } catch (error) {
          console.error("Error fetching custom claims", error);
        }
      } else {
        setRealRole(null);
        setRealOrganizationId(null);
        // Clear impersonation on logout
        setImpersonated(null);
        sessionStorage.removeItem(IMPERSONATION_KEY);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const startImpersonation = useCallback((profile: ImpersonatedProfile) => {
    setImpersonated(profile);
    try {
      sessionStorage.setItem(IMPERSONATION_KEY, JSON.stringify(profile));
    } catch {}
  }, []);

  const stopImpersonation = useCallback(() => {
    setImpersonated(null);
    try {
      sessionStorage.removeItem(IMPERSONATION_KEY);
    } catch {}
  }, []);

  // Effective values: use impersonated if active, otherwise real
  const role = impersonated ? impersonated.role : realRole;
  const organizationId = impersonated ? impersonated.organizationId : realOrganizationId;

  return (
    <AuthContext.Provider
      value={{
        user,
        realRole,
        realOrganizationId,
        loading,
        role,
        organizationId,
        impersonated,
        startImpersonation,
        stopImpersonation,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
