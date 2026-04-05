"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import { FileCheck, ChevronRight, Clock, CheckCircle2, XCircle } from "lucide-react";
import { collection, query, where, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useRouter } from "next/navigation";

type CorrectionStatus = "pending" | "accepted" | "rejected";

type Correction = {
  id: string; // The Book ID
  bookTitle: string;
  chapter: string; // Usually just 'Documento Único' or chunks count
  totalSuggestions: number;
  pending: number;
  accepted: number;
  rejected: number;
  status: CorrectionStatus;
  updatedAt: string;
};

export default function CorrectionsPage() {
  const { user, role, organizationId } = useAuth();
  const router = useRouter();
  const [filter, setFilter] = useState<"all" | CorrectionStatus>("all");
  const [corrections, setCorrections] = useState<Correction[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!organizationId || !user) return;
    const fetchCorrections = async () => {
      try {
        let q;
        if (role === "Autor") {
          q = query(collection(db, "books"), where("authorId", "==", user.uid));
        } else {
          // Editores y Responsables ven todo lo de su org
          q = query(collection(db, "books"), where("organizationId", "==", organizationId));
        }
        
        const booksSnap = await getDocs(q);
        const fetchedCorrections: Correction[] = [];

        for (const docSnap of booksSnap.docs) {
          const book = docSnap.data();
          // Fetch chunks to aggregate suggestions
          const chunksSnap = await getDocs(collection(db, "organizations", organizationId, "books", docSnap.id, "chunks"));
          
          let pending = 0;
          let accepted = 0;
          let rejected = 0;
          let total = 0;

          chunksSnap.forEach(cSnap => {
            const suggestions = cSnap.data().suggestions || [];
            suggestions.forEach((s: any) => {
              total++;
              if (s.status === "pending" || !s.status) pending++;
              else if (s.status === "accepted" || s.status === "edited") accepted++;
              else if (s.status === "rejected") rejected++;
            });
          });

          // Skip if no suggestions and not in processing state
          if (total === 0 && book.status !== "processing") continue;

          let status: CorrectionStatus = pending > 0 ? "pending" : (accepted > 0 ? "accepted" : "rejected");
          
          fetchedCorrections.push({
            id: docSnap.id,
            bookTitle: book.title || "Sin Título",
            chapter: `Contiene ${chunksSnap.size} segmentos de texto`,
            totalSuggestions: total,
            pending,
            accepted,
            rejected,
            status,
            updatedAt: book.createdAt?.toDate().toLocaleDateString() || "Reciente"
          });
        }
        
        setCorrections(fetchedCorrections);
      } catch (e) {
        console.error("Error fetching corrections:", e);
      } finally {
        setIsLoading(false);
      }
    };
    fetchCorrections();
  }, [organizationId, user, role]);

  const filtered = filter === "all" ? corrections : corrections.filter(c => c.status === filter);

  const handleOpenEditor = (bookId: string) => {
    router.push(`/dashboard/editor?bookId=${bookId}`);
  };

  return (
    <div className="fade-in" style={{ padding: "2.5rem", maxWidth: "1100px", margin: "0 auto" }}>
      <div className="page-header">
        <div>
          <h1>Mis Correcciones</h1>
          <p>Revisa y aprueba las sugerencias de la IA sobre tus manuscritos.</p>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="card-static" style={{ display: "flex", gap: "0.5rem", padding: "0.75rem 1rem", marginBottom: "1.5rem" }}>
        {(["all", "pending", "accepted", "rejected"] as const).map((f) => (
          <button
            key={f}
            className={`btn ${filter === f ? "" : "btn-ghost"}`}
            style={{ padding: "0.375rem 0.875rem", fontSize: "0.8125rem" }}
            onClick={() => setFilter(f)}
          >
            {f === "all" ? "Todas" : f === "pending" ? "Pendientes" : f === "accepted" ? "Aprobadas" : "Rechazadas"}
          </button>
        ))}
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
          <p style={{ color: "var(--text-muted)", marginTop: "0.5rem", fontSize: "0.875rem" }}>No hay correcciones que coincidan con este filtro.</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {filtered.map((correction) => (
            <div key={correction.id} onClick={() => handleOpenEditor(correction.id)} className="card" style={{ padding: "1.25rem 1.5rem", display: "flex", alignItems: "center", gap: "1rem", cursor: "pointer" }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem" }}>
                  <h3 style={{ fontSize: "1rem", fontWeight: 700, color: "var(--text-main)" }}>{correction.bookTitle}</h3>
                  {correction.status === "pending" && <span className="status-badge status-pending" style={{ fontSize: "0.625rem" }}>PENDIENTE</span>}
                  {correction.status === "accepted" && <span className="status-badge status-active" style={{ fontSize: "0.625rem" }}>COMPLETADA</span>}
                </div>
                <p style={{ fontSize: "0.8125rem", color: "var(--text-muted)" }}>{correction.chapter}</p>

                <div style={{ display: "flex", gap: "1rem", marginTop: "0.625rem" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.25rem", fontSize: "0.75rem", color: "var(--text-muted)" }}>
                    <Clock size={12} /> {correction.pending} pendientes
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.25rem", fontSize: "0.75rem", color: "var(--success)" }}>
                    <CheckCircle2 size={12} /> {correction.accepted} aceptadas
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.25rem", fontSize: "0.75rem", color: "var(--danger)" }}>
                    <XCircle size={12} /> {correction.rejected} rechazadas
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", color: "var(--text-muted)", fontSize: "0.75rem" }}>
                Última act. {correction.updatedAt}
                <ChevronRight size={16} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

