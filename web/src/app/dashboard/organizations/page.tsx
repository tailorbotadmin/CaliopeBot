"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import { Building2 } from "lucide-react";
import { getOrganizations, createOrganization, Organization } from "@/lib/firestore";
import { useRouter } from "next/navigation";

export default function OrganizationsPage() {
  const { role, loading } = useAuth();
  const router = useRouter();
  
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [isLoadingOrgs, setIsLoadingOrgs] = useState(true);
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newOrgName, setNewOrgName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!loading) {
      if (role !== "SuperAdmin" && role !== "Admin") {
        router.push("/dashboard");
        return;
      }
      fetchOrganizations();
    }
  }, [loading, role, router]);

  const fetchOrganizations = async () => {
    try {
      const orgs = await getOrganizations();
      orgs.sort((a, b) => {
        if (!a.createdAt || !b.createdAt) return 0;
        return b.createdAt.toMillis() - a.createdAt.toMillis();
      });
      setOrganizations(orgs);
    } catch (err) {
      console.error("Error al cargar organizaciones:", err);
      setError("Permisos insuficientes o error de red al cargar organizaciones.");
    } finally {
      setIsLoadingOrgs(false);
    }
  };

  const handleCreateOrganization = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!newOrgName.trim()) {
      setError("El nombre es obligatorio.");
      return;
    }
    setIsSubmitting(true);
    try {
      await createOrganization(newOrgName.trim());
      await fetchOrganizations();
      setIsModalOpen(false);
      setNewOrgName("");
    } catch (err: any) {
      console.error(err);
      setError("Error al crear. Asegúrate de tener permisos de SuperAdmin. " + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading || isLoadingOrgs) {
    return <div style={{ padding: "2.5rem", color: "var(--text-muted)" }}>Cargando la configuración de entornos...</div>;
  }

  return (
    <div className="fade-in" style={{ padding: "2.5rem", maxWidth: "1100px", margin: "0 auto" }}>
      {/* Header */}
      <div className="page-header">
        <div>
          <h1>Entornos de Organización</h1>
          <p>Cada organización es un silo seguro de datos, libros y reglas de estilo.</p>
        </div>
        <button className="btn" style={{ padding: "0.75rem 1.5rem" }} onClick={() => setIsModalOpen(true)}>
          + Nueva Organización
        </button>
      </div>

      {error && (
        <div style={{ backgroundColor: "rgba(239, 68, 68, 0.08)", color: "var(--danger)", padding: "0.875rem 1rem", borderRadius: "var(--radius-md)", marginBottom: "1.5rem", fontSize: "0.875rem", border: "1px solid rgba(239, 68, 68, 0.15)" }}>
          {error}
        </div>
      )}

      {organizations.length === 0 ? (
        <div className="card-static" style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "4rem 2rem", textAlign: "center" }}>
          <div style={{ width: "56px", height: "56px", borderRadius: "var(--radius-lg)", backgroundColor: "var(--primary-light)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "1.25rem", color: "var(--primary)" }}>
            <Building2 size={28} strokeWidth={1.75} />
          </div>
          <h3 style={{ fontSize: "1.125rem", fontWeight: 700, color: "var(--text-main)" }}>No hay organizaciones configuradas</h3>
          <p style={{ color: "var(--text-muted)", marginTop: "0.5rem", maxWidth: "360px", fontSize: "0.875rem" }}>
            Crea el primer entorno aislado para comenzar a invitar autores y editores.
          </p>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: "1.25rem" }}>
          {organizations.map((org) => (
            <div key={org.id} className="card" style={{ padding: "1.75rem", cursor: "pointer" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "1.25rem" }}>
                <div style={{ 
                  width: "44px", height: "44px", borderRadius: "var(--radius-lg)", 
                  background: "linear-gradient(135deg, var(--primary), #F472B6)", 
                  display: "flex", alignItems: "center", justifyContent: "center", 
                  color: "white", fontSize: "1.25rem", fontWeight: 700, flexShrink: 0,
                  boxShadow: "0 4px 10px var(--primary-glow)"
                }}>
                  {org.name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <h3 style={{ fontSize: "1.0625rem", fontWeight: 700, color: "var(--text-main)" }}>{org.name}</h3>
                  <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", fontFamily: "monospace" }}>ID: {org.id.slice(0, 12)}...</p>
                </div>
              </div>
              
              <div style={{ borderTop: "1px solid var(--border-color)", paddingTop: "0.875rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span className="status-badge status-active">
                  <span style={{ width: "6px", height: "6px", borderRadius: "50%", backgroundColor: "currentColor", display: "inline-block" }}></span>
                  Activa
                </span>
                <span style={{ fontSize: "0.8125rem", fontWeight: 600, color: "var(--primary)" }}>Ver panel →</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal */}
      {isModalOpen && (
        <div className="modal-overlay">
          <div className="card fade-in modal-content">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
              <h2 style={{ fontSize: "1.25rem", fontWeight: 700, color: "var(--text-main)" }}>Nueva Organización</h2>
              <button onClick={() => setIsModalOpen(false)} className="btn-ghost" style={{ fontSize: "1.25rem", padding: "0.25rem" }}>✕</button>
            </div>
            
            <p style={{ color: "var(--text-muted)", marginBottom: "1.75rem", fontSize: "0.875rem", lineHeight: 1.6 }}>
              Se creará un nuevo <strong>Tenant RAG</strong> aislado. Todos los libros, estilos y diccionarios quedarán exclusivamente asociados a este entorno.
            </p>

            <form onSubmit={handleCreateOrganization}>
              <div style={{ marginBottom: "1.75rem" }}>
                <label style={{ display: "block", marginBottom: "0.375rem", fontSize: "0.875rem", fontWeight: 600, color: "var(--text-main)" }}>Nombre de la Editorial / Área</label>
                <input 
                  type="text" 
                  className="input" 
                  value={newOrgName}
                  onChange={(e) => setNewOrgName(e.target.value)}
                  placeholder="Ej. Anagrama, Grupo Planeta..."
                  autoFocus
                  required
                />
              </div>

              <div style={{ display: "flex", gap: "0.75rem" }}>
                <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setIsModalOpen(false)}>
                  Cancelar
                </button>
                <button type="submit" className="btn" style={{ flex: 1 }} disabled={isSubmitting}>
                  {isSubmitting ? "Creando..." : "Instanciar Entorno"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
