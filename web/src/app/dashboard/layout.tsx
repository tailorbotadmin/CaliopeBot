"use client";

import { useAuth } from "@/lib/auth-context";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, role, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.push("/");
    }
  }, [user, loading, router]);

  if (loading || !user) {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100vh" }}>
        <p>Verificando sesión...</p>
      </div>
    );
  }

  const handleLogout = () => {
    signOut(auth);
    router.push("/");
  };

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      {/* Sidebar */}
      <aside style={{ width: "250px", backgroundColor: "var(--bg-surface)", borderRight: "1px solid var(--border-color)", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "1.5rem", borderBottom: "1px solid var(--border-color)", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          <h2 style={{ fontSize: "1.25rem", fontWeight: 600, color: "var(--primary)" }}>CalíopeBot</h2>
          <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            {role || "Cargando rol..."}
          </span>
        </div>
        
        <nav style={{ flex: 1, padding: "1rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          <a href="/dashboard" className="btn btn-secondary" style={{ justifyContent: "flex-start" }}>Panel Principal</a>
          {(role === "SuperAdmin" || role === "Admin") && (
            <a href="/dashboard/organizations" className="btn btn-secondary" style={{ justifyContent: "flex-start" }}>Organizaciones</a>
          )}
          {(role === "SuperAdmin" || role === "Admin" || role === "Responsable Editorial") && (
            <a href="/dashboard/books" className="btn btn-secondary" style={{ justifyContent: "flex-start" }}>Catálogo</a>
          )}
          <a href="/dashboard/editor" className="btn btn-secondary" style={{ justifyContent: "flex-start" }}>Editor</a>
        </nav>

        <div style={{ padding: "1rem", borderTop: "1px solid var(--border-color)" }}>
          <div style={{ fontSize: "0.875rem", marginBottom: "1rem", overflow: "hidden", textOverflow: "ellipsis" }}>
            {user.email}
          </div>
          <button onClick={handleLogout} className="btn btn-secondary" style={{ width: "100%" }}>Cerrar Sesión</button>
        </div>
      </aside>

      {/* Main Content */}
      <main style={{ flex: 1, backgroundColor: "var(--bg-color)", overflowY: "auto" }}>
        {children}
      </main>
    </div>
  );
}
