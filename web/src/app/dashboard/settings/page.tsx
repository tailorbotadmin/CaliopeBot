"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { auth } from "@/lib/firebase";
import { sendPasswordResetEmail } from "firebase/auth";
import { getOrgUsers, UserProfile, Role, getOrganizations, Organization } from "@/lib/firestore";
import { db } from "@/lib/firebase";
import { doc, deleteDoc, collection, getDocs } from "firebase/firestore";
import {
  UserPlus, Users, ChevronDown, Trash2, RefreshCw, Eye, Shield,
  AlertTriangle, BookOpen, CreditCard, Building2, Mail,
} from "lucide-react";
import Link from "next/link";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

const ROLES: { value: Role; label: string }[] = [
  { value: "Responsable_Editorial", label: "Responsable Editorial" },
  { value: "Editor",                label: "Editor" },
  { value: "Autor",                 label: "Autor" },
];

// ── Tab definitions ──────────────────────────────────────────────
type TabId = "equipo" | "manuales" | "suscripcion" | "organizaciones" | "impersonar";

const ALL_TABS: { id: TabId; label: string; icon: React.ReactNode; superAdminOnly?: boolean }[] = [
  { id: "equipo",          label: "Gestión de Equipo",         icon: <Users size={16} /> },
  { id: "manuales",        label: "Manuales de Estilo",        icon: <BookOpen size={16} /> },
  { id: "suscripcion",     label: "Suscripción",               icon: <CreditCard size={16} /> },
  { id: "organizaciones",  label: "Gestión de Organizaciones", icon: <Building2 size={16} />, superAdminOnly: true },
  { id: "impersonar",      label: "Impersonar",                icon: <Eye size={16} />,       superAdminOnly: true },
];

