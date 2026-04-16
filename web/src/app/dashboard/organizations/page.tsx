"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import { Building2, Users, UserPlus, ChevronDown, ChevronUp, Loader2, X, Shield, Mail } from "lucide-react";
import { getOrganizations, createOrganization, getOrgUsers, Organization, UserProfile, Role } from "@/lib/firestore";
import { useRouter } from "next/navigation";

const ROLES: Role[] = ["Responsable_Editorial", "Editor", "Autor", "Traductor"];

const ROLE_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  SuperAdmin:            { label: "SuperAdmin",          color: "#a855f7", bg: "rgba(168,85,247,0.1)" },
  Admin:                 { label: "Admin (legacy)",       color: "var(--primary)", bg: "var(--primary-light)" },
  Responsable_Editorial: { label: "Resp. Editorial",      color: "var(--primary)", bg: "var(--primary-light)" },
  Editor:               { label: "Editor",             color: "#6366f1", bg: "rgba(99,102,241,0.1)" },
  Autor:                { label: "Autor",              color: "#06b6d4", bg: "rgba(6,182,212,0.1)" },
  Traductor:            { label: "Traductor",          color: "#f59e0b", bg: "rgba(245,158,11,0.12)" },
};

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export default function OrganizationsPage() {
  const { role, loading, user } = useAuth();
  const router = useRouter();

  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [isLoadingOrgs, setIsLoadingOrgs] = useState(true);
  const [expandedOrgId, setExpandedOrgId] = useState<string | null>(null);
  const [orgMembers, setOrgMembers] = useState<Record<string, UserProfile[]>>({});
  const [loadingMembers, setLoadingMembers] = useState<string | null>(null);
  const [updatingRole, setUpdatingRole] = useState<string | null>(null);

  // Modals
  const [isNewOrgModalOpen, setIsNewOrgModalOpen] = useState(false);
  const [newOrgName, setNewOrgName] = useState("");
  const [isSubmittingOrg, setIsSubmittingOrg] = useState(false);

  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
  const [inviteOrgId, setInviteOrgId] = useState("");
  const [inviteForm, setInviteForm] = useState({ name: "", email: "", password: "", role: "Editor" as Role });
  const [isSubmittingInvite, setIsSubmittingInvite] = useState(false);

  const [error, setError] = useState("");
  const [inviteError, setInviteError] = useState("");
  const [inviteSuccess, setInviteSuccess] = useState("");

  useEffect(() => {
    if (!loading) {
      if (role !== "SuperAdmin" && role !== "Responsable_Editorial") {
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

  const handleToggleOrg = async (orgId: string) => {
    if (expandedOrgId === orgId) {
      setExpandedOrgId(null);
      return;
    }
    setExpandedOrgId(orgId);
    if (!orgMembers[orgId]) {
      setLoadingMembers(orgId);
      try {
        const members = await getOrgUsers(orgId);
        setOrgMembers((prev) => ({ ...prev, [orgId]: members }));
      } catch (e) {
        console.error("Error loading members:", e);
      } finally {
        setLoadingMembers(null);
      }
    }
  };

  const handleCreateOrganization = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!newOrgName.trim()) { setError("El nombre es obligatorio."); return; }
    setIsSubmittingOrg(true);
    try {
      await createOrganization(newOrgName.trim());
      await fetchOrganizations();
      setIsNewOrgModalOpen(false);
      setNewOrgName("");
    } catch (err) {
      setError("Error al crear: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setIsSubmittingOrg(false);
    }
  };

  const handleOpenInvite = (orgId: string) => {
    setInviteOrgId(orgId);
    setInviteForm({ name: "", email: "", password: "", role: "Editor" });
    setInviteError("");
    setInviteSuccess("");
    setIsInviteModalOpen(true);
  };

  const handleInviteMember = async (e: React.FormEvent) => {
    e.preventDefault();
    setInviteError("");
    setInviteSuccess("");
    if (!inviteForm.name.trim() || !inviteForm.email.trim() || !inviteForm.password.trim()) {
      setInviteError("Todos los campos son obligatorios.");
      return;
    }
    if (inviteForm.password.length < 8) {
      setInviteError("La contraseña temporal debe tener al menos 8 caracteres.");
      return;
    }
    setIsSubmittingInvite(true);
    try {
      const token = await user?.getIdToken();
      const res = await fetch(`${API_URL}/api/v1/users/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          email: inviteForm.email.trim(),
          password: inviteForm.password,
          name: inviteForm.name.trim(),
          role: inviteForm.role,
          organizationId: inviteOrgId,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail ?? "Error desconocido");
      }
      setInviteSuccess(`✓ ${inviteForm.name} ha sido añadido como ${inviteForm.role}.`);
      // Refresh members
      const members = await getOrgUsers(inviteOrgId);
      setOrgMembers((prev) => ({ ...prev, [inviteOrgId]: members }));
      setInviteForm({ name: "", email: "", password: "", role: "Editor" });
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : "Error al crear usuario.");
    } finally {
      setIsSubmittingInvite(false);
    }
  };

  const handleRoleChange = async (orgId: string, targetUid: string, newRole: Role) => {
    setUpdatingRole(targetUid);
    try {
      const token = await user?.getIdToken();
      const res = await fetch(`${API_URL}/api/v1/users/update-role`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ targetUid, role: newRole }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail ?? "Error cambiando rol");
      }
      // Refresh members
      const members = await getOrgUsers(orgId);
      setOrgMembers((prev) => ({ ...prev, [orgId]: members }));
    } catch (err) {
      alert("Error al cambiar rol: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setUpdatingRole(null);
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
        {role === "SuperAdmin" && (
          <button className="btn" style={{ padding: "0.75rem 1.5rem" }} onClick={() => setIsNewOrgModalOpen(true)}>
            + Nueva Organización
          </button>
        )}
      </div>

      {error && (
        <div style={{ backgroundColor: "rgba(239, 68, 68, 0.08)", color: "var(--danger)", padding: "0.875rem 1rem", borderRadius: "var(--radius-md)", marginBottom: "1.5rem", fontSize: "0.875rem", border: "1px solid rgba(239, 68, 68, 0.15)" }}>
          {error}
        </div>
      )}

      {/* Organizations List */}
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
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          {organizations.map((org) => {
            const isExpanded = expandedOrgId === org.id;
            const members = orgMembers[org.id] ?? [];
            const isLoadingM = loadingMembers === org.id;

            return (
              <div key={org.id} className="card" style={{ overflow: "hidden" }}>
                {/* Org Header Row */}
                <div
                  style={{ padding: "1.5rem 1.75rem", display: "flex", alignItems: "center", gap: "1rem", cursor: "pointer" }}
                  onClick={() => handleToggleOrg(org.id)}
                >
                  <div style={{
                    width: "44px", height: "44px", borderRadius: "var(--radius-lg)",
                    background: "linear-gradient(135deg, var(--primary), #F472B6)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    color: "white", fontSize: "1.25rem", fontWeight: 700, flexShrink: 0,
                    boxShadow: "0 4px 10px var(--primary-glow)",
                  }}>
                    {org.name.charAt(0).toUpperCase()}
                  </div>
                  <div style={{ flex: 1 }}>
                    <h3 style={{ fontSize: "1.0625rem", fontWeight: 700, color: "var(--text-main)" }}>{org.name}</h3>
                    <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", fontFamily: "monospace" }}>ID: {org.id.slice(0, 14)}…</p>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                    <span style={{ display: "flex", alignItems: "center", gap: "0.375rem", fontSize: "0.8125rem", color: "var(--text-muted)" }}>
                      <Users size={14} /> Equipo
                    </span>
                    {isExpanded ? <ChevronUp size={16} style={{ color: "var(--text-muted)" }} /> : <ChevronDown size={16} style={{ color: "var(--text-muted)" }} />}
                  </div>
                </div>

                {/* Expanded: Team Panel */}
                {isExpanded && (
                  <div style={{ borderTop: "1px solid var(--border-color)", padding: "1.25rem 1.75rem 1.75rem" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem" }}>
                      <h4 style={{ fontSize: "0.9375rem", fontWeight: 700, color: "var(--text-main)", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                        <Shield size={15} style={{ color: "var(--primary)" }} /> Miembros del Equipo
                        {!isLoadingM && <span style={{ fontSize: "0.75rem", fontWeight: 400, color: "var(--text-muted)" }}>({members.length})</span>}
                      </h4>
                      <button
                        className="btn"
                        style={{ padding: "0.5rem 1rem", fontSize: "0.8125rem", display: "flex", alignItems: "center", gap: "0.375rem" }}
                        onClick={(e) => { e.stopPropagation(); handleOpenInvite(org.id); }}
                      >
                        <UserPlus size={14} /> Invitar Miembro
                      </button>
                    </div>

                    {isLoadingM ? (
                      <div style={{ textAlign: "center", padding: "2rem", color: "var(--text-muted)" }}>
                        <Loader2 size={20} style={{ animation: "spin 1s linear infinite" }} />
                      </div>
                    ) : members.length === 0 ? (
                      <div style={{ padding: "1.5rem", textAlign: "center", color: "var(--text-muted)", fontSize: "0.875rem", backgroundColor: "var(--bg-color)", borderRadius: "var(--radius-md)" }}>
                        No hay miembros todavía. Invita al primer miembro del equipo.
                      </div>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                        {members.map((member) => {
                          const rc = ROLE_CONFIG[member.role] ?? ROLE_CONFIG.Editor;
                          return (
                            <div key={member.uid} style={{ display: "flex", alignItems: "center", gap: "1rem", padding: "0.875rem 1rem", backgroundColor: "var(--bg-color)", borderRadius: "var(--radius-md)", border: "1px solid var(--border-color)" }}>
                              {/* Avatar */}
                              <div style={{ width: "36px", height: "36px", borderRadius: "50%", background: "linear-gradient(135deg, var(--primary), #818cf8)", display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontSize: "0.875rem", fontWeight: 700, flexShrink: 0 }}>
                                {(member.displayName ?? member.email).charAt(0).toUpperCase()}
                              </div>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontWeight: 600, color: "var(--text-main)", fontSize: "0.9rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                  {member.displayName ?? "—"}
                                </div>
                                <div style={{ display: "flex", alignItems: "center", gap: "0.25rem", fontSize: "0.75rem", color: "var(--text-muted)" }}>
                                  <Mail size={11} /> {member.email}
                                </div>
                              </div>
                              {/* Role badge + selector */}
                              <div style={{ flexShrink: 0 }}>
                                {member.role === "SuperAdmin" ? (
                                  <span style={{ padding: "0.2rem 0.625rem", borderRadius: "99px", fontSize: "0.7rem", fontWeight: 700, backgroundColor: rc.bg, color: rc.color }}>
                                    {rc.label}
                                  </span>
                                ) : (
                                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                                    {updatingRole === member.uid && <Loader2 size={13} style={{ animation: "spin 1s linear infinite", color: "var(--text-muted)" }} />}
                                    <select
                                      className="input"
                                      value={member.role}
                                      style={{ padding: "0.25rem 0.5rem", fontSize: "0.8rem", marginBottom: 0, minWidth: "140px", borderColor: rc.color, color: rc.color, fontWeight: 600 }}
                                      disabled={updatingRole === member.uid}
                                      onChange={(e) => handleRoleChange(org.id, member.uid, e.target.value as Role)}
                                    >
                                      {ROLES.map((r) => (
                                        <option key={r} value={r}>{ROLE_CONFIG[r]?.label ?? r}</option>
                                      ))}
                                    </select>
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Modal: Nueva Organización */}
      {isNewOrgModalOpen && (
        <div className="modal-overlay">
          <div className="card fade-in modal-content">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
              <h2 style={{ fontSize: "1.25rem", fontWeight: 700, color: "var(--text-main)" }}>Nueva Organización</h2>
              <button onClick={() => setIsNewOrgModalOpen(false)} className="btn-ghost" style={{ fontSize: "1.25rem", padding: "0.25rem" }}><X size={18} /></button>
            </div>
            <p style={{ color: "var(--text-muted)", marginBottom: "1.75rem", fontSize: "0.875rem", lineHeight: 1.6 }}>
              Se creará un nuevo <strong>Tenant RAG</strong> aislado. Todos los libros, estilos y diccionarios quedarán exclusivamente asociados a este entorno.
            </p>
            <form onSubmit={handleCreateOrganization}>
              <div style={{ marginBottom: "1.75rem" }}>
                <label style={{ display: "block", marginBottom: "0.375rem", fontSize: "0.875rem", fontWeight: 600, color: "var(--text-main)" }}>Nombre de la Editorial / Área</label>
                <input type="text" className="input" value={newOrgName} onChange={(e) => setNewOrgName(e.target.value)} placeholder="Ej. Anagrama, Grupo Planeta..." autoFocus required />
              </div>
              {error && <div style={{ color: "var(--danger)", fontSize: "0.875rem", marginBottom: "1rem" }}>{error}</div>}
              <div style={{ display: "flex", gap: "0.75rem" }}>
                <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setIsNewOrgModalOpen(false)}>Cancelar</button>
                <button type="submit" className="btn" style={{ flex: 1 }} disabled={isSubmittingOrg}>{isSubmittingOrg ? "Creando..." : "Instanciar Entorno"}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Invitar Miembro */}
      {isInviteModalOpen && (
        <div className="modal-overlay">
          <div className="card fade-in modal-content" style={{ maxWidth: "460px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
              <h2 style={{ fontSize: "1.25rem", fontWeight: 700, color: "var(--text-main)", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <UserPlus size={20} style={{ color: "var(--primary)" }} /> Invitar Miembro
              </h2>
              <button onClick={() => setIsInviteModalOpen(false)} className="btn-ghost" style={{ padding: "0.25rem" }}><X size={18} /></button>
            </div>

            {inviteSuccess ? (
              <div style={{ padding: "1.25rem", backgroundColor: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.2)", borderRadius: "var(--radius-md)", color: "var(--success)", fontSize: "0.9rem", marginBottom: "1.25rem" }}>
                {inviteSuccess}
              </div>
            ) : null}

            <form onSubmit={handleInviteMember}>
              <div style={{ display: "grid", gap: "1rem", marginBottom: "1.5rem" }}>
                <div>
                  <label style={{ display: "block", marginBottom: "0.375rem", fontSize: "0.875rem", fontWeight: 600, color: "var(--text-main)" }}>Nombre completo</label>
                  <input type="text" className="input" value={inviteForm.name} onChange={(e) => setInviteForm(f => ({ ...f, name: e.target.value }))} placeholder="Ej. María García" required />
                </div>
                <div>
                  <label style={{ display: "block", marginBottom: "0.375rem", fontSize: "0.875rem", fontWeight: 600, color: "var(--text-main)" }}>Email</label>
                  <input type="email" className="input" value={inviteForm.email} onChange={(e) => setInviteForm(f => ({ ...f, email: e.target.value }))} placeholder="maria@editorial.com" required />
                </div>
                <div>
                  <label style={{ display: "block", marginBottom: "0.375rem", fontSize: "0.875rem", fontWeight: 600, color: "var(--text-main)" }}>Contraseña temporal</label>
                  <input type="password" className="input" value={inviteForm.password} onChange={(e) => setInviteForm(f => ({ ...f, password: e.target.value }))} placeholder="Mínimo 8 caracteres" required />
                </div>
                <div>
                  <label style={{ display: "block", marginBottom: "0.375rem", fontSize: "0.875rem", fontWeight: 600, color: "var(--text-main)" }}>Rol</label>
                  <select className="input" value={inviteForm.role} onChange={(e) => setInviteForm(f => ({ ...f, role: e.target.value as Role }))}>
                    {ROLES.map((r) => <option key={r} value={r}>{ROLE_CONFIG[r]?.label ?? r}</option>)}
                  </select>
                </div>
              </div>

              {inviteError && (
                <div style={{ color: "var(--danger)", fontSize: "0.875rem", marginBottom: "1rem", padding: "0.625rem 0.875rem", backgroundColor: "rgba(239,68,68,0.08)", borderRadius: "var(--radius-md)" }}>
                  {inviteError}
                </div>
              )}

              <div style={{ display: "flex", gap: "0.75rem" }}>
                <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setIsInviteModalOpen(false)}>Cerrar</button>
                <button type="submit" className="btn" style={{ flex: 1 }} disabled={isSubmittingInvite}>
                  {isSubmittingInvite ? <><Loader2 size={14} style={{ animation: "spin 1s linear infinite", marginRight: "0.375rem" }} />Creando...</> : "Añadir al Equipo"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
