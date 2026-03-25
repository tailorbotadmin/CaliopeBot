"use client";

import { useAuth } from "@/lib/auth-context";

export default function DashboardPage() {
  const { role, user } = useAuth();

  return (
    <div className="fade-in" style={{ padding: "2rem", maxWidth: "1200px", margin: "0 auto" }}>
      <header style={{ marginBottom: "2rem" }}>
        <h1 style={{ fontSize: "2rem", fontWeight: 700, marginBottom: "0.5rem" }}>Bienvenido, {user?.email}</h1>
        <p style={{ color: "var(--text-muted)" }}>Estás conectado bajo el rol de <strong>{role || "Autor"}</strong>.</p>
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: "1.5rem" }}>
        
        {/* Books Card */}
        <div className="card">
          <h3 style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: "0.5rem" }}>Mis Manuscritos</h3>
          <p style={{ color: "var(--text-muted)", fontSize: "0.875rem", marginBottom: "1rem" }}>
            Accede a los documentos asignados para revisión.
          </p>
          <a href="/dashboard/editor" className="btn">Ir al Editor</a>
        </div>

        {/* Admin Card */}
        {(role === "SuperAdmin" || role === "Admin" || role === "Responsable Editorial") && (
          <div className="card">
            <h3 style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: "0.5rem" }}>Importación Batches</h3>
            <p style={{ color: "var(--text-muted)", fontSize: "0.875rem", marginBottom: "1rem" }}>
              Carga documentos Word (.docx) masivamente para procesamiento IA.
            </p>
            <button className="btn btn-secondary">Subir Documentos</button>
          </div>
        )}

        {(role === "SuperAdmin" || role === "Admin") && (
          <div className="card">
            <h3 style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: "0.5rem" }}>Gestión de Estilos</h3>
            <p style={{ color: "var(--text-muted)", fontSize: "0.875rem", marginBottom: "1rem" }}>
              Configura los manuales RAE/Fundéu y criterios RAG de la editorial.
            </p>
            <button className="btn btn-secondary">Configurar Estilos</button>
          </div>
        )}
      </div>
    </div>
  );
}