export default function SettingsPage() {
  const { user, role, organizationId, realRole, startImpersonation, impersonated } = useAuth();
  const router = useRouter();

  const [activeTab, setActiveTab] = useState<TabId>("equipo");

  // Team state
  const [members, setMembers] = useState<UserProfile[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [updatingUid, setUpdatingUid] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({ name: "", email: "", password: "", role: "Autor" as Role });
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [sendingResetUid, setSendingResetUid] = useState<string | null>(null);

  // SuperAdmin state
  const [allOrgs, setAllOrgs] = useState<Organization[]>([]);
  const [impersonateOrgId, setImpersonateOrgId] = useState("");
  const [impersonateRole, setImpersonateRole] = useState<Role>("Editor");
  const [deletingOrg, setDeletingOrg] = useState(false);

  const isAdmin = realRole === "SuperAdmin" || realRole === "Responsable_Editorial";
  const isSuperAdmin = realRole === "SuperAdmin" && !impersonated;

  // Visible tabs
  const visibleTabs = ALL_TABS.filter(t => !t.superAdminOnly || isSuperAdmin);

  const roleColors: Record<string, string> = {
    SuperAdmin: "#a855f7",
    Admin: "var(--primary)",
    Responsable_Editorial: "var(--primary)",
    Editor: "#10b981",
    Autor: "var(--text-muted)",
  };

  const fetchMembers = useCallback(async () => {
    if (!organizationId) return;
    setLoadingMembers(true);
    try {
      const users = await getOrgUsers(organizationId);
      const roleWeight: Record<string, number> = {
        SuperAdmin: 0, Admin: 1, Responsable_Editorial: 1, Editor: 2, Autor: 3,
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

  useEffect(() => {
    if (isSuperAdmin) {
      getOrganizations().then(orgs => {
        setAllOrgs(orgs);
        if (orgs.length > 0) setImpersonateOrgId(orgs[0].id);
      }).catch(() => {});
    }
  }, [isSuperAdmin]);

  const handleImpersonateOrgRole = () => {
    const org = allOrgs.find(o => o.id === impersonateOrgId);
    if (!org) return;
    startImpersonation({
      uid: user!.uid,
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
      `Esta acción NO se puede deshacer.`
    );
    if (!confirmed) return;
    setDeletingOrg(true);
    try {
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

  const handleSendResetLink = async (email: string, uid: string) => {
    setSendingResetUid(uid);
    try {
      await sendPasswordResetEmail(auth, email);
      setMessage({ type: "success", text: `✉️ Enlace de acceso enviado a ${email}. El usuario puede hacer clic en él para establecer su contraseña.` });
    } catch (err) {
      setMessage({ type: "error", text: "Error al enviar el enlace: " + (err instanceof Error ? err.message : String(err)) });
    } finally {
      setSendingResetUid(null);
    }
  };

  const handleDeleteUser = async (uid: string, name: string) => {
    if (!confirm(`¿Eliminar a "${name}" de la organización? Esta acción no se puede deshacer.`)) return;
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
      const token = await auth.currentUser?.getIdToken(true);
      if (!token) throw new Error("Sesión no válida");
      const res = await fetch(`${API_URL}/api/v1/users/update-role`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ targetUid: uid, role: newRole }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.detail ?? "Error al cambiar el rol");
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

  if (!isAdmin) {
    return (
      <div style={{ padding: "3rem", textAlign: "center", color: "var(--text-muted)" }}>
        No tienes permisos para acceder a esta configuración.
      </div>
    );
  }

  // ── Tab contents ─────────────────────────────────────────────────

  const renderEquipo = () => (
    <div>
      <div className="page-header" style={{ marginBottom: "1.5rem" }}>
        <div>
          <h2 style={{ fontSize: "1.25rem", fontWeight: 700, color: "var(--text-main)", margin: 0 }}>Gestión de Equipo</h2>
          <p style={{ marginTop: "0.25rem" }}>Invita miembros, asigna roles y administra permisos.</p>
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

      {showForm && (
        <div className="card fade-in" style={{ padding: "2rem", marginBottom: "2rem", borderColor: "var(--primary)" }}>
          <h3 style={{ fontSize: "1.125rem", fontWeight: 700, marginBottom: "1.5rem" }}>Nuevo Miembro</h3>
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
                  {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </div>
            </div>
            <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end" }}>
              <button type="button" className="btn btn-secondary" onClick={() => setShowForm(false)}>Cancelar</button>
              <button type="submit" className="btn" disabled={creating}>{creating ? "Creando..." : "Crear Usuario"}</button>
            </div>
          </form>
        </div>
      )}

      <div className="card-static" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "1.25rem 1.75rem", borderBottom: "1px solid var(--border-color)", display: "flex", alignItems: "center", gap: "0.625rem" }}>
          <Users size={18} style={{ color: "var(--text-muted)" }} />
          <span style={{ fontWeight: 600, fontSize: "0.9375rem" }}>Miembros del equipo</span>
          <span style={{ marginLeft: "auto", fontSize: "0.8125rem", color: "var(--text-muted)", backgroundColor: "var(--primary-light)", padding: "0.125rem 0.625rem", borderRadius: "99px" }}>
            {members.length}
          </span>
        </div>
        {loadingMembers ? (
          <div style={{ padding: "3rem", textAlign: "center", color: "var(--text-muted)" }}>Cargando equipo...</div>
        ) : members.length === 0 ? (
          <div style={{ padding: "3rem", textAlign: "center", color: "var(--text-muted)" }}>
            Aún no hay miembros. Añade el primero.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {members.map((member, i) => {
              const isMe = member.uid === user?.uid;
              const canEdit = (role === "SuperAdmin")
                || ((role === "Responsable_Editorial")
                  && member.role !== "SuperAdmin" && member.role !== "Responsable_Editorial");
              return (
                <div key={member.uid} style={{
                  borderBottom: i < members.length - 1 ? "1px solid var(--border-color)" : "none",
                  padding: "0.875rem 1.25rem",
                  backgroundColor: isMe ? "rgba(99,102,241,0.03)" : "transparent",
                  display: "flex", flexDirection: "column", gap: "0.625rem",
                }}>
                  {/* Fila 1: avatar + nombre + email */}
                  <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", minWidth: 0 }}>
                    <div style={{
                      width: "36px", height: "36px", borderRadius: "50%", flexShrink: 0,
                      background: `linear-gradient(135deg, ${roleColors[member.role] ?? "var(--primary)"}, #F472B6)`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      color: "white", fontWeight: 700, fontSize: "0.875rem",
                    }}>
                      {(member.displayName ?? member.email).charAt(0).toUpperCase()}
                    </div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: "0.9rem", color: "var(--text-main)", display: "flex", alignItems: "center", gap: "0.375rem", flexWrap: "wrap" }}>
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {member.displayName ?? "—"}
                        </span>
                        {isMe && <span style={{ fontSize: "0.7rem", color: "var(--primary)", fontWeight: 500, flexShrink: 0 }}>Tú</span>}
                      </div>
                      <div style={{ fontSize: "0.775rem", color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {member.email}
                      </div>
                    </div>
                  </div>

                  {/* Fila 2: selector de rol (izquierda) + acciones (derecha) */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem", flexWrap: "wrap" }}>
                    <div style={{ flexShrink: 0 }}>
                      {canEdit && !isMe ? (
                        <div style={{ position: "relative", display: "inline-block" }}>
                          <select value={member.role} disabled={updatingUid === member.uid}
                            onChange={e => handleRoleChange(member.uid, e.target.value as Role)}
                            style={{
                              appearance: "none", cursor: "pointer", padding: "0.3rem 1.75rem 0.3rem 0.625rem",
                              borderRadius: "var(--radius-md)", fontSize: "0.8rem", fontWeight: 600,
                              border: `1px solid ${roleColors[member.role] ?? "var(--border-color)"}`,
                              backgroundColor: "var(--card-bg)",
                              color: roleColors[member.role] ?? "var(--text-main)",
                              opacity: updatingUid === member.uid ? 0.5 : 1,
                            }}>
                            {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                          </select>
                          <ChevronDown size={11} style={{ position: "absolute", right: "0.4rem", top: "50%", transform: "translateY(-50%)", pointerEvents: "none", color: "var(--text-muted)" }} />
                        </div>
                      ) : (
                        <span style={{
                          display: "inline-flex", alignItems: "center", gap: "0.3rem",
                          fontSize: "0.8rem", fontWeight: 600,
                          color: roleColors[member.role] ?? "var(--text-muted)",
                          padding: "0.25rem 0.625rem",
                          backgroundColor: member.role === "SuperAdmin" ? "rgba(168,85,247,0.1)" : "var(--bg-color)",
                          borderRadius: "99px",
                          border: `1px solid ${member.role === "SuperAdmin" ? "rgba(168,85,247,0.25)" : "var(--border-color)"}`,
                        }}>
                          {member.role === "SuperAdmin" && <Shield size={11} />}
                          {ROLES.find(r => r.value === member.role)?.label ?? member.role}
                        </span>
                      )}
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexShrink: 0 }}>
                      {/* Enviar enlace de acceso/reset — visible para admins sobre usuarios que pueden editar */}
                      {canEdit && !isMe && (
                        <button
                          title={`Enviar enlace de acceso a ${member.email}`}
                          disabled={sendingResetUid === member.uid}
                          onClick={() => handleSendResetLink(member.email, member.uid)}
                          className="btn btn-secondary"
                          style={{ padding: "0.3rem 0.625rem", fontSize: "0.75rem", display: "flex", alignItems: "center", gap: "0.3rem", opacity: sendingResetUid === member.uid ? 0.5 : 1 }}>
                          {sendingResetUid === member.uid
                            ? <RefreshCw size={12} style={{ animation: "spin 1s linear infinite" }} />
                            : <Mail size={12} />}
                          Enlace acceso
                        </button>
                      )}
                      {realRole === "SuperAdmin" && !impersonated && !isMe && (
                        <button title={`Ver como ${member.displayName ?? member.email}`} onClick={() => handleImpersonate(member)}
                          className="btn btn-secondary" style={{ padding: "0.3rem 0.625rem", fontSize: "0.75rem", display: "flex", alignItems: "center", gap: "0.3rem" }}>
                          <Eye size={12} /> Ver como
                        </button>
                      )}
                      {canEdit && !isMe && (
                        <button title={`Eliminar a ${member.displayName ?? member.email}`}
                          disabled={updatingUid === member.uid}
                          onClick={() => handleDeleteUser(member.uid, member.displayName ?? member.email)}
                          style={{
                            background: "none", border: "1px solid transparent", cursor: "pointer",
                            color: "var(--text-muted)", padding: "0.3rem 0.45rem", borderRadius: "var(--radius-sm)",
                            display: "flex", alignItems: "center", transition: "all 0.15s",
                            opacity: updatingUid === member.uid ? 0.4 : 1,
                          }}
                          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(239,68,68,0.4)"; (e.currentTarget as HTMLButtonElement).style.color = "var(--danger)"; (e.currentTarget as HTMLButtonElement).style.backgroundColor = "rgba(239,68,68,0.06)"; }}
                          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = "transparent"; (e.currentTarget as HTMLButtonElement).style.color = "var(--text-muted)"; (e.currentTarget as HTMLButtonElement).style.backgroundColor = "transparent"; }}>
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <div style={{ marginTop: "1.5rem", padding: "1rem 1.25rem", backgroundColor: "rgba(99,102,241,0.06)", borderRadius: "var(--radius-md)", borderLeft: "3px solid var(--primary)", fontSize: "0.8125rem", color: "var(--text-muted)", lineHeight: 1.6 }}>
        <strong style={{ color: "var(--text-main)" }}>Nota:</strong> Los cambios de rol son inmediatos en Firestore, pero el usuario deberá cerrar sesión y volver a entrar para que el nuevo rol se aplique en su token.
      </div>
    </div>
  );

  const renderManuales = () => (
    <div>
      <h2 style={{ fontSize: "1.25rem", fontWeight: 700, color: "var(--text-main)", marginBottom: "0.375rem" }}>Manuales de Estilo</h2>
      <p style={{ color: "var(--text-muted)", marginBottom: "1.75rem" }}>Gestiona las normas editoriales activas de tu organización.</p>
      <div className="card-static" style={{ padding: "2rem", display: "flex", alignItems: "center", gap: "1.75rem" }}>
        <div style={{ width: "52px", height: "52px", borderRadius: "var(--radius-lg)", backgroundColor: "var(--primary-light)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--primary)", flexShrink: 0 }}>
          <BookOpen size={26} strokeWidth={1.75} />
        </div>
        <div style={{ flex: 1 }}>
          <p style={{ fontWeight: 600, color: "var(--text-main)", marginBottom: "0.25rem" }}>Criterios Editoriales</p>
          <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", lineHeight: 1.5 }}>
            Consulta y edita las normas de estilo activas, reglas RAE y criterios editoriales personalizados que guían el proceso de corrección de manuscritos.
          </p>
        </div>
        <Link href="/dashboard/criteria" className="btn" style={{ whiteSpace: "nowrap", textDecoration: "none" }}>
          Ir a Criterios →
        </Link>
      </div>
    </div>
  );

  const renderSuscripcion = () => (
    <div>
      <h2 style={{ fontSize: "1.25rem", fontWeight: 700, color: "var(--text-main)", marginBottom: "0.375rem" }}>Suscripción</h2>
      <p style={{ color: "var(--text-muted)", marginBottom: "1.75rem" }}>Gestiona tu plan de facturación y los detalles de tu suscripción.</p>
      <div className="card-static" style={{ padding: "2.5rem", textAlign: "center" }}>
        <div style={{ width: "56px", height: "56px", borderRadius: "var(--radius-lg)", margin: "0 auto 1.25rem", backgroundColor: "rgba(99,102,241,0.08)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--primary)" }}>
          <CreditCard size={28} strokeWidth={1.75} />
        </div>
        <h3 style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--text-main)", marginBottom: "0.5rem" }}>Gestión de facturación</h3>
        <p style={{ color: "var(--text-muted)", fontSize: "0.875rem", maxWidth: "400px", margin: "0 auto", lineHeight: 1.6 }}>
          La gestión de planes y facturación estará disponible próximamente. Contacta con soporte para cualquier consulta sobre tu suscripción actual.
        </p>
        <div style={{ marginTop: "1.5rem", display: "inline-flex", alignItems: "center", gap: "0.5rem", fontSize: "0.8rem", fontWeight: 600, color: "var(--primary)", backgroundColor: "var(--primary-light)", padding: "0.4rem 1rem", borderRadius: "99px" }}>
          🚧 Próximamente
        </div>
      </div>
    </div>
  );

  const renderOrganizaciones = () => (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.375rem" }}>
        <h2 style={{ fontSize: "1.25rem", fontWeight: 700, color: "var(--text-main)", margin: 0 }}>Gestión de Organizaciones</h2>
        <span style={{ fontSize: "0.7rem", fontWeight: 700, padding: "0.15rem 0.5rem", borderRadius: "99px", backgroundColor: "rgba(168,85,247,0.12)", color: "#a855f7" }}>SUPERADMIN</span>
      </div>
      <p style={{ color: "var(--text-muted)", marginBottom: "1.75rem" }}>Administra todas las organizaciones registradas en CalíopeBot.</p>

      <div className="card-static" style={{ padding: 0, overflow: "hidden", marginBottom: "2rem" }}>
        <div style={{ padding: "1.25rem 1.75rem", borderBottom: "1px solid var(--border-color)", display: "flex", alignItems: "center", gap: "0.625rem" }}>
          <Building2 size={18} style={{ color: "var(--text-muted)" }} />
          <span style={{ fontWeight: 600, fontSize: "0.9375rem" }}>Organizaciones registradas</span>
          <span style={{ marginLeft: "auto", fontSize: "0.8125rem", color: "var(--text-muted)", backgroundColor: "var(--primary-light)", padding: "0.125rem 0.625rem", borderRadius: "99px" }}>
            {allOrgs.length}
          </span>
        </div>
        {allOrgs.length === 0 ? (
          <div style={{ padding: "3rem", textAlign: "center", color: "var(--text-muted)" }}>No hay organizaciones registradas.</div>
        ) : (
          allOrgs.map((org, i) => (
            <div key={org.id} style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "1rem 1.75rem",
              borderBottom: i < allOrgs.length - 1 ? "1px solid var(--border-color)" : "none",
            }}>
              <div>
                <div style={{ fontWeight: 600, color: "var(--text-main)", fontSize: "0.925rem" }}>{org.name}</div>
                <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.15rem", fontFamily: "monospace" }}>{org.id}</div>
              </div>
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                <button
                  onClick={() => { setImpersonateOrgId(org.id); setActiveTab("impersonar"); }}
                  className="btn btn-secondary"
                  style={{ padding: "0.35rem 0.75rem", fontSize: "0.75rem", display: "flex", alignItems: "center", gap: "0.375rem" }}>
                  <Eye size={13} /> Impersonar
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Danger zone */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "1rem" }}>
        <AlertTriangle size={16} style={{ color: "#ef4444" }} />
        <h3 style={{ fontSize: "1rem", fontWeight: 700, color: "#ef4444", margin: 0 }}>Zona de peligro</h3>
      </div>
      <div className="card-static" style={{ padding: "1.5rem", borderColor: "rgba(239,68,68,0.3)", display: "flex", alignItems: "center", gap: "1.5rem", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: "200px" }}>
          <p style={{ fontWeight: 600, color: "var(--text-main)", marginBottom: "0.25rem" }}>Eliminar organización</p>
          <div style={{ marginBottom: "0.75rem" }}>
            <select className="input" value={impersonateOrgId} onChange={e => setImpersonateOrgId(e.target.value)} style={{ maxWidth: "280px" }}>
              {allOrgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </div>
          <p style={{ fontSize: "0.8125rem", color: "var(--text-muted)" }}>
            Elimina permanentemente la organización y todos sus datos (libros, normas, miembros).
          </p>
        </div>
        <button className="btn" style={{ backgroundColor: "#ef4444", borderColor: "#ef4444", display: "flex", alignItems: "center", gap: "0.375rem", whiteSpace: "nowrap" }}
          onClick={handleDeleteOrg} disabled={deletingOrg || !impersonateOrgId}>
          {deletingOrg
            ? <><RefreshCw size={14} style={{ animation: "spin 1s linear infinite" }} />Eliminando...</>
            : <><Trash2 size={14} />Eliminar organización</>}
        </button>
      </div>
      <div style={{ marginTop: "1rem" }}>
        <Link href="/dashboard/organizations" className="btn btn-secondary" style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", gap: "0.5rem", fontSize: "0.875rem" }}>
          <Building2 size={15} /> Ver gestión completa de organizaciones →
        </Link>
      </div>
    </div>
  );

  const renderImpersonar = () => (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.375rem" }}>
        <h2 style={{ fontSize: "1.25rem", fontWeight: 700, color: "var(--text-main)", margin: 0 }}>Impersonar sesión</h2>
        <span style={{ fontSize: "0.7rem", fontWeight: 700, padding: "0.15rem 0.5rem", borderRadius: "99px", backgroundColor: "rgba(168,85,247,0.12)", color: "#a855f7" }}>SUPERADMIN</span>
      </div>
      <p style={{ color: "var(--text-muted)", marginBottom: "1.75rem" }}>Simula la sesión de cualquier organización y rol para depurar o verificar comportamientos.</p>
      <div className="card-static" style={{ padding: "1.75rem" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: "1rem", alignItems: "flex-end" }}>
          <div>
            <label style={{ display: "block", marginBottom: "0.375rem", fontWeight: 600, fontSize: "0.8125rem", color: "var(--text-muted)" }}>Organización</label>
            <select className="input" value={impersonateOrgId} onChange={e => setImpersonateOrgId(e.target.value)}>
              {allOrgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </div>
          <div>
            <label style={{ display: "block", marginBottom: "0.375rem", fontWeight: 600, fontSize: "0.8125rem", color: "var(--text-muted)" }}>Rol a simular</label>
            <select className="input" value={impersonateRole} onChange={e => setImpersonateRole(e.target.value as Role)} style={{ backgroundColor: "var(--card-bg)" }}>
              {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
          <button className="btn" style={{ backgroundColor: "#a855f7", borderColor: "#a855f7", display: "flex", alignItems: "center", gap: "0.375rem", whiteSpace: "nowrap" }}
            onClick={handleImpersonateOrgRole} disabled={!impersonateOrgId}>
            <Eye size={14} /> Entrar como
          </button>
        </div>
        <div style={{ marginTop: "1.25rem", padding: "0.875rem 1rem", backgroundColor: "rgba(168,85,247,0.06)", borderRadius: "var(--radius-md)", borderLeft: "3px solid #a855f7", fontSize: "0.8125rem", color: "var(--text-muted)" }}>
          <strong style={{ color: "var(--text-main)" }}>¿Cómo funciona?</strong> Al entrar como un rol, verás exactamente lo que ve ese usuario. Un banner naranja te recordará que estás en modo impersonación. Haz clic en <em>Salir de la vista</em> para volver a tu sesión de SuperAdmin.
        </div>
      </div>

      <div style={{ marginTop: "2rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "1rem" }}>
          <Shield size={16} style={{ color: "#a855f7" }} />
          <h3 style={{ fontSize: "1rem", fontWeight: 700, color: "var(--text-main)", margin: 0 }}>Impersonar usuario concreto</h3>
        </div>
        <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginBottom: "1rem" }}>
          También puedes impersonar a un usuario en concreto desde la tabla <strong>Gestión de Equipo</strong> con el botón «Ver como».
        </p>
      </div>
    </div>
  );

  const tabContent: Record<TabId, React.ReactNode> = {
    equipo: renderEquipo(),
    manuales: renderManuales(),
    suscripcion: renderSuscripcion(),
    organizaciones: renderOrganizaciones(),
    impersonar: renderImpersonar(),
  };

  return (
    <div className="fade-in" style={{ padding: "2.5rem", maxWidth: "1000px", margin: "0 auto" }}>
      {/* Page header */}
      <div style={{ marginBottom: "2rem" }}>
        <h1 style={{ fontSize: "1.625rem", fontWeight: 800, color: "var(--text-main)", margin: 0 }}>Configuración</h1>
        <p style={{ color: "var(--text-muted)", marginTop: "0.25rem" }}>Administra tu organización, equipo y preferencias editoriales.</p>
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

      <div style={{ display: "flex", gap: "2rem", alignItems: "flex-start" }}>
        {/* ── Left tab nav ── */}
        <nav style={{ minWidth: "210px", flexShrink: 0 }}>
          {/* RE + SA tabs */}
          <div style={{ marginBottom: isSuperAdmin ? "0.5rem" : 0 }}>
            {visibleTabs.filter(t => !t.superAdminOnly).map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  display: "flex", alignItems: "center", gap: "0.625rem",
                  width: "100%", padding: "0.625rem 0.875rem",
                  borderRadius: "var(--radius-md)", border: "none", cursor: "pointer",
                  fontSize: "0.875rem", fontWeight: activeTab === tab.id ? 700 : 500,
                  color: activeTab === tab.id ? "var(--primary)" : "var(--text-muted)",
                  backgroundColor: activeTab === tab.id ? "var(--primary-light)" : "transparent",
                  transition: "all 0.15s", textAlign: "left", marginBottom: "0.25rem",
                }}
                onMouseEnter={e => { if (activeTab !== tab.id) (e.currentTarget as HTMLButtonElement).style.backgroundColor = "var(--bg-color)"; }}
                onMouseLeave={e => { if (activeTab !== tab.id) (e.currentTarget as HTMLButtonElement).style.backgroundColor = "transparent"; }}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>

          {/* SA-only section */}
          {isSuperAdmin && visibleTabs.some(t => t.superAdminOnly) && (
            <>
              <div style={{ padding: "0.5rem 0.875rem", fontSize: "0.68rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#a855f7", marginTop: "0.75rem", marginBottom: "0.25rem" }}>
                SuperAdmin
              </div>
              {visibleTabs.filter(t => t.superAdminOnly).map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  style={{
                    display: "flex", alignItems: "center", gap: "0.625rem",
                    width: "100%", padding: "0.625rem 0.875rem",
                    borderRadius: "var(--radius-md)", border: "none", cursor: "pointer",
                    fontSize: "0.875rem", fontWeight: activeTab === tab.id ? 700 : 500,
                    color: activeTab === tab.id ? "#a855f7" : "var(--text-muted)",
                    backgroundColor: activeTab === tab.id ? "rgba(168,85,247,0.1)" : "transparent",
                    transition: "all 0.15s", textAlign: "left", marginBottom: "0.25rem",
                  }}
                  onMouseEnter={e => { if (activeTab !== tab.id) (e.currentTarget as HTMLButtonElement).style.backgroundColor = "var(--bg-color)"; }}
                  onMouseLeave={e => { if (activeTab !== tab.id) (e.currentTarget as HTMLButtonElement).style.backgroundColor = "transparent"; }}
                >
                  {tab.icon}
                  {tab.label}
                </button>
              ))}
            </>
          )}
        </nav>

        {/* ── Right content ── */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {tabContent[activeTab]}
        </div>
      </div>
    </div>
  );
}
