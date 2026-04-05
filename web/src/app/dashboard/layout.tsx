"use client";

import { useAuth } from "@/lib/auth-context";
import { useRouter, usePathname } from "next/navigation";
import { useEffect } from "react";
import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";
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
} from "lucide-react";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, role, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

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
    signOut(auth);
    router.push("/");
  };

  const mainNav = [
    { href: "/dashboard", label: "Panel", icon: LayoutDashboard, roles: null },
    { href: "/dashboard/corrections", label: "Mis Correcciones", icon: FileCheck, roles: null },
    { href: "/dashboard/books", label: "Mis Manuscritos", icon: BookOpen, roles: null },
    { href: "/dashboard/training", label: "Entrenamiento", icon: GraduationCap, roles: ["SuperAdmin", "Admin", "Responsable Editorial"] },
    { href: "/dashboard/reports", label: "Reportes", icon: BarChart3, roles: ["SuperAdmin", "Admin", "Responsable Editorial"] },
  ];

  const adminNav = [
    { href: "/dashboard/organizations", label: "Organizaciones", icon: Building2, roles: ["SuperAdmin", "Admin"] },
    { href: "/dashboard/criteria", label: "Criterios Editoriales", icon: BookOpen, roles: ["SuperAdmin", "Admin", "Responsable Editorial"] },
    { href: "/dashboard/settings", label: "Configuración", icon: Settings, roles: ["SuperAdmin", "Admin"] },
  ];

  const isActive = (href: string) => {
    if (href === "/dashboard") return pathname === "/dashboard";
    return pathname.startsWith(href);
  };

  const renderNavItem = (item: typeof mainNav[0]) => {
    if (item.roles && !item.roles.includes(role || "")) return null;
    const Icon = item.icon;
    const active = isActive(item.href);

    return (
      <Link
        key={item.href}
        href={item.href}
        className={`sidebar-link ${active ? "active" : ""}`}
      >
        <Icon size={18} strokeWidth={1.75} />
        {item.label}
      </Link>
    );
  };

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <aside className="sidebar">
        {/* Brand */}
        <div className="sidebar-brand">
          <h2 style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <FileCheck size={22} strokeWidth={2} />
            CalíopeBot
          </h2>
          <span className="role-tag">{role || "Cargando..."}</span>
        </div>

        {/* Main Nav */}
        <nav>
          <div className="nav-section-label">Principal</div>
          {mainNav.map(renderNavItem)}

          {/* Admin Section */}
          {(role === "SuperAdmin" || role === "Admin") && (
            <>
              <div className="nav-section-label" style={{ marginTop: "1rem" }}>Administración</div>
              {adminNav.map(renderNavItem)}
            </>
          )}
        </nav>

        {/* Footer */}
        <div className="sidebar-footer">
          <div className="user-email">{user.email}</div>
          <button onClick={handleLogout} className="btn-logout">
            <LogOut size={14} strokeWidth={1.75} />
            Cerrar Sesión
          </button>
        </div>
      </aside>

      <main style={{ flex: 1, backgroundColor: "var(--bg-color)", overflowY: "auto" }}>
        {children}
      </main>
    </div>
  );
}
