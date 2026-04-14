"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { auth } from "@/lib/firebase";
import { getOrgUsers, updateUserRole, UserProfile, Role } from "@/lib/firestore";
import { UserPlus, Users, ChevronDown, Trash2, RefreshCw, Eye } from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

const ROLES: { value: Role; label: string; description: string }[] = [
  { value: "Autor",                label: "Autor",                description: "Solo revisa sus manuscritos aprobados" },
  { value: "Traductor",            label: "Traductor",            description: "Flujo similar al Autor" },
  { value: "Editor",               label: "Editor",               description: "Corrige y revisa todos los documentos" },
  { value: "Responsable_Editorial",label: "Responsable Editorial",description: "Aprobación final de correcciones" },
  { value: "Admin",                label: "Administrador",        description: "Gestión total de la organización" },
];

export default function SettingsPage() {
  const { user, role, organizationId, realRole, startImpersonation } = useAuth();
  const router = useRouter();

  const [members, setMembers] = useState<UserProfile[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [updatingUid, setUpdatingUid] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({ name: "", email: "", password: "", role: "Autor" as Role });
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const isAdmin = realRole === "SuperAdmin" || realRole === "Admin";

  const fetchMembers = useCallback(async () => {
    if (!organizationId) return;
    setLoadingMembers(true);
    try {
      const users = await getOrgUsers(organizationId);
      // Put current user first, then sort by role weight
      const roleWeight: Record<string, number> = {
        SuperAdmin: 0, Admin: 1, Responsable_Editorial: 2, Editor: 3, Traductor: 4, Autor: 5,
      };
      users.sort((a, b) => (roleWeight[a.role] ?? 9) - (roleWeight[b.role] ?? 9));
      setMembers(users);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingMembers(false);
    }
  }, [organizationId]);

  useEffect(() => { fetchMembers(); }, [fetchMembers]);

  const handleImpersonate = (member: UserProfile) => {
    startImpersonation({
      uid: member.uid,
      email: member.email,
      displayName: member.displayName,
      role: member.role,
      organizationId: member.organizationId ?? null,
    });
    router.push("/dashboard");
  };

  if (!isAdmin) {
    return (
      <div style={{ padding: "3rem", textAlign: "center", color: "var(--text-muted)" }}>
        No tienes permisos para acceder a esta configuración.
      </div>
    );
  }

  const handleRoleChange = async (uid: string, newRole: Role) => {
    setUpdatingUid(uid);
    try {
      // 1. Propagate to Firebase Auth custom claims via backend (no re-login needed)
      const token = await auth.currentUser?.getIdToken(true);
      if (!token) throw new Error("Sesión no válida");

      const res = await fetch(`${API_URL}/api/v1/users/update-role`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ targetUid: uid, role: newRole }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.detail ?? "Error al cambiar el rol");

      // 2. Update local state (Firestore already updated by backend)
      setMembers(prev => prev.map(m => m.uid === uid ? { ...m, role: newRole } : m));
      setMessage({ type: "success", text: `Rol actualizado a ${newRole} correctamente.` });
    } catch (err) {
      setMessage({ type: "error", text: "Error al cambiar el rol: " + (err instanceof Error ? err.message : String(err)) });
    } finally {
      setUpdatingUid(null);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setMessage(null);
    try {
      const token = await auth.currentUser?.getIdToken(true);
      if (!token) throw new Error("Sesión no válida");

      const res = await fetch(`${API_URL}/api/v1/users/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ...formData, organizationId }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.detail ?? "Error al crear usuario");

      setMessage({ type: "success", text: `Usuario ${formData.email} creado correctamente.` });
      setFormData({ name: "", email: "", password: "", role: "Autor" });
      setShowForm(false);
      await fetchMembers();
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setCreating(false);
    }
  };

  const roleColors: Record<string, string> = {
    SuperAdmin: "#a855f7",
    Admin: "var(--primary)",
    Responsable_Editorial: "#f59e0b",
    Editor: "#10b981",
    Traductor: "#06b6d4",
    Autor: "var(--text-muted)",
  };

  return (
    <div className="fade-in" style={{ padding: "2.5rem", maxWidth: "900px", margin: "0 auto" }}>
      {/* Header */}
      <div className="page-header">
        <div>
          <h1>Gestión del Equipo</h1>
          <p>Invita miembros, asigna roles y administra permisos de tu organización.</p>
        </div>
        <div style={{ display: "flex", gap: "0.75rem" }}>
          <button className="btn btn-secondary" onClick={fetchMembers} title="Recargar">
            <RefreshCw size={15} />
          </button>
          <button className="btn" style={{ display: "flex", alignItems: "center", gap: "0.5rem" }} onClick={() => setShowForm(v => !v)}>
            <UserPlus size={16} />
            Añadir Miembro
          </button>
        </div>
      </div>

      {/* Feedback message */}
      {message && (
        <div style={{
          padding: "0.875rem 1rem", marginBottom: "1.5rem", borderRadius: "var(--radius-md)", fontSize: "0.875rem",
          backgroundColor: message.type === "success" ? "rgba(16,185,129,0.08)" : "rgba(239,68,68,0.08)",
          color: message.type === "success" ? "var(--success)" : "var(--danger)",
          border: `1px solid ${message.type === "success" ? "rgba(16,185,129,0.2)" : "rgba(239,68,68,0.2)"}`,
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          {message.text}
          <button onClick={() => setMessage(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", fontSize: "1rem" }}>✕</button>
        </div>
      )}

      {/* Create User Form */}
      {showForm && (
        <div className="card fade-in" style={{ padding: "2rem", marginBottom: "2rem", borderColor: "var(--primary)" }}>
          <h2 style={{ fontSize: "1.125rem", fontWeight: 700, marginBottom: "1.5rem", color: "var(--text-main)" }}>
            Nuevo Miembro
          </h2>
          <form onSubmit={handleCreateUser}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.25rem", marginBottom: "1.25rem" }}>
              <div>
                <label className="label">Nombre Completo</label>
                <input type="text" className="input" placeholder="Ana García" required
                  value={formData.name} onChange={e => setFormData(p => ({ ...p, name: e.target.value }))} />
              </div>
              <div>
                <label className="label">Correo Electrónico</label>
                <input type="email" className="input" placeholder="ana@editorial.com" required
                  value={formData.email} onChange={e => setFormData(p => ({ ...p, email: e.target.value }))} />
              </div>
              <div>
                <label className="label">Contraseña Temporal</label>
                <input type="password" className="input" placeholder="Mínimo 6 caracteres" required minLength={6}
                  value={formData.password} onChange={e => setFormData(p => ({ ...p, password: e.target.value }))} />
              </div>
              <div>
                <label className="label">Rol</label>
                <select className="input" value={formData.role}
                  onChange={e => setFormData(p => ({ ...p, role: e.target.value as Role }))}
                  style={{ backgroundColor: "var(--card-bg)" }}>
                  {ROLES.filter(r => r.value !== "Admin" || role === "SuperAdmin").map(r => (
                    <option key={r.value} value={r.value}>{r.label} — {r.description}</option>
                  ))}
                </select>
              </div>
            </div>
            <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end" }}>
              <button type="button" className="btn btn-secondary" onClick={() => setShowForm(false)}>Cancelar</button>
              <button type="submit" className="btn" disabled={creating}>
                {creating ? "Creando..." : "Crear Usuario"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Members List */}
      <div className="card-static" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "1.25rem 1.75rem", borderBottom: "1px solid var(--border-color)", display: "flex", alignItems: "center", gap: "0.625rem" }}>
          <Users size={18} style={{ color: "var(--text-muted)" }} />
          <span style={{ fontWeight: 600, color: "var(--text-main)", fontSize: "0.9375rem" }}>
            Miembros del equipo
          </span>
          <span style={{ marginLeft: "auto", fontSize: "0.8125rem", color: "var(--text-muted)", backgroundColor: "var(--primary-light)", padding: "0.125rem 0.625rem", borderRadius: "99px" }}>
            {members.length}
          </span>
        </div>

        {loadingMembers ? (
          <div style={{ padding: "3rem", textAlign: "center", color: "var(--text-muted)" }}>Cargando equipo...</div>
        ) : members.length === 0 ? (
          <div style={{ padding: "3rem", textAlign: "center", color: "var(--text-muted)" }}>
            Aún no hay miembros en esta organización. Añade el primero.
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border-color)" }}>
                {["Miembro", "Correo", "Rol", ""].map(h => (
                  <th key={h} style={{ padding: "0.75rem 1.75rem", textAlign: "left", fontSize: "0.75rem", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {members.map((member, i) => {
                const isMe = member.uid === user?.uid;
                const canEdit = (role === "SuperAdmin") || (role === "Admin" && member.role !== "SuperAdmin" && member.role !== "Admin");
                return (
                  <tr key={member.uid} style={{ borderBottom: i < members.length - 1 ? "1px solid var(--border-color)" : "none", backgroundColor: isMe ? "rgba(99,102,241,0.03)" : "transparent" }}>
                    {/* Name */}
                    <td style={{ padding: "1rem 1.75rem" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                        <div style={{
                          width: "36px", height: "36px", borderRadius: "50%", flexShrink: 0,
                          background: `linear-gradient(135deg, ${roleColors[member.role] ?? "var(--primary)"}, #F472B6)`,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          color: "white", fontWeight: 700, fontSize: "0.875rem",
                        }}>
                          {(member.displayName ?? member.email).charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: "0.9rem", color: "var(--text-main)" }}>
                            {member.displayName ?? "—"}
                            {isMe && <span style={{ marginLeft: "0.5rem", fontSize: "0.7rem", color: "var(--primary)", fontWeight: 500 }}>Tú</span>}
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* Email */}
                    <td style={{ padding: "1rem 1.75rem", fontSize: "0.875rem", color: "var(--text-muted)" }}>
                      {member.email}
                    </td>

                    {/* Role selector */}
                    <td style={{ padding: "1rem 1.75rem" }}>
                      {canEdit && !isMe ? (
                        <div style={{ position: "relative", display: "inline-block" }}>
                          <select
                            value={member.role}
                            disabled={updatingUid === member.uid}
                            onChange={e => handleRoleChange(member.uid, e.target.value as Role)}
                            style={{
                              appearance: "none", cursor: "pointer", padding: "0.375rem 2rem 0.375rem 0.75rem",
                              borderRadius: "var(--radius-md)", fontSize: "0.8125rem", fontWeight: 600,
                              border: "1px solid var(--border-color)", backgroundColor: "var(--card-bg)",
                              color: roleColors[member.role] ?? "var(--text-main)",
                              opacity: updatingUid === member.uid ? 0.5 : 1,
                            }}
                          >
                            {ROLES.filter(r => r.value !== "Admin" || role === "SuperAdmin").map(r => (
                              <option key={r.value} value={r.value}>{r.label}</option>
                            ))}
                          </select>
                          <ChevronDown size={12} style={{ position: "absolute", right: "0.5rem", top: "50%", transform: "translateY(-50%)", pointerEvents: "none", color: "var(--text-muted)" }} />
                        </div>
                      ) : (
                        <span style={{ fontSize: "0.8125rem", fontWeight: 600, color: roleColors[member.role] ?? "var(--text-muted)" }}>
                          {ROLES.find(r => r.value === member.role)?.label ?? member.role}
                        </span>
                      )}
                    </td>

                    {/* Actions */}
                    <td style={{ padding: "1rem 1.75rem", textAlign: "right" }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "0.5rem" }}>
                        {/* Impersonate — SuperAdmin only, not on own row */}
                        {realRole === "SuperAdmin" && !isMe && (
                          <button
                            title={`Ver dashboard como ${member.displayName ?? member.email}`}
                            onClick={() => handleImpersonate(member)}
                            style={{
                              display: "flex", alignItems: "center", gap: "0.375rem",
                              padding: "0.35rem 0.75rem", borderRadius: "var(--radius-md)",
                              border: "1px solid var(--border-color)", backgroundColor: "transparent",
                              cursor: "pointer", fontSize: "0.75rem", fontWeight: 600,
                              color: "var(--text-muted)", transition: "all 0.15s",
                            }}
                            onMouseEnter={e => {
                              (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--primary)";
                              (e.currentTarget as HTMLButtonElement).style.color = "var(--primary)";
                              (e.currentTarget as HTMLButtonElement).style.backgroundColor = "var(--primary-light)";
                            }}
                            onMouseLeave={e => {
                              (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--border-color)";
                              (e.currentTarget as HTMLButtonElement).style.color = "var(--text-muted)";
                              (e.currentTarget as HTMLButtonElement).style.backgroundColor = "transparent";
                            }}
                          >
                            <Eye size={13} /> Ver como
                          </button>
                        )}
                        {canEdit && !isMe && (
                          <button
                            title="Eliminar usuario (próximamente)"
                            style={{ background: "none", border: "none", cursor: "not-allowed", color: "var(--text-muted)", opacity: 0.4, padding: "0.25rem" }}
                            disabled
                          >
                            <Trash2 size={15} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Info block */}
      <div style={{ marginTop: "1.5rem", padding: "1rem 1.25rem", backgroundColor: "rgba(99,102,241,0.06)", borderRadius: "var(--radius-md)", borderLeft: "3px solid var(--primary)", fontSize: "0.8125rem", color: "var(--text-muted)", lineHeight: 1.6 }}>
        <strong style={{ color: "var(--text-main)" }}>Nota:</strong> Los cambios de rol son inmediatos en Firestore, pero el usuario deberá cerrar sesión y volver a entrar para que el nuevo rol se aplique en su token de autenticación.
      </div>
    </div>
  );
}
