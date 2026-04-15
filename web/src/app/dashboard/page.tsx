"use client";

import { useAuth } from "@/lib/auth-context";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  FileText, Clock, Target, PenLine, FolderOpen, Palette,
  Loader2, TrendingUp, BookOpen, ChevronRight, CheckCircle2, Sparkles,
} from "lucide-react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { getOrganizations } from "@/lib/firestore";

type BookSummary = {
  id: string;
  title: string;
  status: string;
  createdAt: { toDate: () => Date } | null;
};

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  draft:              { label: "Borrador",         color: "var(--text-muted)" },
  processing:         { label: "Procesando IA",    color: "#f59e0b" },
  review_editor:      { label: "Revisión Editor",  color: "#6366f1" },
  ready:              { label: "Revisión Editor",  color: "#6366f1" },
  review_author:      { label: "Revisión Autor",   color: "#06b6d4" },
  review_responsable: { label: "Aprobación Final", color: "#a855f7" },
  approved:           { label: "Aprobado",         color: "var(--success)" },
};

export default function DashboardPage() {
  const { role, user, organizationId, loading } = useAuth();

  const [activeBooks, setActiveBooks] = useState<number | null>(null);
  const [pendingSuggestions, setPendingSuggestions] = useState<number | null>(null);
  const [acceptRate, setAcceptRate] = useState<number | null>(null);
  const [recentBooks, setRecentBooks] = useState<BookSummary[]>([]);
  const [kpiLoading, setKpiLoading] = useState(true);

  const computeKPIs = useCallback(async (orgId: string) => {
    setKpiLoading(true);
    try {
      const booksSnap = await getDocs(collection(db, "organizations", orgId, "books"));

      let active = 0;
      let totalPending = 0;
      let totalAccepted = 0;
      let totalReviewed = 0;
      const allBooks: BookSummary[] = [];

      for (const bookDoc of booksSnap.docs) {
        const data = bookDoc.data();
        if (data.status !== "approved") active++;

        allBooks.push({
          id: bookDoc.id,
          title: data.title ?? "Sin título",
          status: data.status ?? "draft",
          createdAt: data.createdAt ?? null,
        });

        // Contar sugerencias desde chunks
        const chunksSnap = await getDocs(
          collection(db, "organizations", orgId, "books", bookDoc.id, "chunks")
        );
        chunksSnap.forEach((chunkDoc) => {
          const suggestions = chunkDoc.data().suggestions ?? [];
          suggestions.forEach((s: { status?: string }) => {
            const st = s.status ?? "pending";
            if (st === "pending") totalPending++;
            if (st === "accepted" || st === "edited" || st === "rejected") totalReviewed++;
            if (st === "accepted" || st === "edited") totalAccepted++;
          });
        });
      }

      // Ordenar y tomar los 3 más recientes
      allBooks.sort((a, b) => {
        const ta = a.createdAt?.toDate().getTime() ?? 0;
        const tb = b.createdAt?.toDate().getTime() ?? 0;
        return tb - ta;
      });

      setActiveBooks(active);
      setPendingSuggestions(totalPending);
      setAcceptRate(totalReviewed > 0 ? Math.round((totalAccepted / totalReviewed) * 100) : null);
      setRecentBooks(allBooks.slice(0, 3));
    } catch (err) {
      console.error("Error computing KPIs:", err);
    } finally {
      setKpiLoading(false);
    }
  }, []);

  useEffect(() => {
    if (loading || !user) return;
    const fetchForRole = async () => {
      if (role === "SuperAdmin") {
        const orgs = await getOrganizations();
        if (orgs.length > 0) computeKPIs(orgs[0].id);
        else setKpiLoading(false);
      } else if (organizationId) {
        computeKPIs(organizationId);
      } else {
        setKpiLoading(false);
      }
    };
    fetchForRole();
  }, [loading, user, role, organizationId, computeKPIs]);

  const stats = [
    {
      label: "Manuscritos Activos",
      value: activeBooks,
      icon: FileText,
      color: "var(--primary-light)",
      iconColor: "var(--primary)",
    },
    {
      label: "Sugerencias Pendientes",
      value: pendingSuggestions,
      icon: Clock,
      color: "rgba(245, 158, 11, 0.1)",
      iconColor: "#f59e0b",
    },
    {
      label: "Tasa de Aceptación IA",
      value: acceptRate !== null ? acceptRate : null,
      display: acceptRate !== null ? `${acceptRate}%` : null,
      icon: Target,
      color: "rgba(16, 185, 129, 0.1)",
      iconColor: "var(--success)",
    },
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
          const displayVal = "display" in s && s.display !== null ? s.display : s.value;
          return (
            <div key={s.label} className="card-static" style={{ display: "flex", alignItems: "center", gap: "1rem", padding: "1.25rem" }}>
              <div style={{ width: "44px", height: "44px", borderRadius: "var(--radius-lg)", backgroundColor: s.color, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <Icon size={20} strokeWidth={1.75} style={{ color: s.iconColor }} />
              </div>
              <div>
                <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "var(--text-main)", lineHeight: 1.2, minHeight: "2rem", display: "flex", alignItems: "center" }}>
                  {kpiLoading
                    ? <Loader2 size={18} style={{ animation: "spin 1s linear infinite", color: "var(--text-muted)" }} />
                    : displayVal !== null ? String(displayVal) : <span style={{ color: "var(--text-muted)" }}>—</span>}
                </div>
                <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.125rem" }}>{s.label}</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Onboarding panel — shown only when org is empty */}
      {!kpiLoading && activeBooks === 0 && (
        <div style={{
          marginBottom: "2rem",
          padding: "2rem",
          borderRadius: "var(--radius-lg)",
          background: "linear-gradient(135deg, rgba(99,102,241,0.06) 0%, rgba(139,92,246,0.04) 100%)",
          border: "1px solid rgba(99,102,241,0.15)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1.25rem" }}>
            <div style={{ width: "40px", height: "40px", borderRadius: "var(--radius-lg)", backgroundColor: "var(--primary-light)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Sparkles size={20} strokeWidth={1.75} style={{ color: "var(--primary)" }} />
            </div>
            <div>
              <h2 style={{ fontSize: "1.0625rem", fontWeight: 700, color: "var(--text-main)" }}>Primeros pasos en CalíopeBot</h2>
              <p style={{ fontSize: "0.8125rem", color: "var(--text-muted)" }}>Sigue estos pasos para poner en marcha tu flujo editorial.</p>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "0.625rem" }}>
            {/* Step 1 — Criteria (Admin/SuperAdmin only) */}
            {(role === "SuperAdmin" || role === "Admin" || role === "Responsable_Editorial") && (
              <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", padding: "0.75rem 1rem", borderRadius: "var(--radius-md)", backgroundColor: "var(--surface-color)", border: "1px solid var(--border-color)" }}>
                <CheckCircle2 size={18} style={{ color: "var(--primary)", flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: "0.875rem", color: "var(--text-main)" }}>Configura los criterios editoriales</div>
                  <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                    {role === "SuperAdmin"
                      ? "Carga las reglas RAE canónicas con un clic o añade criterios manuales."
                      : "Añade criterios manuales de estilo para tu organización."}
                  </div>
                </div>
                <a href="/dashboard/criteria" className="btn btn-secondary" style={{ textDecoration: "none", padding: "0.375rem 0.875rem", fontSize: "0.8125rem", whiteSpace: "nowrap" }}>Ir a Criterios →</a>
              </div>
            )}

            {/* Step 2 — Upload first manuscript */}
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", padding: "0.75rem 1rem", borderRadius: "var(--radius-md)", backgroundColor: "var(--surface-color)", border: "1px solid var(--border-color)" }}>
              <div style={{ width: "18px", height: "18px", borderRadius: "50%", border: "2px solid var(--border-color)", flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: "0.875rem", color: "var(--text-main)" }}>Sube tu primer manuscrito</div>
                <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>Importa un archivo .docx para que la IA lo analice y genere sugerencias.</div>
              </div>
              <a href="/dashboard/books" className="btn" style={{ textDecoration: "none", padding: "0.375rem 0.875rem", fontSize: "0.8125rem", whiteSpace: "nowrap" }}>Ir a Biblioteca →</a>
            </div>

            {/* Step 3 — Review */}
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", padding: "0.75rem 1rem", borderRadius: "var(--radius-md)", backgroundColor: "var(--surface-color)", border: "1px solid var(--border-color)", opacity: 0.55 }}>
              <div style={{ width: "18px", height: "18px", borderRadius: "50%", border: "2px solid var(--border-color)", flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: "0.875rem", color: "var(--text-main)" }}>Revisa las sugerencias de la IA</div>
                <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>Una vez procesado el manuscrito, aprueba, edita o rechaza cada corrección.</div>
              </div>
              <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", padding: "0.375rem 0.875rem" }}>Pendiente</span>
            </div>
          </div>
        </div>
      )}

      {/* Recent Books */}
      {!kpiLoading && recentBooks.length > 0 && (
        <div style={{ marginBottom: "2rem" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.875rem" }}>
            <h2 style={{ fontSize: "1.125rem", fontWeight: 700, color: "var(--text-main)", display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <BookOpen size={18} strokeWidth={1.75} style={{ color: "var(--primary)" }} />
              Últimos Manuscritos
            </h2>
            <Link href="/dashboard/books" style={{ fontSize: "0.8125rem", color: "var(--primary)", textDecoration: "none", fontWeight: 600 }}>
              Ver todos →
            </Link>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {recentBooks.map((book) => {
              const sc = STATUS_LABEL[book.status] ?? STATUS_LABEL.draft;
              const dateStr = book.createdAt?.toDate
                ? book.createdAt.toDate().toLocaleDateString("es-ES", { day: "numeric", month: "short" })
                : "—";
              return (
                <Link
                  key={book.id}
                  href={`/dashboard/editor?bookId=${book.id}`}
                  className="card"
                  style={{ padding: "1rem 1.25rem", display: "flex", alignItems: "center", gap: "1rem", textDecoration: "none", cursor: "pointer" }}
                >
                  <div style={{ flex: 1 }}>
                    <span style={{ fontWeight: 600, color: "var(--text-main)", fontSize: "0.9375rem" }}>{book.title}</span>
                    <div style={{ display: "flex", gap: "0.75rem", marginTop: "0.25rem", alignItems: "center" }}>
                      <span style={{ fontSize: "0.75rem", fontWeight: 600, color: sc.color }}>{sc.label}</span>
                      <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>{dateStr}</span>
                    </div>
                  </div>
                  <ChevronRight size={16} style={{ color: "var(--text-muted)" }} />
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* Quick Actions */}
      <h2 style={{ fontSize: "1.125rem", fontWeight: 700, color: "var(--text-main)", marginBottom: "1rem" }}>Acciones rápidas</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: "1.25rem" }}>

        {/* Corrections Card */}
        <div className="card" style={{ padding: "1.75rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.75rem" }}>
            <PenLine size={22} strokeWidth={1.75} style={{ color: "var(--primary)" }} />
            <h3 style={{ fontSize: "1.125rem", fontWeight: 700, color: "var(--text-main)" }}>Mis Correcciones</h3>
            {!kpiLoading && pendingSuggestions !== null && pendingSuggestions > 0 && (
              <span style={{ marginLeft: "auto", fontSize: "0.75rem", fontWeight: 700, backgroundColor: "var(--primary)", color: "white", borderRadius: "99px", padding: "0.125rem 0.5rem" }}>
                {pendingSuggestions}
              </span>
            )}
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
        {(role === "SuperAdmin" || role === "Admin" || role === "Responsable_Editorial") && (
          <div className="card" style={{ padding: "1.75rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.75rem" }}>
              <Palette size={22} strokeWidth={1.75} style={{ color: "var(--primary)" }} />
              <h3 style={{ fontSize: "1.125rem", fontWeight: 700, color: "var(--text-main)" }}>Criterios Editoriales</h3>
            </div>
            <p style={{ color: "var(--text-muted)", fontSize: "0.875rem", marginBottom: "1.25rem", lineHeight: 1.6 }}>
              Configura los criterios RAE/Fundéu y reglas de estilo de la organización.
            </p>
            <Link href="/dashboard/criteria" className="btn btn-secondary" style={{ textDecoration: "none" }}>
              Gestionar Criterios
            </Link>
          </div>
        )}

        {/* Reports Card */}
        {(role === "SuperAdmin" || role === "Admin" || role === "Responsable_Editorial") && (
          <div className="card" style={{ padding: "1.75rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.75rem" }}>
              <TrendingUp size={22} strokeWidth={1.75} style={{ color: "var(--primary)" }} />
              <h3 style={{ fontSize: "1.125rem", fontWeight: 700, color: "var(--text-main)" }}>KPIs y Reportes</h3>
            </div>
            <p style={{ color: "var(--text-muted)", fontSize: "0.875rem", marginBottom: "1.25rem", lineHeight: 1.6 }}>
              Métricas de rendimiento del equipo editorial y del sistema de corrección IA.
            </p>
            <Link href="/dashboard/reports" className="btn btn-secondary" style={{ textDecoration: "none" }}>
              Ver Métricas
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
