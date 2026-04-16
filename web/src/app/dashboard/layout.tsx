"use client";

import { useAuth } from "@/lib/auth-context";
import { useRouter, usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { subscribeNotifications } from "@/lib/firestore";
import Link from "next/link";
import {
  LayoutDashboard,
  FileCheck,
  BookOpen,
  GraduationCap,
  BarChart3,
  Building2,
  Settings,
  LogOut,
  Eye,
  X,
  Bell,
} from "lucide-react";

const ROLE_LABELS: Record<string, string> = {
  SuperAdmin: "SuperAdmin",
  Admin: "Admin",
  Responsable_Editorial: "Resp. Editorial",
  Editor: "Editor",
  Traductor: "Traductor",
  Autor: "Autor",
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, role, organizationId, loading, impersonated, stopImpersonation } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [unreadCount, setUnreadCount] = useState(0);

  // Real-time unread notifications count
  useEffect(() => {
    if (!organizationId || !user) return;
    const unsub = subscribeNotifications(organizationId, user.uid, notifs => {
      setUnreadCount(notifs.filter(n => !n.read).length);
    });
    return unsub;
  }, [organizationId, user]);

  useEffect(() => {
    if (!loading && !user) {
      router.push("/");
    }
  }, [user, loading, router]);

  if (loading || !user) {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100vh", backgroundColor: "var(--bg-color)" }}>
        <p style={{ color: "var(--text-muted)" }}>Verificando sesión...</p>
      </div>
    );
  }

  const handleLogout = () => {
    stopImpersonation();
    signOut(auth);
    router.push("/");
  };

  const mainNav = [
    { href: "/dashboard", label: "Panel", icon: LayoutDashboard, roles: null },
    { href: "/dashboard/corrections", label: "Mis Correcciones", icon: FileCheck, roles: null },
    { href: "/dashboard/books", label: "Mis Manuscritos", icon: BookOpen, roles: null },
    { href: "/dashboard/training", label: "Entrenamiento", icon: GraduationCap, roles: ["SuperAdmin"] },
    { href: "/dashboard/reports", label: "Reportes", icon: BarChart3, roles: ["SuperAdmin", "Responsable_Editorial"] },
  ];

  const adminNav = [
    { href: "/dashboard/organizations", label: "Organizaciones", icon: Building2, roles: ["SuperAdmin", "Responsable_Editorial"] },
    { href: "/dashboard/criteria", label: "Criterios Editoriales", icon: BookOpen, roles: ["SuperAdmin", "Responsable_Editorial"] },
    { href: "/dashboard/settings", label: "Configuración", icon: Settings, roles: ["SuperAdmin", "Responsable_Editorial"] },
  ];

  const isActive = (href: string) => {
    if (href === "/dashboard") return pathname === "/dashboard";
    return pathname.startsWith(href);
  };

  // When impersonating, show the impersonated role's nav. SuperAdmin's own nav is always shown when not impersonating.
  const effectiveRole = role;

  const renderNavItem = (item: typeof mainNav[0]) => {
    if (item.roles && !item.roles.includes(effectiveRole || "")) return null;
    const Icon = item.icon;
    const active = isActive(item.href);

    return (
      <Link key={item.href} href={item.href} className={`sidebar-link ${active ? "active" : ""}`}>
        <Icon size={18} strokeWidth={1.75} />
        {item.label}
      </Link>
    );
  };

  const showAdminNav = effectiveRole === "SuperAdmin" || effectiveRole === "Responsable_Editorial";

  return (
    <div style={{ display: "flex", minHeight: "100vh", flexDirection: "column" }}>

      {/* ── IMPERSONATION BANNER ── */}
      {impersonated && (
        <div style={{
          position: "sticky", top: 0, zIndex: 1000,
          backgroundColor: "#f59e0b", color: "#1c1a12",
          padding: "0.625rem 1.5rem",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          fontSize: "0.8125rem", fontWeight: 600, gap: "1rem",
          boxShadow: "0 2px 8px rgba(245,158,11,0.4)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.625rem" }}>
            <Eye size={16} style={{ flexShrink: 0 }} />
            <span>
              Viendo como{" "}
              <strong>{impersonated.displayName ?? impersonated.email}</strong>
              {" "}—{" "}
              <span style={{ opacity: 0.85 }}>{ROLE_LABELS[impersonated.role] ?? impersonated.role}</span>
            </span>
          </div>
          <button
            onClick={stopImpersonation}
            style={{
              display: "flex", alignItems: "center", gap: "0.375rem",
              background: "rgba(0,0,0,0.15)", border: "none", borderRadius: "var(--radius-md)",
              padding: "0.3rem 0.75rem", cursor: "pointer", fontWeight: 700,
              color: "#1c1a12", fontSize: "0.8125rem",
            }}
          >
            <X size={13} /> Salir de la vista
          </button>
        </div>
      )}

      <div style={{ display: "flex", flex: 1 }}>
        {/* ── SIDEBAR ── */}
        <aside className="sidebar">
          {/* Brand */}
          <div className="sidebar-brand">
            <h2 style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <FileCheck size={22} strokeWidth={2} />
              CalíopeBot
            </h2>
            <span className="role-tag" style={impersonated ? { backgroundColor: "rgba(245,158,11,0.18)", color: "#f59e0b" } : {}}>
              {ROLE_LABELS[effectiveRole ?? ""] ?? effectiveRole ?? "Cargando..."}
            </span>
          </div>

          {/* Main Nav */}
          <nav>
            <div className="nav-section-label">Principal</div>
            {mainNav.map(renderNavItem)}

            {/* Notifications — visible to all */}
            <Link
              href="/dashboard/notifications"
              className={`sidebar-link ${pathname === "/dashboard/notifications" ? "active" : ""}`}
              style={{ position: "relative" }}
            >
              <Bell size={18} strokeWidth={1.75} />
              Notificaciones
              {unreadCount > 0 && (
                <span style={{
                  marginLeft: "auto",
                  backgroundColor: "var(--primary)",
                  color: "#fff",
                  fontSize: "0.65rem",
                  fontWeight: 700,
                  padding: "0.1rem 0.4rem",
                  borderRadius: "99px",
                  lineHeight: 1.4,
                }}>
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              )}
            </Link>

            {showAdminNav && (
              <>
                <div className="nav-section-label" style={{ marginTop: "1rem" }}>Administración</div>
                {adminNav.map(renderNavItem)}
              </>
            )}
          </nav>

          {/* Footer */}
          <div className="sidebar-footer">
            <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "0.25rem" }}>
              {impersonated ? (
                <span style={{ color: "#f59e0b", fontWeight: 600 }}>
                  👁 Tú: {user.email}
                </span>
              ) : (
                user.email
              )}
            </div>
            {impersonated && (
              <div className="user-email" style={{ marginBottom: "0.5rem" }}>
                {impersonated.email}
              </div>
            )}
            <button onClick={handleLogout} className="btn-logout">
              <LogOut size={14} strokeWidth={1.75} />
              Cerrar Sesión
            </button>
          </div>
        </aside>

        {/* ── MAIN CONTENT ── */}
        <main style={{ flex: 1, backgroundColor: "var(--bg-color)", overflowY: "auto" }}>
          {children}
        </main>
      </div>
    </div>
  );
}
