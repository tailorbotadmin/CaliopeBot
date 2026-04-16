"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { auth } from "@/lib/firebase";
import { getOrgUsers, UserProfile, Role, getOrganizations, Organization } from "@/lib/firestore";
import { db } from "@/lib/firebase";
import { doc, deleteDoc, collection, getDocs } from "firebase/firestore";
import { UserPlus, Users, ChevronDown, Trash2, RefreshCw, Eye, Shield, AlertTriangle } from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

const ROLES: { value: Role; label: string; description: string }[] = [
  { value: "Autor",                label: "Autor",                description: "Solo revisa sus manuscritos aprobados" },
  { value: "Traductor",            label: "Traductor",            description: "Flujo similar al Autor" },
  { value: "Editor",               label: "Editor",               description: "Corrige y revisa todos los documentos" },
  { value: "Responsable_Editorial",label: "Responsable Editorial",description: "Aprobación final de correcciones" },
  { value: "Admin",                label: "Administrador",        description: "Gestión total de la organización" },
];

export default function SettingsPage() {
  const { user, role, organizationId, realRole, startImpersonation, impersonated } = useAuth();
  const router = useRouter();

  const [members, setMembers] = useState<UserProfile[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [updatingUid, setUpdatingUid] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({ name: "", email: "", password: "", role: "Autor" as Role });
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // SuperAdmin: impersonate any org+role
  const [allOrgs, setAllOrgs] = useState<Organization[]>([]);
  const [impersonateOrgId, setImpersonateOrgId] = useState("");
  const [impersonateRole, setImpersonateRole] = useState<Role>("Editor");
  const [deletingOrg, setDeletingOrg] = useState(false);

  const isAdmin = realRole === "SuperAdmin" || realRole === "Admin";
  // SuperAdmin sections are only visible when NOT impersonating
  const isSuperAdmin = realRole === "SuperAdmin" && !impersonated;

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

  // Load all orgs for SuperAdmin impersonation
  useEffect(() => {
    if (realRole === "SuperAdmin" && !impersonated) {
      getOrganizations().then(orgs => {
        setAllOrgs(orgs);
        if (orgs.length > 0) setImpersonateOrgId(orgs[0].id);
      }).catch(() => {});
    }
  }, [realRole]);

  const handleImpersonateOrgRole = () => {
    const org = allOrgs.find(o => o.id === impersonateOrgId);
    if (!org) return;
    startImpersonation({
      uid: user!.uid, // keep real uid
      email: user!.email!,
      displayName: `${user!.displayName ?? user!.email} (SuperAdmin)`,
      role: impersonateRole,
      organizationId: impersonateOrgId,
    });
    router.push("/dashboard");
  };

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

  const handleDeleteOrg = async () => {
    const org = allOrgs.find(o => o.id === impersonateOrgId);
    if (!org) return;
    const confirmed = confirm(
      `⚠️ ATENCIÓN: ¿Eliminar la organización "${org.name}" permanentemente?\n\n` +
      `Se eliminarán todos sus libros, reglas editoriales, miembros y datos.\n` +
      `Esta acción NO se puede deshacer.\n\nEscribe el nombre para confirmar: ${org.name}`
    );
    if (!confirmed) return;
    setDeletingOrg(true);
    try {
      // Delete subcollections: books, rules, pendingRules
      for (const sub of ["books", "rules", "pendingRules"]) {
        const snap = await getDocs(collection(db, "organizations", org.id, sub));
        await Promise.all(snap.docs.map(d => deleteDoc(d.ref)));
      }
      await deleteDoc(doc(db, "organizations", org.id));
      setAllOrgs(prev => prev.filter(o => o.id !== org.id));
      setImpersonateOrgId(allOrgs.find(o => o.id !== org.id)?.id ?? "");
      setMessage({ type: "success", text: `Organización "${org.name}" eliminada.` });
    } catch (err) {
      setMessage({ type: "error", text: "Error eliminando organización: " + (err instanceof Error ? err.message : String(err)) });
    } finally {
      setDeletingOrg(false);
    }
  };

  if (!isAdmin) {
    return (
      <div style={{ padding: "3rem", textAlign: "center", color: "var(--text-muted)" }}>
        No tienes permisos para acceder a esta configuración.
      </div>
    );
  }

  const handleDeleteUser = async (uid: string, name: string) => {
    if (!confirm(`¿Eliminar a "${name}" de la organización? Esta acción no se puede deshacer y revocará su acceso inmediatamente.`)) return;
    setUpdatingUid(uid);
    try {
      const token = await auth.currentUser?.getIdToken(true);
      if (!token) throw new Error("Sesión no válida");

      const res = await fetch(`${API_URL}/api/v1/users/delete`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ targetUid: uid }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.detail ?? "Error al eliminar usuario");

      setMembers(prev => prev.filter(m => m.uid !== uid));
      setMessage({ type: "success", text: `Usuario "${name}" eliminado correctamente.` });
    } catch (err) {
      setMessage({ type: "error", text: "Error al eliminar: " + (err instanceof Error ? err.message : String(err)) });
    } finally {
      setUpdatingUid(null);
    }
  };

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
                        {realRole === "SuperAdmin" && !impersonated && !isMe && (
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
                            title={`Eliminar a ${member.displayName ?? member.email}`}
                            disabled={updatingUid === member.uid}
                            onClick={() => handleDeleteUser(member.uid, member.displayName ?? member.email)}
                            style={{
                              background: "none", border: "1px solid transparent", cursor: "pointer",
                              color: "var(--text-muted)", padding: "0.35rem 0.5rem",
                              borderRadius: "var(--radius-sm)", display: "flex", alignItems: "center",
                              transition: "all 0.15s",
                              opacity: updatingUid === member.uid ? 0.4 : 1,
                            }}
                            onMouseEnter={e => {
                              (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(239,68,68,0.4)";
                              (e.currentTarget as HTMLButtonElement).style.color = "var(--danger)";
                              (e.currentTarget as HTMLButtonElement).style.backgroundColor = "rgba(239,68,68,0.06)";
                            }}
                            onMouseLeave={e => {
                              (e.currentTarget as HTMLButtonElement).style.borderColor = "transparent";
                              (e.currentTarget as HTMLButtonElement).style.color = "var(--text-muted)";
                              (e.currentTarget as HTMLButtonElement).style.backgroundColor = "transparent";
                            }}
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


      {/* ── SUPERADMIN: Impersonate Org+Role ── */}
      {isSuperAdmin && (
        <div style={{ marginTop: "2rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "1rem" }}>
            <Shield size={16} style={{ color: "#a855f7" }} />
            <h2 style={{ fontSize: "1rem", fontWeight: 700, color: "var(--text-main)" }}>Impersonar sesión</h2>
            <span style={{ fontSize: "0.7rem", fontWeight: 700, padding: "0.15rem 0.5rem", borderRadius: "99px", backgroundColor: "rgba(168,85,247,0.12)", color: "#a855f7" }}>SUPERADMIN</span>
          </div>
          <div className="card-static" style={{ padding: "1.5rem", display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: "1rem", alignItems: "flex-end" }}>
            <div>
              <label style={{ display: "block", marginBottom: "0.375rem", fontWeight: 600, fontSize: "0.8125rem", color: "var(--text-muted)" }}>Organización</label>
              <select
                className="input"
                value={impersonateOrgId}
                onChange={e => setImpersonateOrgId(e.target.value)}
              >
                {allOrgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </div>
            <div>
              <label style={{ display: "block", marginBottom: "0.375rem", fontWeight: 600, fontSize: "0.8125rem", color: "var(--text-muted)" }}>Rol a simular</label>
              <select
                className="input"
                value={impersonateRole}
                onChange={e => setImpersonateRole(e.target.value as Role)}
                style={{ backgroundColor: "var(--card-bg)" }}
              >
                {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
            <button
              className="btn"
              style={{ backgroundColor: "#a855f7", borderColor: "#a855f7", display: "flex", alignItems: "center", gap: "0.375rem", whiteSpace: "nowrap" }}
              onClick={handleImpersonateOrgRole}
              disabled={!impersonateOrgId}
            >
              <Eye size={14} /> Entrar como
            </button>
          </div>
        </div>
      )}

      {/* ── SUPERADMIN: Danger Zone — Delete Org ── */}
      {isSuperAdmin && (
        <div style={{ marginTop: "2rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "1rem" }}>
            <AlertTriangle size={16} style={{ color: "#ef4444" }} />
            <h2 style={{ fontSize: "1rem", fontWeight: 700, color: "#ef4444" }}>Zona de peligro</h2>
          </div>
          <div className="card-static" style={{ padding: "1.5rem", borderColor: "rgba(239,68,68,0.3)", display: "flex", alignItems: "center", gap: "1.5rem", flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: "200px" }}>
              <p style={{ fontWeight: 600, color: "var(--text-main)", marginBottom: "0.25rem" }}>Eliminar organización</p>
              <p style={{ fontSize: "0.8125rem", color: "var(--text-muted)" }}>
                Elimina permanentemente la organización seleccionada arriba y todos sus datos (libros, normas, miembros).
              </p>
            </div>
            <button
              className="btn"
              style={{ backgroundColor: "#ef4444", borderColor: "#ef4444", display: "flex", alignItems: "center", gap: "0.375rem", whiteSpace: "nowrap" }}
              onClick={handleDeleteOrg}
              disabled={deletingOrg || !impersonateOrgId}
            >
              {deletingOrg
                ? <><RefreshCw size={14} style={{ animation: "spin 1s linear infinite" }} />Eliminando...</>
                : <><Trash2 size={14} />Eliminar organización</>}
            </button>
          </div>
        </div>
      )}

      {/* Info block */}
      <div style={{ marginTop: "1.5rem", padding: "1rem 1.25rem", backgroundColor: "rgba(99,102,241,0.06)", borderRadius: "var(--radius-md)", borderLeft: "3px solid var(--primary)", fontSize: "0.8125rem", color: "var(--text-muted)", lineHeight: 1.6 }}>
        <strong style={{ color: "var(--text-main)" }}>Nota:</strong> Los cambios de rol son inmediatos en Firestore, pero el usuario deberá cerrar sesión y volver a entrar para que el nuevo rol se aplique en su token de autenticación.
      </div>
    </div>
  );
}
