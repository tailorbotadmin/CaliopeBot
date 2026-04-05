"use client";

import { useAuth } from "@/lib/auth-context";
import Link from "next/link";
import { FileText, Clock, Target, PenLine, FolderOpen, Palette } from "lucide-react";

export default function DashboardPage() {
  const { role, user } = useAuth();

  const stats = [
    { label: "Manuscritos Activos", value: "—", icon: FileText, color: "var(--primary-light)" },
    { label: "Correcciones Pendientes", value: "—", icon: Clock, color: "rgba(245, 158, 11, 0.1)" },
    { label: "Precisión IA", value: "—", icon: Target, color: "rgba(16, 185, 129, 0.1)" },
  ];

  return (
    <div className="fade-in" style={{ padding: "2.5rem", maxWidth: "1100px", margin: "0 auto" }}>
      {/* Welcome Header */}
      <div className="page-header" style={{ flexDirection: "column", alignItems: "flex-start", gap: "0.25rem" }}>
        <h1>Bienvenido de vuelta</h1>
        <p>Rol activo: <strong style={{ color: "var(--primary)" }}>{role || "Autor"}</strong> · {user?.email}</p>
      </div>

      {/* Stats Row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "1rem", marginBottom: "2rem" }}>
        {stats.map((s) => {
          const Icon = s.icon;
          return (
            <div key={s.label} className="card-static" style={{ display: "flex", alignItems: "center", gap: "1rem", padding: "1.25rem" }}>
              <div style={{ width: "44px", height: "44px", borderRadius: "var(--radius-lg)", backgroundColor: s.color, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <Icon size={20} strokeWidth={1.75} style={{ color: "var(--text-main)" }} />
              </div>
              <div>
                <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "var(--text-main)", lineHeight: 1.2 }}>{s.value}</div>
                <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.125rem" }}>{s.label}</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Quick Actions */}
      <h2 style={{ fontSize: "1.125rem", fontWeight: 700, color: "var(--text-main)", marginBottom: "1rem" }}>Acciones rápidas</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: "1.25rem" }}>

        {/* Corrections Card */}
        <div className="card" style={{ padding: "1.75rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.75rem" }}>
            <PenLine size={22} strokeWidth={1.75} style={{ color: "var(--primary)" }} />
            <h3 style={{ fontSize: "1.125rem", fontWeight: 700, color: "var(--text-main)" }}>Mis Correcciones</h3>
          </div>
          <p style={{ color: "var(--text-muted)", fontSize: "0.875rem", marginBottom: "1.25rem", lineHeight: 1.6 }}>
            Revisa las sugerencias de la IA y aprueba, edita o rechaza cada corrección.
          </p>
          <Link href="/dashboard/corrections" className="btn" style={{ textDecoration: "none" }}>
            Ver Correcciones
          </Link>
        </div>

        {/* Manuscripts Card */}
        <div className="card" style={{ padding: "1.75rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.75rem" }}>
            <FolderOpen size={22} strokeWidth={1.75} style={{ color: "var(--primary)" }} />
            <h3 style={{ fontSize: "1.125rem", fontWeight: 700, color: "var(--text-main)" }}>Mis Manuscritos</h3>
          </div>
          <p style={{ color: "var(--text-muted)", fontSize: "0.875rem", marginBottom: "1.25rem", lineHeight: 1.6 }}>
            Importa documentos Word (.docx) para iniciar el proceso de corrección automática.
          </p>
          <Link href="/dashboard/books" className="btn btn-secondary" style={{ textDecoration: "none" }}>
            Ver Catálogo
          </Link>
        </div>

        {/* Styles Card */}
        {(role === "SuperAdmin" || role === "Admin") && (
          <div className="card" style={{ padding: "1.75rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.75rem" }}>
              <Palette size={22} strokeWidth={1.75} style={{ color: "var(--primary)" }} />
              <h3 style={{ fontSize: "1.125rem", fontWeight: 700, color: "var(--text-main)" }}>Gestión de Estilos</h3>
            </div>
            <p style={{ color: "var(--text-muted)", fontSize: "0.875rem", marginBottom: "1.25rem", lineHeight: 1.6 }}>
              Configura los manuales RAE/Fundéu y criterios RAG de la editorial.
            </p>
            <button className="btn btn-secondary">Configurar Estilos</button>
          </div>
        )}
      </div>
    </div>
  );
}
