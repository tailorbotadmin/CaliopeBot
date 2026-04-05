"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import { Scale, CheckCircle2, XCircle, FilePlus2, Lightbulb, BookOpen, Upload } from "lucide-react";
import { collection, onSnapshot, doc, setDoc, deleteDoc } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { db, storage } from "@/lib/firebase";

type Criterion = {
  id: string;
  rule: string;
  description: string;
  status: "active" | "pending";
};

export default function CriteriaPage() {
  const { role, organizationId } = useAuth();
  const [activeRules, setActiveRules] = useState<Criterion[]>([]);
  const [pendingRules, setPendingRules] = useState<Criterion[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  
  const [originalFile, setOriginalFile] = useState<File | null>(null);
  const [correctedFile, setCorrectedFile] = useState<File | null>(null);

  useEffect(() => {
    if (!organizationId) return;

    const pendingRef = collection(db, "organizations", organizationId, "pendingRules");
    const unsubPending = onSnapshot(pendingRef, (snap) => {
      setPendingRules(snap.docs.map(d => ({ id: d.id, ...d.data() } as Criterion)));
    });

    const activeRef = collection(db, "organizations", organizationId, "rules");
    const unsubActive = onSnapshot(activeRef, (snap) => {
      setActiveRules(snap.docs.map(d => ({ id: d.id, ...d.data() } as Criterion)));
    });

    return () => { unsubPending(); unsubActive(); };
  }, [organizationId]);

  const handleAction = async (rule: Criterion, action: "approved" | "rejected") => {
    if (!organizationId) return;
    try {
      if (action === "approved") {
        await setDoc(doc(db, "organizations", organizationId, "rules", rule.id), {
          rule: rule.rule,
          description: rule.description,
          status: "active"
        });
      }
      await deleteDoc(doc(db, "organizations", organizationId, "pendingRules", rule.id));
    } catch (error) {
      console.error("Error updating rule:", error);
      alert("Error al actualizar la regla.");
    }
  };

  const handleExtraction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!originalFile || !correctedFile || !organizationId) {
        alert("Sube el manuscrito original y el corregido.");
        return;
    }

    setIsExtracting(true);
    try {
      // 1. Upload original
      const origRef = ref(storage, `organizations/${organizationId}/uploads/original_${Date.now()}.docx`);
      await uploadBytes(origRef, originalFile);
      const originalUrl = await getDownloadURL(origRef);

      // 2. Upload corrected
      const corrRef = ref(storage, `organizations/${organizationId}/uploads/corrected_${Date.now()}.docx`);
      await uploadBytes(corrRef, correctedFile);
      const correctedUrl = await getDownloadURL(corrRef);

      // 3. Call AI Worker
      const response = await fetch("http://localhost:8000/api/v1/extract-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId,
          originalFileUrl: originalUrl,
          correctedFileUrl: correctedUrl
        })
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.detail || "API extraction failed");
      }

      setIsModalOpen(false);
      setOriginalFile(null);
      setCorrectedFile(null);
    } catch (error: any) {
      console.error(error);
      alert("Error deduciendo normas: " + error.message);
    } finally {
      setIsExtracting(false);
    }
  };

  return (
    <div className="fade-in" style={{ padding: "2.5rem", maxWidth: "1100px", margin: "0 auto" }}>
      <div className="page-header">
        <div>
          <h1>Criterios Editoriales</h1>
          <p>Gestiona las normas gramaticales, ortotipográficas y de estilo de {role === "SuperAdmin" ? "las organizaciones" : "tu editorial"}.</p>
        </div>
        
        {(role === "SuperAdmin" || role === "Admin" || role === "Responsable Editorial") && (
          <button className="btn" style={{ padding: "0.75rem 1.5rem" }} onClick={() => setIsModalOpen(true)}>
            <FilePlus2 size={18} /> Deducir Nuevas Normas
          </button>
        )}
      </div>

      {pendingRules.length > 0 && (
        <div style={{ marginBottom: "3rem" }}>
          <h2 style={{ fontSize: "1.25rem", fontWeight: 700, color: "var(--text-main)", marginBottom: "1rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <Lightbulb size={22} style={{ color: "var(--warning)" }} /> Normas Deducidas Pendientes
          </h2>
          
          <div style={{ display: "grid", gap: "1rem" }}>
            {pendingRules.map(rule => (
              <div key={rule.id} className="card fade-in" style={{ padding: "1.5rem", borderLeft: "4px solid var(--warning)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.5rem" }}>
                  <h3 style={{ fontSize: "1.0625rem", fontWeight: 700, color: "var(--text-main)" }}>{rule.rule}</h3>
                  <span className="status-badge status-pending" style={{ fontSize: "0.6875rem" }}>NUEVA REGLA DETECTADA</span>
                </div>
                <p style={{ color: "var(--text-muted)", fontSize: "0.875rem", lineHeight: 1.5, marginBottom: "1.25rem" }}>
                  {rule.description}
                </p>
                
                <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end" }}>
                  <button className="btn btn-secondary" style={{ padding: "0.5rem 1.25rem" }} onClick={() => handleAction(rule, "rejected")}>
                    <XCircle size={14} /> Rechazar
                  </button>
                  <button className="btn" style={{ padding: "0.5rem 1.25rem" }} onClick={() => handleAction(rule, "approved")}>
                    <CheckCircle2 size={14} /> Aprobar e Inyectar
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <h2 style={{ fontSize: "1.25rem", fontWeight: 700, color: "var(--text-main)", marginBottom: "1rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <BookOpen size={22} style={{ color: "var(--primary)" }} /> Manual de Estilo Activo
        </h2>
        
        {activeRules.length === 0 ? (
          <div className="card-static" style={{ padding: "3rem", textAlign: "center" }}>
            <p style={{ color: "var(--text-muted)" }}>No hay normas configuradas actualmente.</p>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: "1.25rem" }}>
            {activeRules.map(rule => (
              <div key={rule.id} className="card-static" style={{ padding: "1.5rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <Scale size={16} style={{ color: "var(--primary)" }} />
                  <h3 style={{ fontSize: "1rem", fontWeight: 700, color: "var(--text-main)" }}>{rule.rule}</h3>
                </div>
                <p style={{ color: "var(--text-muted)", fontSize: "0.875rem", lineHeight: 1.5, marginTop: "0.25rem" }}>
                  {rule.description}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {isModalOpen && (
        <div className="modal-overlay">
          <div className="card fade-in modal-content" style={{ maxWidth: "600px" }}>
            <h2 style={{ fontSize: "1.25rem", fontWeight: 700, marginBottom: "0.5rem", color: "var(--text-main)" }}>Deducción de Normas (AI Deductor)</h2>
            <p style={{ color: "var(--text-muted)", fontSize: "0.875rem", marginBottom: "1.5rem" }}>
              Sube el manuscrito original y su versión final corregida para que el motor inteligente detecte los patrones de corrección del editor y extraiga las normas subyacentes.
            </p>
            
            <form onSubmit={handleExtraction}>
              <div style={{ display: "flex", gap: "1rem", marginBottom: "1.5rem" }}>
                <div style={{ flex: 1 }}>
                  <label style={{ display: "block", marginBottom: "0.375rem", fontWeight: 600, color: "var(--text-main)", fontSize: "0.875rem" }}>Documento Original (.docx)</label>
                  <label className="card-static" style={{ cursor: "pointer", display: "flex", justifyContent: "center", alignItems: "center", height: "100px", borderStyle: "dashed", backgroundColor: originalFile ? "rgba(16, 185, 129, 0.05)" : "var(--bg-color)", borderColor: originalFile ? "var(--primary)" : "" }}>
                    <input type="file" accept=".docx" style={{ display: "none" }} onChange={(e) => setOriginalFile(e.target.files?.[0] || null)} />
                    <span style={{ color: originalFile ? "var(--primary)" : "var(--text-muted)", fontSize: "0.75rem", textAlign: "center", padding: "1rem" }}>
                      {originalFile ? originalFile.name : "Haga clic para seleccionar archivo original"}
                    </span>
                  </label>
                </div>
                
                <div style={{ flex: 1 }}>
                  <label style={{ display: "block", marginBottom: "0.375rem", fontWeight: 600, color: "var(--text-main)", fontSize: "0.875rem" }}>Documento Corregido (.docx)</label>
                  <label className="card-static" style={{ cursor: "pointer", display: "flex", justifyContent: "center", alignItems: "center", height: "100px", borderStyle: "dashed", backgroundColor: correctedFile ? "rgba(16, 185, 129, 0.05)" : "var(--bg-color)", borderColor: correctedFile ? "var(--primary)" : "" }}>
                    <input type="file" accept=".docx" style={{ display: "none" }} onChange={(e) => setCorrectedFile(e.target.files?.[0] || null)} />
                    <span style={{ color: correctedFile ? "var(--primary)" : "var(--text-muted)", fontSize: "0.75rem", textAlign: "center", padding: "1rem" }}>
                      {correctedFile ? correctedFile.name : "Haga clic para seleccionar archivo validado"}
                    </span>
                  </label>
                </div>
              </div>
              
              <div style={{ display: "flex", gap: "0.75rem" }}>
                <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setIsModalOpen(false)}>Cancelar</button>
                <button type="submit" className="btn" style={{ flex: 1 }} disabled={isExtracting || !originalFile || !correctedFile}>
                   {isExtracting ? (
                    <span style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>Analizando Archivos...</span>
                  ) : (
                    "Extraer Normas Ocultas"
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
