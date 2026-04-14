"use client";

import { useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { collection, query, orderBy, getDocs, doc, setDoc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { updateBookStatus } from "@/lib/firestore";
import { Document, Packer, Paragraph, TextRun } from "docx";
import { saveAs } from "file-saver";
import "./editor.css";

type Suggestion = {
  id: string;
  originalText: string;
  correctedText: string;
  justification: string;
  status: "pending" | "accepted" | "rejected" | "edited";
  riskLevel: "low" | "medium" | "high";
  sourceRule?: string;
};

export default function EditorPage() {
  const searchParams = useSearchParams();
  const bookId = searchParams.get("bookId");
  const { organizationId, user, role } = useAuth();
  const router = useRouter();

  const [chunks, setChunks] = useState<any[]>([]);
  const [currentChunkIndex, setCurrentChunkIndex] = useState(0);
  const [bookStatus, setBookStatus] = useState<string>("processing");
  
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [selectedSuggestion, setSelectedSuggestion] = useState<string | null>(null);
  const [editingSuggestion, setEditingSuggestion] = useState<string | null>(null);
  const [customEdit, setCustomEdit] = useState("");

  useEffect(() => {
    if (!organizationId || !bookId) return;
    const fetchChunks = async () => {
      try {
        const bookSnap = await getDoc(doc(db, "organizations", organizationId, "books", bookId));
        if (bookSnap.exists()) {
          setBookStatus(bookSnap.data().status);
        }

        const q = query(
          collection(db, "organizations", organizationId, "books", bookId, "chunks"),
          orderBy("order", "asc")
        );
        const snap = await getDocs(q);
        const fetchedChunks = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        setChunks(fetchedChunks);
      } catch (err) {
        console.error("Error fetching chunks:", err);
      }
    };
    fetchChunks();
  }, [organizationId, bookId]);

  useEffect(() => {
    if (chunks.length > 0) {
      const currentChunk = chunks[currentChunkIndex];
      if (currentChunk.suggestions) {
        setSuggestions(currentChunk.suggestions as Suggestion[]);
      } else {
        setSuggestions([]);
      }
    }
  }, [chunks, currentChunkIndex]);

      const handleNextPhase = async () => {
          if (!bookId || !organizationId) return;
          let nextStatus = "review_author";
          if (role === "Editor") nextStatus = "review_author";
          else if (role === "Autor" || role === "Traductor") nextStatus = "review_responsable";
          else if (role === "Responsable_Editorial" || role === "Admin" || role === "SuperAdmin") nextStatus = "approved";
          
          try {
              await updateBookStatus(organizationId, bookId, nextStatus);
              router.push("/dashboard/books");
          } catch (e) {
              console.error("Error avanzando fase", e);
          }
      };

      const handleDownloadDocx = async () => {
        if (chunks.length === 0) return;

        const docChildren = chunks.map(chunk => {
          let computed = chunk.text || "";
          if (chunk.suggestions) {
            chunk.suggestions.forEach((s: Suggestion) => {
              if (s.status !== "rejected") {
                computed = computed.replace(s.originalText, s.correctedText);
              }
            });
          }
          return new Paragraph({
            children: [new TextRun(computed)],
            spacing: { after: 200 }
          });
        });

        const doc = new Document({
          sections: [{
            properties: {},
            children: docChildren
          }]
        });

        const blob = await Packer.toBlob(doc);
        saveAs(blob, "Manuscrito_Corregido.docx");
      };

      const handleAction = async (id: string, action: "accepted" | "rejected") => {
        const newSuggestions = suggestions.map(s => s.id === id ? { ...s, status: action } : s);
        setSuggestions(newSuggestions);
        await saveChunkLocally(newSuggestions);
    
        // Call external learn-correction if accepted
        if (action === "accepted" && organizationId && user) {
            const acceptedSug = newSuggestions.find(s => s.id === id);
            if (acceptedSug) {
                try {
                   const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
                   await fetch(`${apiUrl}/api/v1/learn-correction`, {
                     method: "POST",
                     headers: { "Content-Type": "application/json" },
                     body: JSON.stringify({
                         tenantId: organizationId,
                         authorId: user.uid,
                         role: role,
                         originalText: acceptedSug.originalText,
                         correctedText: acceptedSug.correctedText,
                         justification: acceptedSug.justification
                     })
                   });
                } catch(e) { console.error("Could not trigger learn-correction", e); }
            }
        }
      };
    
      const saveEdit = async (id: string) => {
        if (!customEdit.trim()) return;
        const newSuggestions = suggestions.map(s => s.id === id ? { ...s, status: "edited" as const, correctedText: customEdit } : s);
        setSuggestions(newSuggestions);
        setEditingSuggestion(null);
        await saveChunkLocally(newSuggestions);
      };
    
      const saveChunkLocally = async (newSuggestions: Suggestion[]) => {
        if (!organizationId || !bookId || chunks.length === 0) return;
        const currentChunk = chunks[currentChunkIndex];
        try {
          await setDoc(doc(db, "organizations", organizationId, "books", bookId, "chunks", currentChunk.id), {
            ...currentChunk,
            suggestions: newSuggestions
          }, { merge: true });
          
          const newChunks = [...chunks];
          newChunks[currentChunkIndex].suggestions = newSuggestions;
          setChunks(newChunks);
          
        } catch (e) { console.error("Error saving chunk:", e); }
      };
    
      if (!bookId) return <div style={{ padding: "2rem" }}>No se ha seleccionado ningún libro.</div>;
      if (chunks.length === 0) return <div style={{ padding: "2rem" }}>Cargando o no hay párrafos disponibles...</div>;
    
      const currentChunk = chunks[currentChunkIndex];
      
      const canManageSuggestions = () => {
        if (!role) return false;
        if (["SuperAdmin", "Admin", "Responsable_Editorial", "Editor"].includes(role)) return true;
        
        // Si es Autor o Traductor, el status debe avanzar más allá del procesamiento de la IA para visualizar los botones (mínimo review_author)
        if (["Autor", "Traductor"].includes(role)) {
          return ["review_author", "review_responsable", "approved"].includes(bookStatus);
        }
        return false;
      };
      
      // Calculate dynamic corrected text based on suggestions
      let computedCorrectedText = currentChunk.text || "";
      suggestions.forEach(s => {
          // Simulate preview of all pending/accepted/edited
          if (s.status !== "rejected") {
              computedCorrectedText = computedCorrectedText.replace(s.originalText, s.correctedText);
          }
      });
    
      return (
        <div className="editor-container fade-in">
          <header className="editor-header">
            <div>
              <h1 className="editor-title">Manuscrito: Segmento {currentChunkIndex + 1} de {chunks.length}</h1>
              <p className="editor-stats">{suggestions.filter(s => s.status === "pending").length} sugerencias pendientes en este párrafo</p>
            </div>
            <div className="editor-actions">
              <button className="btn btn-secondary" onClick={() => router.push("/dashboard/books")}>Volver</button>
              <button className="btn btn-secondary" style={{ marginLeft: "0.5rem" }} onClick={() => setCurrentChunkIndex(Math.max(0, currentChunkIndex - 1))} disabled={currentChunkIndex === 0}>← Anterior</button>
              <button className="btn btn-secondary" style={{ marginLeft: "0.5rem" }} onClick={() => setCurrentChunkIndex(Math.min(chunks.length - 1, currentChunkIndex + 1))} disabled={currentChunkIndex === chunks.length - 1}>Siguiente →</button>
              {canManageSuggestions() && (
                <button className="btn" style={{ marginLeft: "1.5rem" }} onClick={handleNextPhase}>Aprobar y Enviar (Cerrar Fase)</button>
              )}
              <button className="btn" style={{ marginLeft: "0.5rem", backgroundColor: "var(--success)" }} onClick={handleDownloadDocx}>Descargar .docx</button>
            </div>
          </header>

      {/* Editor Main Views */}
      {currentChunk.status === "processing" ? (
         <div style={{ textAlign: "center", padding: "4rem", color: "var(--text-muted)" }}>
             Este fragmento aún está siendo procesado por IA...
         </div>
      ) : (
        <div className="pane-wrapper">
          {/* Left Pane - Original */}
          <div className="text-pane">
            <div className="pane-header">Texto Original (Autor)</div>
            <div className="pane-content original-text" style={{ fontSize: "1.0625rem", lineHeight: 1.6 }}>
              {currentChunk.text}
            </div>
          </div>

          {/* Right Pane - Corrected */}
          <div className="text-pane">
            <div className="pane-header" style={{ color: "var(--primary)" }}>Texto Corregido (IA) Preview</div>
            <div className="pane-content corrected-text" style={{ fontSize: "1.0625rem", lineHeight: 1.6 }}>
              {computedCorrectedText}
            </div>
          </div>
        </div>
      )}

      {/* Footer Suggestions Panel */}
      <div className="suggestions-panel">
        <h3 style={{ marginBottom: "1rem", fontWeight: 600 }}>Sugerencias de la IA</h3>
        {suggestions.length === 0 && (
            <p style={{ color: "var(--text-muted)", fontSize: "0.875rem" }}>No se encontraron correcciones necesarias o la IA no ha procesado este fragmento.</p>
        )}
        <div className="suggestions-grid">
          {suggestions.map((suggestion) => (
            <div 
              key={suggestion.id} 
              className={`suggestion-card ${selectedSuggestion === suggestion.id ? 'active' : ''}`}
              onClick={() => setSelectedSuggestion(suggestion.id)}
            >
              <div className="suggestion-header">
                <span className={`risk-badge risk-${suggestion.riskLevel || 'low'}`}>
                  {suggestion.riskLevel === "low" ? "Bajo Riesgo" : suggestion.riskLevel === "medium" ? "Medio Riesgo" : "Alto Riesgo"}
                </span>
                <span className={`status-badge status-${suggestion.status || 'pending'}`}>
                  {suggestion.status === "pending" ? "Pendiente" : suggestion.status === "accepted" ? "Aceptado" : suggestion.status === "rejected" ? "Rechazado" : "Editado"}
                </span>
              </div>
              
              <div className="diff-view">
                <div className="diff-original"><del>{suggestion.originalText}</del></div>
                <div className="diff-arrow">→</div>
                <div className="diff-corrected">{suggestion.correctedText}</div>
              </div>

              <p className="suggestion-justification">{suggestion.justification}</p>

              {(suggestion.status === "pending" || suggestion.status === undefined) && (
                <div className="suggestion-actions">
                  {!canManageSuggestions() ? (
                     <div style={{ width: "100%", marginTop: "0.5rem", fontSize: "0.875rem", color: "var(--text-muted)", fontStyle: "italic" }}>
                        Pendiente de revisión por un Editor. Funciones deshabilitadas.
                     </div>
                  ) : editingSuggestion === suggestion.id ? (
                    <div style={{ width: "100%", marginTop: "0.5rem" }}>
                      <input 
                        type="text" 
                        value={customEdit} 
                        onChange={e => setCustomEdit(e.target.value)} 
                        className="input" 
                        autoFocus
                      />
                      <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
                        <button className="btn" style={{ flex: 1, padding: "0.25rem" }} onClick={(e) => { e.stopPropagation(); saveEdit(suggestion.id); }}>Guardar</button>
                        <button className="btn btn-secondary" style={{ flex: 1, padding: "0.25rem" }} onClick={(e) => { e.stopPropagation(); setEditingSuggestion(null); }}>Cancelar</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <button className="btn-action accept" onClick={(e) => { e.stopPropagation(); handleAction(suggestion.id, "accepted"); }}>✓ Aceptar</button>
                      <button className="btn-action edit" onClick={(e) => { e.stopPropagation(); setCustomEdit(suggestion.correctedText); setEditingSuggestion(suggestion.id); }}>✎ Editar</button>
                      <button className="btn-action reject" onClick={(e) => { e.stopPropagation(); handleAction(suggestion.id, "rejected"); }}>✕ Rechazar</button>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
