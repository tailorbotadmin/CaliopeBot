"use client";

import { useState } from "react";
import "./editor.css";

type Suggestion = {
  id: string;
  originalText: string;
  correctedText: string;
  justification: string;
  status: "pending" | "accepted" | "rejected" | "edited";
  riskLevel: "low" | "medium" | "high";
};

export default function EditorPage() {
  const [originalText, setOriginalText] = useState(`El autor habia propuesto una revision de las practicas, sin envargo los lideres decidierón que no era necesario. Ademas, habian muchos problemas en el sector. "Haber si logramos algo", dijo el capitan.`);
  
  const [correctedText, setCorrectedText] = useState(`El autor había propuesto una revisión de las prácticas, sin embargo los líderes decidieron que no era necesario. Además, había muchos problemas en el sector. «A ver si logramos algo», dijo el capitán.`);

  const [suggestions, setSuggestions] = useState<Suggestion[]>([
    {
      id: "s1",
      originalText: "habia",
      correctedText: "había",
      justification: "Falta de tilde en palabra llana terminada en hiato.",
      status: "pending",
      riskLevel: "low",
    },
    {
      id: "s2",
      originalText: "sin envargo",
      correctedText: "sin embargo",
      justification: "Corrección ortográfica: regla de m antes de b.",
      status: "pending",
      riskLevel: "low",
    },
    {
      id: "s3",
      originalText: "decidierón",
      correctedText: "decidieron",
      justification: "Corrección de tilde: palabra llana terminada en n no lleva tilde.",
      status: "pending",
      riskLevel: "low",
    },
    {
      id: "s4",
      originalText: "habian muchos",
      correctedText: "había muchos",
      justification: "El verbo haber como impersonal en tercera persona singular.",
      status: "pending",
      riskLevel: "medium",
    },
    {
      id: "s5",
      originalText: `"Haber si logramos algo"`,
      correctedText: `«A ver si logramos algo»`,
      justification: "Cambio de comillas a latinas (regla editorial). Confusión de 'haber' con 'a ver'.",
      status: "pending",
      riskLevel: "high",
    }
  ]);

  const [selectedSuggestion, setSelectedSuggestion] = useState<string | null>(null);
  const [editingSuggestion, setEditingSuggestion] = useState<string | null>(null);
  const [customEdit, setCustomEdit] = useState("");

  const handleAction = (id: string, action: "accepted" | "rejected") => {
    setSuggestions(suggestions.map(s => s.id === id ? { ...s, status: action } : s));
  };

  const saveEdit = (id: string) => {
    if (!customEdit.trim()) return;
    setSuggestions(suggestions.map(s => s.id === id ? { ...s, status: "edited", correctedText: customEdit } : s));
    setEditingSuggestion(null);
  };

  return (
    <div className="editor-container fade-in">
      <header className="editor-header">
        <div>
          <h1 className="editor-title">Manuscrito: Criterios Editoriales v1</h1>
          <p className="editor-stats">{suggestions.filter(s => s.status === "pending").length} sugerencias pendientes</p>
        </div>
        <div className="editor-actions">
          <button className="btn btn-secondary">Guardar Progreso</button>
          <button className="btn" style={{ marginLeft: "0.5rem" }}>Aprobar Todo</button>
        </div>
      </header>

      <div className="pane-wrapper">
        {/* Left Pane - Original */}
        <div className="text-pane">
          <div className="pane-header">Texto Original (Autor)</div>
          <div className="pane-content original-text">
            {originalText}
          </div>
        </div>

        {/* Right Pane - Corrected */}
        <div className="text-pane">
          <div className="pane-header" style={{ color: "var(--primary)" }}>Texto Corregido (IA)</div>
          <div className="pane-content corrected-text">
            {correctedText}
          </div>
        </div>
      </div>

      {/* Footer Suggestions Panel */}
      <div className="suggestions-panel">
        <h3 style={{ marginBottom: "1rem", fontWeight: 600 }}>Sugerencias de la IA</h3>
        <div className="suggestions-grid">
          {suggestions.map((suggestion) => (
            <div 
              key={suggestion.id} 
              className={\`suggestion-card \${selectedSuggestion === suggestion.id ? 'active' : ''}\`}
              onClick={() => setSelectedSuggestion(suggestion.id)}
            >
              <div className="suggestion-header">
                <span className={\`risk-badge risk-\${suggestion.riskLevel}\`}>
                  {suggestion.riskLevel === "low" ? "Bajo Riesgo" : suggestion.riskLevel === "medium" ? "Medio Riesgo" : "Alto Riesgo"}
                </span>
                <span className={\`status-badge status-\${suggestion.status}\`}>
                  {suggestion.status === "pending" ? "Pendiente" : suggestion.status === "accepted" ? "Aceptado" : suggestion.status === "rejected" ? "Rechazado" : "Editado"}
                </span>
              </div>
              
              <div className="diff-view">
                <div className="diff-original"><strike>{suggestion.originalText}</strike></div>
                <div className="diff-arrow">→</div>
                <div className="diff-corrected">{suggestion.correctedText}</div>
              </div>

              <p className="suggestion-justification">{suggestion.justification}</p>

              {suggestion.status === "pending" && (
                <div className="suggestion-actions">
                  {editingSuggestion === suggestion.id ? (
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
