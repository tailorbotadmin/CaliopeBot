"use client";

import { useState, useRef, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { auth } from "@/lib/firebase";
import { MessageSquare, X, Send, Paperclip, Trash2, ChevronDown, Loader2, CheckCircle2 } from "lucide-react";
import { usePathname } from "next/navigation";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

const SUBJECTS = [
  "Error / Bug",
  "Sugerencia de mejora",
  "Problema con el análisis IA",
  "Problema con el editor",
  "Pregunta general",
  "Otro",
];

type Status = "idle" | "sending" | "success" | "error";

export default function FeedbackWidget() {
  const { user, organizationId } = useAuth();
  const pathname = usePathname();

  const [open, setOpen]       = useState(false);
  const [message, setMessage] = useState("");
  const [subject, setSubject] = useState(SUBJECTS[0]);
  const [files, setFiles]     = useState<File[]>([]);
  const [status, setStatus]   = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const MAX_FILES = 3;
  const MAX_SIZE_MB = 5;

  const addFiles = useCallback((incoming: FileList | null) => {
    if (!incoming) return;
    const valid = Array.from(incoming).filter(f => {
      if (!f.type.startsWith("image/")) return false;
      if (f.size > MAX_SIZE_MB * 1024 * 1024) return false;
      return true;
    });
    setFiles(prev => [...prev, ...valid].slice(0, MAX_FILES));
  }, []);

  const removeFile = (idx: number) =>
    setFiles(prev => prev.filter((_, i) => i !== idx));

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    addFiles(e.dataTransfer.files);
  }, [addFiles]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim()) return;

    setStatus("sending");
    setErrorMsg("");

    try {
      const token = await auth.currentUser?.getIdToken();
      const form = new FormData();
      form.append("message", message.trim());
      form.append("subject", subject);
      form.append("sender_name", user?.displayName ?? user?.email ?? "");
      form.append("sender_email", user?.email ?? "");
      form.append("org_name", organizationId ?? "");
      form.append("page_url", pathname ?? "");
      files.forEach(f => form.append("screenshots", f));

      const res = await fetch(`${API_URL}/api/v1/feedback`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      setStatus("success");
      setTimeout(() => {
        setOpen(false);
        setStatus("idle");
        setMessage("");
        setSubject(SUBJECTS[0]);
        setFiles([]);
      }, 2500);
    } catch (err) {
      setStatus("error");
      setErrorMsg("No se pudo enviar. Inténtalo de nuevo.");
      setTimeout(() => setStatus("idle"), 3000);
    }
  };

  const toggleOpen = () => {
    setOpen(v => !v);
    setStatus("idle");
    setErrorMsg("");
  };

  return (
    <>
      {/* ── Floating button ──────────────────────────────────────────── */}
      <button
        id="feedback-toggle-btn"
        onClick={toggleOpen}
        aria-label="Enviar feedback"
        title="Soporte y feedback"
        style={{
          position: "fixed",
          bottom: "1.75rem",
          right: "1.75rem",
          zIndex: 9000,
          width: "48px",
          height: "48px",
          borderRadius: "50%",
          border: "none",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: open
            ? "var(--text-muted)"
            : "linear-gradient(135deg, var(--primary) 0%, #818cf8 100%)",
          boxShadow: open
            ? "0 2px 8px rgba(0,0,0,0.18)"
            : "0 4px 20px rgba(99,102,241,0.45)",
          transition: "all 0.2s cubic-bezier(.4,0,.2,1)",
          transform: open ? "rotate(90deg)" : "rotate(0deg)",
          color: "#fff",
        }}
        onMouseEnter={e => { if (!open) (e.currentTarget as HTMLButtonElement).style.transform = "scale(1.1)"; }}
        onMouseLeave={e => { if (!open) (e.currentTarget as HTMLButtonElement).style.transform = "scale(1)"; }}
      >
        {open ? <X size={20} strokeWidth={2.5} /> : <MessageSquare size={20} strokeWidth={2} />}
      </button>

      {/* ── Panel ────────────────────────────────────────────────────── */}
      {open && (
        <div
          id="feedback-panel"
          style={{
            position: "fixed",
            bottom: "5.25rem",
            right: "1.75rem",
            zIndex: 8999,
            width: "min(400px, calc(100vw - 2rem))",
            borderRadius: "var(--radius-xl, 16px)",
            backgroundColor: "var(--card-bg)",
            border: "1px solid var(--border-color)",
            boxShadow: "0 16px 48px rgba(0,0,0,0.22), 0 2px 8px rgba(0,0,0,0.12)",
            animation: "feedbackSlideIn 0.22s cubic-bezier(.4,0,.2,1)",
            overflow: "hidden",
          }}
        >
          {/* Header */}
          <div style={{
            padding: "1.125rem 1.25rem 1rem",
            borderBottom: "1px solid var(--border-color)",
            background: "linear-gradient(135deg, rgba(99,102,241,0.08) 0%, rgba(129,140,248,0.04) 100%)",
            display: "flex",
            alignItems: "center",
            gap: "0.625rem",
          }}>
            <div style={{
              width: "32px", height: "32px", borderRadius: "50%", flexShrink: 0,
              background: "linear-gradient(135deg, var(--primary), #818cf8)",
              display: "flex", alignItems: "center", justifyContent: "center", color: "#fff",
            }}>
              <MessageSquare size={15} strokeWidth={2} />
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: "0.9375rem", color: "var(--text-main)", lineHeight: 1.2 }}>Soporte y Feedback</div>
              <div style={{ fontSize: "0.73rem", color: "var(--text-muted)" }}>Responderemos a la mayor brevedad</div>
            </div>
          </div>

          {/* Body */}
          <div style={{ padding: "1.125rem 1.25rem" }}>

            {status === "success" ? (
              <div style={{ textAlign: "center", padding: "1.5rem 1rem" }}>
                <CheckCircle2 size={44} style={{ color: "var(--success, #10b981)", marginBottom: "0.75rem" }} />
                <div style={{ fontWeight: 700, fontSize: "1rem", color: "var(--text-main)", marginBottom: "0.375rem" }}>¡Mensaje enviado!</div>
                <div style={{ fontSize: "0.825rem", color: "var(--text-muted)" }}>Gracias por tu feedback. Lo revisaremos pronto.</div>
              </div>
            ) : (
              <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "0.875rem" }}>

                {/* Subject */}
                <div>
                  <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, color: "var(--text-muted)", marginBottom: "0.35rem" }}>
                    Asunto
                  </label>
                  <div style={{ position: "relative" }}>
                    <select
                      value={subject}
                      onChange={e => setSubject(e.target.value)}
                      disabled={status === "sending"}
                      style={{
                        width: "100%", appearance: "none", cursor: "pointer",
                        padding: "0.525rem 2rem 0.525rem 0.75rem",
                        borderRadius: "var(--radius-md)", border: "1px solid var(--border-color)",
                        backgroundColor: "var(--bg-color)", color: "var(--text-main)",
                        fontSize: "0.8375rem", fontWeight: 500,
                      }}
                    >
                      {SUBJECTS.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <ChevronDown size={13} style={{ position: "absolute", right: "0.6rem", top: "50%", transform: "translateY(-50%)", pointerEvents: "none", color: "var(--text-muted)" }} />
                  </div>
                </div>

                {/* Message */}
                <div>
                  <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, color: "var(--text-muted)", marginBottom: "0.35rem" }}>
                    Mensaje <span style={{ color: "var(--danger, #ef4444)" }}>*</span>
                  </label>
                  <textarea
                    value={message}
                    onChange={e => setMessage(e.target.value)}
                    placeholder="Describe el problema o sugerencia con el mayor detalle posible..."
                    required
                    rows={4}
                    disabled={status === "sending"}
                    style={{
                      width: "100%", resize: "vertical", minHeight: "90px",
                      padding: "0.625rem 0.75rem", borderRadius: "var(--radius-md)",
                      border: "1px solid var(--border-color)", backgroundColor: "var(--bg-color)",
                      color: "var(--text-main)", fontSize: "0.8375rem", lineHeight: 1.55,
                      fontFamily: "inherit", boxSizing: "border-box",
                    }}
                  />
                </div>

                {/* Screenshot drop zone */}
                <div>
                  <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, color: "var(--text-muted)", marginBottom: "0.35rem" }}>
                    Capturas de pantalla <span style={{ fontWeight: 400 }}>(opcional, máx. {MAX_FILES})</span>
                  </label>
                  <div
                    onDrop={handleDrop}
                    onDragOver={e => { e.preventDefault(); setDragging(true); }}
                    onDragLeave={() => setDragging(false)}
                    onClick={() => files.length < MAX_FILES && fileInputRef.current?.click()}
                    style={{
                      border: `2px dashed ${dragging ? "var(--primary)" : "var(--border-color)"}`,
                      borderRadius: "var(--radius-md)",
                      padding: "0.75rem",
                      backgroundColor: dragging ? "rgba(99,102,241,0.04)" : "var(--bg-color)",
                      cursor: files.length < MAX_FILES ? "pointer" : "default",
                      transition: "all 0.15s",
                      display: "flex",
                      alignItems: "center",
                      gap: "0.5rem",
                      flexWrap: "wrap",
                    }}
                  >
                    {files.length === 0 ? (
                      <span style={{ fontSize: "0.78rem", color: "var(--text-muted)", display: "flex", alignItems: "center", gap: "0.4rem" }}>
                        <Paperclip size={13} /> Arrastra imágenes aquí o haz clic para seleccionar
                      </span>
                    ) : (
                      files.map((f, i) => (
                        <div key={i} style={{
                          display: "flex", alignItems: "center", gap: "0.35rem",
                          backgroundColor: "var(--primary-light, rgba(99,102,241,0.08))",
                          borderRadius: "var(--radius-sm)", padding: "0.2rem 0.5rem",
                          fontSize: "0.73rem", color: "var(--primary)", fontWeight: 500, flexShrink: 0,
                        }}>
                          <span style={{ maxWidth: "110px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
                          <button
                            type="button" onClick={e => { e.stopPropagation(); removeFile(i); }}
                            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 0, display: "flex" }}
                          ><Trash2 size={11} /></button>
                        </div>
                      ))
                    )}
                    {files.length > 0 && files.length < MAX_FILES && (
                      <span style={{ fontSize: "0.73rem", color: "var(--text-muted)", display: "flex", alignItems: "center", gap: "0.3rem" }}>
                        <Paperclip size={11} /> Añadir más
                      </span>
                    )}
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    style={{ display: "none" }}
                    onChange={e => addFiles(e.target.files)}
                  />
                </div>

                {/* Error */}
                {status === "error" && (
                  <div style={{ fontSize: "0.78rem", color: "var(--danger, #ef4444)", backgroundColor: "rgba(239,68,68,0.07)", borderRadius: "var(--radius-sm)", padding: "0.45rem 0.75rem" }}>
                    {errorMsg}
                  </div>
                )}

                {/* Submit */}
                <button
                  type="submit"
                  disabled={status === "sending" || !message.trim()}
                  style={{
                    width: "100%", padding: "0.625rem 1rem",
                    borderRadius: "var(--radius-md)", border: "none", cursor: "pointer",
                    background: (status === "sending" || !message.trim())
                      ? "var(--border-color)"
                      : "linear-gradient(135deg, var(--primary) 0%, #818cf8 100%)",
                    color: "#fff", fontSize: "0.875rem", fontWeight: 700,
                    display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem",
                    transition: "opacity 0.15s",
                    opacity: !message.trim() ? 0.6 : 1,
                  }}
                >
                  {status === "sending"
                    ? <><Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} /> Enviando...</>
                    : <><Send size={15} /> Enviar feedback</>}
                </button>

                <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", textAlign: "center" }}>
                  Enviado como <strong>{user?.email}</strong>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* ── Keyframes (inlined) ──────────────────────────────────────── */}
      <style>{`
        @keyframes feedbackSlideIn {
          from { opacity: 0; transform: translateY(12px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0)   scale(1);    }
        }
      `}</style>
    </>
  );
}
