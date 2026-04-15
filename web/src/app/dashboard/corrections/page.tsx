"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import { FileCheck, ChevronRight, Clock, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useRouter } from "next/navigation";

type CorrectionStatus = "pending" | "accepted" | "rejected" | "processing";

type Correction = {
  id: string;
  bookTitle: string;
  chapter: string;
  totalSuggestions: number;
  pending: number;
  accepted: number;
  rejected: number;
  status: CorrectionStatus;
  bookStatus: string;
  updatedAt: string;
};

export default function CorrectionsPage() {
  const { user, role, organizationId } = useAuth();
  const router = useRouter();
  const [filter, setFilter] = useState<"all" | "pending" | "accepted" | "rejected">("all");
  const [corrections, setCorrections] = useState<Correction[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!organizationId || !user) return;
    const fetchCorrections = async () => {
      try {
        const booksSnap = await getDocs(
          collection(db, "organizations", organizationId, "books")
        );
        const fetched: Correction[] = [];

        for (const docSnap of booksSnap.docs) {
          const book = docSnap.data();

          if (role === "Autor" && book.authorId !== user.uid) continue;

          // If still processing, show as a processing card
          if (book.status === "processing") {
            fetched.push({
              id: docSnap.id,
              bookTitle: book.title || "Sin Título",
              chapter: "Analizando con IA...",
              totalSuggestions: 0,
              pending: 0,
              accepted: 0,
              rejected: 0,
              status: "processing",
              bookStatus: book.status,
              updatedAt: book.createdAt?.toDate().toLocaleDateString() || "Reciente",
            });
            continue;
          }

          const chunksSnap = await getDocs(
            collection(db, "organizations", organizationId, "books", docSnap.id, "chunks")
          );

          let pending = 0, accepted = 0, rejected = 0, total = 0;
          chunksSnap.forEach(cSnap => {
            const suggestions = cSnap.data().suggestions || [];
            suggestions.forEach((s: { status?: string }) => {
              total++;
              if (s.status === "pending" || !s.status) pending++;
              else if (s.status === "accepted" || s.status === "edited") accepted++;
              else if (s.status === "rejected") rejected++;
            });
          });

          if (total === 0) continue;

          const resolvedStatus: CorrectionStatus = pending > 0 ? "pending" : "accepted";

          fetched.push({
            id: docSnap.id,
            bookTitle: book.title || "Sin Título",
            chapter: `${chunksSnap.size} segmentos`,
            totalSuggestions: total,
            pending,
            accepted,
            rejected,
            status: resolvedStatus,
            bookStatus: book.status,
            updatedAt: book.createdAt?.toDate().toLocaleDateString() || "Reciente",
          });
        }

        // Sort: pending first, then processing, then completed
        const order: Record<string, number> = { pending: 0, processing: 1, accepted: 2, rejected: 3 };
        fetched.sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));

        setCorrections(fetched);
      } catch (e) {
        console.error("Error fetching corrections:", e);
      } finally {
        setIsLoading(false);
      }
    };
    fetchCorrections();
  }, [organizationId, user, role]);

  const filtered = filter === "all"
    ? corrections
    : corrections.filter(c => c.status === filter || (filter === "pending" && c.status === "processing"));

  const handleOpenEditor = (bookId: string) => {
    router.push(`/dashboard/editor?bookId=${bookId}`);
  };

  const pendingCount = corrections.filter(c => c.status === "pending").length;
  const processingCount = corrections.filter(c => c.status === "processing").length;

  return (
    <div className="fade-in" style={{ padding: "2.5rem", maxWidth: "1100px", margin: "0 auto" }}>
      <div className="page-header">
        <div>
          <h1 style={{ display: "flex", alignItems: "center", gap: "0.625rem" }}>
            Mis Correcciones
            {pendingCount > 0 && (
              <span style={{ fontSize: "0.875rem", fontWeight: 700, backgroundColor: "var(--primary)", color: "white", padding: "0.15rem 0.625rem", borderRadius: "99px" }}>
                {pendingCount}
              </span>
            )}
          </h1>
          <p>Revisa y aprueba las sugerencias de la IA sobre tus manuscritos.</p>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="card-static" style={{ display: "flex", gap: "0.5rem", padding: "0.75rem 1rem", marginBottom: "1.5rem", flexWrap: "wrap" }}>
        {(["all", "pending", "accepted"] as const).map(f => {
          const count = f === "all" ? corrections.length : f === "pending"
            ? corrections.filter(c => c.status === "pending" || c.status === "processing").length
            : corrections.filter(c => c.status === f).length;
          return (
            <button
              key={f}
              className={`btn ${filter === f ? "" : "btn-ghost"}`}
              style={{ padding: "0.375rem 0.875rem", fontSize: "0.8125rem", display: "flex", alignItems: "center", gap: "0.375rem" }}
              onClick={() => setFilter(f)}
            >
              {f === "all" ? "Todas" : f === "pending" ? "Pendientes" : "Completadas"}
              <span style={{
                fontSize: "0.7rem", minWidth: "18px", textAlign: "center",
                backgroundColor: filter === f ? "rgba(255,255,255,0.25)" : "var(--primary-light)",
                borderRadius: "99px", padding: "0 0.375rem",
                color: filter === f ? "white" : "var(--primary)",
              }}>
                {count}
              </span>
            </button>
          );
        })}

        {processingCount > 0 && (
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.8125rem", color: "var(--text-muted)" }}>
            <div className="pulse-dot" style={{ width: "8px", height: "8px", borderRadius: "50%", backgroundColor: "var(--warning)", animation: "pulse 1.5s ease-in-out infinite" }} />
            {processingCount} procesando con IA
          </div>
        )}
      </div>

      {/* Corrections List */}
      {isLoading ? (
        <div style={{ textAlign: "center", padding: "4rem", color: "var(--text-muted)" }}>
          Buscando correcciones activas...
        </div>
      ) : filtered.length === 0 ? (
        <div className="card-static" style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "4rem 2rem", textAlign: "center" }}>
          <FileCheck size={40} strokeWidth={1.25} style={{ color: "var(--text-muted)", marginBottom: "1rem" }} />
          <h3 style={{ fontSize: "1.125rem", fontWeight: 700, color: "var(--text-main)" }}>Sin correcciones</h3>
          <p style={{ color: "var(--text-muted)", marginTop: "0.5rem", fontSize: "0.875rem" }}>
            No hay correcciones que coincidan con este filtro.
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {filtered.map(correction => (
            <div
              key={correction.id}
              onClick={() => handleOpenEditor(correction.id)}
              className="card"
              style={{ padding: "1.25rem 1.5rem", cursor: "pointer", opacity: correction.status === "processing" ? 0.85 : 1 }}
            >
              <div style={{ display: "flex", alignItems: "flex-start", gap: "1rem" }}>
                {/* Icon */}
                <div style={{ flexShrink: 0, marginTop: "0.125rem" }}>
                  {correction.status === "processing" ? (
                    <Loader2 size={20} style={{ color: "var(--warning)", animation: "spin 1.2s linear infinite" }} />
                  ) : correction.status === "pending" ? (
                    <Clock size={20} style={{ color: "var(--warning)" }} />
                  ) : (
                    <CheckCircle2 size={20} style={{ color: "var(--success)" }} />
                  )}
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  {/* Title + badge */}
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem", flexWrap: "wrap" }}>
                    <h3 style={{ fontSize: "1rem", fontWeight: 700, color: "var(--text-main)" }}>{correction.bookTitle}</h3>
                    {correction.status === "pending" && (
                      <span className="status-badge status-pending" style={{ fontSize: "0.6rem" }}>
                        {correction.pending} PENDIENTES
                      </span>
                    )}
                    {correction.status === "processing" && (
                      <span className="status-badge" style={{ fontSize: "0.6rem", backgroundColor: "rgba(245,158,11,0.1)", color: "var(--warning)" }}>
                        PROCESANDO
                      </span>
                    )}
                    {correction.status === "accepted" && (
                      <span className="status-badge status-active" style={{ fontSize: "0.6rem" }}>COMPLETADA</span>
                    )}
                  </div>

                  <p style={{ fontSize: "0.8125rem", color: "var(--text-muted)", marginBottom: "0.75rem" }}>
                    {correction.chapter}
                  </p>

                  {/* Inline progress bar */}
                  {correction.totalSuggestions > 0 && (
                    <div>
                      <div style={{ display: "flex", gap: "1rem", marginBottom: "0.375rem" }}>
                        <span style={{ display: "flex", alignItems: "center", gap: "0.25rem", fontSize: "0.75rem", color: "var(--warning)" }}>
                          <Clock size={11} /> {correction.pending} pendientes
                        </span>
                        <span style={{ display: "flex", alignItems: "center", gap: "0.25rem", fontSize: "0.75rem", color: "var(--success)" }}>
                          <CheckCircle2 size={11} /> {correction.accepted} aceptadas
                        </span>
                        <span style={{ display: "flex", alignItems: "center", gap: "0.25rem", fontSize: "0.75rem", color: "var(--danger)" }}>
                          <XCircle size={11} /> {correction.rejected} rechazadas
                        </span>
                      </div>
                      {/* Progress bar */}
                      <div style={{ height: "4px", borderRadius: "2px", backgroundColor: "var(--border-color)", overflow: "hidden", display: "flex" }}>
                        <div style={{
                          width: `${Math.round((correction.accepted / correction.totalSuggestions) * 100)}%`,
                          backgroundColor: "var(--success)",
                          transition: "width 0.4s ease",
                        }} />
                        <div style={{
                          width: `${Math.round((correction.rejected / correction.totalSuggestions) * 100)}%`,
                          backgroundColor: "rgba(239,68,68,0.4)",
                        }} />
                      </div>
                      <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>
                        {Math.round(((correction.accepted + correction.rejected) / correction.totalSuggestions) * 100)}% revisado
                      </div>
                    </div>
                  )}
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: "0.375rem", color: "var(--text-muted)", fontSize: "0.75rem", flexShrink: 0 }}>
                  {correction.updatedAt}
                  <ChevronRight size={16} />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
