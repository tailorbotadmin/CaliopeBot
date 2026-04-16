"use client";

import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import {
  subscribeNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  Notification,
} from "@/lib/firestore";
import { Bell, BookOpen, UserCheck, CheckCircle2, AlertTriangle, Check } from "lucide-react";

const TYPE_CONFIG: Record<string, { icon: React.ReactNode; color: string; bg: string }> = {
  manuscript_uploaded: {
    icon: <BookOpen size={16} />,
    color: "#6366f1",
    bg: "rgba(99,102,241,0.1)",
  },
  editor_assigned: {
    icon: <UserCheck size={16} />,
    color: "var(--primary)",
    bg: "var(--primary-light)",
  },
  correction_done: {
    icon: <CheckCircle2 size={16} />,
    color: "#10b981",
    bg: "rgba(16,185,129,0.1)",
  },
  upload_failed: {
    icon: <AlertTriangle size={16} />,
    color: "#ef4444",
    bg: "rgba(239,68,68,0.1)",
  },
};

export default function NotificationsPage() {
  const { user, organizationId } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [markingAll, setMarkingAll] = useState(false);

  useEffect(() => {
    if (!organizationId || !user) return;
    const unsub = subscribeNotifications(organizationId, user.uid, notifs => {
      setNotifications(notifs);
    });
    return unsub;
  }, [organizationId, user]);

  const handleMarkRead = useCallback(async (notif: Notification) => {
    if (notif.read || !organizationId) return;
    await markNotificationRead(organizationId, notif.id);
  }, [organizationId]);

  const handleMarkAll = async () => {
    if (!organizationId || !user) return;
    setMarkingAll(true);
    try {
      await markAllNotificationsRead(organizationId, user.uid);
    } finally {
      setMarkingAll(false);
    }
  };

  const unread = notifications.filter(n => !n.read).length;

  const formatDate = (notif: Notification) => {
    if (!notif.createdAt?.toDate) return "—";
    const d = notif.createdAt.toDate();
    const now = new Date();
    const diff = (now.getTime() - d.getTime()) / 1000;
    if (diff < 60) return "Ahora mismo";
    if (diff < 3600) return `Hace ${Math.floor(diff / 60)} min`;
    if (diff < 86400) return `Hace ${Math.floor(diff / 3600)} h`;
    return d.toLocaleDateString("es-ES", { day: "numeric", month: "short" });
  };

  return (
    <div className="fade-in" style={{ padding: "2.5rem", maxWidth: "780px", margin: "0 auto" }}>
      {/* Header */}
      <div className="page-header" style={{ marginBottom: "1.5rem" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <h1 style={{ margin: 0 }}>Notificaciones</h1>
            {unread > 0 && (
              <span style={{
                backgroundColor: "var(--primary)", color: "#fff",
                fontSize: "0.7rem", fontWeight: 700, padding: "0.15rem 0.5rem",
                borderRadius: "99px",
              }}>
                {unread} nuevas
              </span>
            )}
          </div>
          <p style={{ marginTop: "0.25rem" }}>Actividad relacionada contigo en esta editorial.</p>
        </div>
        {unread > 0 && (
          <button className="btn btn-secondary" onClick={handleMarkAll} disabled={markingAll}
            style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.85rem" }}>
            <Check size={15} />
            Marcar todas leídas
          </button>
        )}
      </div>

      {/* List */}
      {notifications.length === 0 ? (
        <div className="card-static" style={{
          display: "flex", flexDirection: "column", alignItems: "center",
          padding: "4rem 2rem", textAlign: "center",
        }}>
          <div style={{
            width: "56px", height: "56px", borderRadius: "var(--radius-lg)",
            backgroundColor: "var(--primary-light)", display: "flex",
            alignItems: "center", justifyContent: "center", marginBottom: "1.25rem", color: "var(--primary)",
          }}>
            <Bell size={28} strokeWidth={1.75} />
          </div>
          <h3 style={{ fontSize: "1.125rem", fontWeight: 700 }}>Sin notificaciones</h3>
          <p style={{ color: "var(--text-muted)", marginTop: "0.5rem", fontSize: "0.875rem" }}>
            Aquí aparecerán los eventos relevantes de tu actividad editorial.
          </p>
        </div>
      ) : (
        <div className="card-static" style={{ overflow: "hidden", padding: 0 }}>
          {notifications.map((notif, idx) => {
            const cfg = TYPE_CONFIG[notif.type] ?? TYPE_CONFIG.manuscript_uploaded;
            const isLast = idx === notifications.length - 1;
            return (
              <div
                key={notif.id}
                onClick={() => handleMarkRead(notif)}
                style={{
                  display: "flex", alignItems: "flex-start", gap: "0.875rem",
                  padding: "1rem 1.25rem",
                  borderBottom: isLast ? "none" : "1px solid var(--border-color)",
                  backgroundColor: notif.read ? "transparent" : "rgba(99,102,241,0.04)",
                  cursor: notif.read ? "default" : "pointer",
                  transition: "background 0.15s",
                }}
                onMouseEnter={e => { if (!notif.read) e.currentTarget.style.backgroundColor = "rgba(99,102,241,0.08)"; }}
                onMouseLeave={e => { if (!notif.read) e.currentTarget.style.backgroundColor = "rgba(99,102,241,0.04)"; }}
              >
                {/* Icon */}
                <div style={{
                  width: 36, height: 36, borderRadius: "var(--radius)",
                  backgroundColor: cfg.bg, color: cfg.color,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  flexShrink: 0, marginTop: "0.1rem",
                }}>
                  {cfg.icon}
                </div>

                {/* Text */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.5rem" }}>
                    <span style={{ fontWeight: notif.read ? 500 : 700, fontSize: "0.9rem", color: "var(--text-main)" }}>
                      {notif.title}
                    </span>
                    <span style={{ fontSize: "0.72rem", color: "var(--text-muted)", whiteSpace: "nowrap", flexShrink: 0 }}>
                      {formatDate(notif)}
                    </span>
                  </div>
                  <p style={{ fontSize: "0.82rem", color: "var(--text-muted)", marginTop: "0.2rem", lineHeight: 1.4 }}>
                    {notif.message}
                  </p>
                  {notif.bookTitle && (
                    <span style={{
                      display: "inline-block", marginTop: "0.3rem",
                      fontSize: "0.7rem", fontWeight: 600, color: cfg.color,
                      backgroundColor: cfg.bg, padding: "0.15rem 0.5rem", borderRadius: "99px",
                    }}>
                      📄 {notif.bookTitle}
                    </span>
                  )}
                </div>

                {/* Unread dot */}
                {!notif.read && (
                  <div style={{
                    width: 8, height: 8, borderRadius: "50%",
                    backgroundColor: "var(--primary)", flexShrink: 0, marginTop: "0.4rem",
                  }} />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
