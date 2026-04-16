"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { getBooksByOrganization, getOrganizations, createBook, updateBookStatus, Book, Organization } from "@/lib/firestore";
import { FolderOpen, FileText, UploadCloud, CheckCircle2, Clock, Loader2, Download, Unlock, AlertCircle, RefreshCw } from "lucide-react";
import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { storage, db } from "@/lib/firebase";
import { collection, query, orderBy, getDocs } from "firebase/firestore";
import { Document, Packer, Paragraph, TextRun } from "docx";
import { saveAs } from "file-saver";
import Link from "next/link";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  draft:               { label: "Borrador",           color: "var(--text-muted)",  bg: "var(--border-color)" },
  processing:          { label: "Analizando…",         color: "#f59e0b",            bg: "rgba(245,158,11,0.12)" },
  review_editor:       { label: "Revisión Editor",     color: "#6366f1",            bg: "rgba(99,102,241,0.12)" },
  ready:               { label: "Revisión Editor",     color: "#6366f1",            bg: "rgba(99,102,241,0.12)" },
  review_author:       { label: "Revisión Autor",      color: "#06b6d4",            bg: "rgba(6,182,212,0.12)" },
  review_responsable:  { label: "Aprobación Final",    color: "#a855f7",            bg: "rgba(168,85,247,0.12)" },
  approved:            { label: "Aprobado",            color: "var(--success)",     bg: "rgba(16,185,129,0.12)" },
  error:               { label: "Error en análisis",  color: "#ef4444",            bg: "rgba(239,68,68,0.12)" },
};

export default function BooksPage() {
  const { user, role, organizationId, loading } = useAuth();
  
  const [books, setBooks] = useState<Book[]>([]);
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedOrgId, setSelectedOrgId] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [reopeningId, setReopeningId] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      if (role === "SuperAdmin") {
        const _orgs = await getOrganizations();
        setOrgs(_orgs);
        if (_orgs.length > 0) {
          const fetchedBooks = await getBooksByOrganization(_orgs[0].id);
          setBooks(fetchedBooks);
          setSelectedOrgId(_orgs[0].id);
        }
      } else if (organizationId) {
        const fetchedBooks = await getBooksByOrganization(organizationId);
        setBooks(fetchedBooks);
        setSelectedOrgId(organizationId);
      }
    } catch (err) {
      console.error("Error al cargar manuscritos", err);
    } finally {
      setIsLoading(false);
    }
  }, [role, organizationId]);

  useEffect(() => {
    if (!loading && user) {
      fetchData();
    }
  }, [loading, user, fetchData]);

  const handleOrgChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const orgId = e.target.value;
    setSelectedOrgId(orgId);
    if (orgId) {
      setIsLoading(true);
      const fetchedBooks = await getBooksByOrganization(orgId);
      setBooks(fetchedBooks);
      setIsLoading(false);
    }
  };

  // ---- Download edited .docx from library ----
  const handleDownloadEditedDocx = async (book: Book) => {
    if (!book.id || !selectedOrgId) return;
    setDownloadingId(book.id);
    try {
      const chunksRef = collection(db, "organizations", selectedOrgId, "books", book.id, "chunks");
      const q = query(chunksRef, orderBy("order", "asc"));
      const snap = await getDocs(q);

      const docChildren = snap.docs.map(d => {
        const data = d.data();
        let text: string = data.text ?? "";
        const suggestions = (data.suggestions ?? []) as Array<{
          status: string; originalText: string; correctedText: string;
        }>;
        suggestions.forEach(s => {
          if (s.status !== "rejected") {
            text = text.replace(s.originalText, s.correctedText);
          }
        });
        return new Paragraph({
          children: [new TextRun(text)],
          spacing: { after: 200 },
        });
      });

      const wordDoc = new Document({
        sections: [{ properties: {}, children: docChildren }],
      });
      const blob = await Packer.toBlob(wordDoc);
      const safeTitle = book.title.replace(/[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑ _-]/g, "");
      saveAs(blob, `${safeTitle}_Editado.docx`);
    } catch (err) {
      console.error("Error generando descarga:", err);
      alert("Error al generar el documento editado.");
    } finally {
      setDownloadingId(null);
    }
  };

  // ---- Reopen editing ----
  const handleReopenEditing = async (book: Book) => {
    if (!confirm(`¿Reabrir la edición de "${book.title}"? El manuscrito volverá al estado de Revisión Editor.`)) return;
    if (!book.id || !selectedOrgId) return;
    setReopeningId(book.id);
    try {
      await updateBookStatus(selectedOrgId, book.id, "review_editor");
      const fetchedBooks = await getBooksByOrganization(selectedOrgId);
      setBooks(fetchedBooks);
    } catch (err) {
      console.error("Error reabriendo edición:", err);
      alert("No se pudo reabrir la edición.");
    } finally {
      setReopeningId(null);
    }
  };

  // ---- Trigger or re-trigger AI Worker ingestion ----
  const triggerIngestion = async (bookId: string, orgId: string, fileUrl: string, authorId: string): Promise<boolean> => {
    try {
      const res = await fetch(`${API_URL}/api/v1/ingest-book`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookId, organizationId: orgId, fileUrl, authorId })
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => res.statusText);
        throw new Error(`Worker respondió ${res.status}: ${detail}`);
      }
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("AI Worker error:", msg);
      // Mark book as error so the user sees it and can retry
      await updateBookStatus(orgId, bookId, "error", msg);
      return false;
    }
  };

  // ---- Retry analysis for a stuck/errored book ----
  const handleRetryIngestion = async (book: Book) => {
    if (!book.id || !book.fileUrl || !selectedOrgId) return;
    if (!confirm(`¿Reintentar el análisis de "${book.title}"?`)) return;
    setRetryingId(book.id);
    try {
      await updateBookStatus(selectedOrgId, book.id, "processing", "");
      const ok = await triggerIngestion(book.id, selectedOrgId, book.fileUrl, book.authorId);
      if (ok) {
        // Worker accepted — update to processing (worker will set review_editor when done)
        await updateBookStatus(selectedOrgId, book.id, "processing");
      }
      const fetchedBooks = await getBooksByOrganization(selectedOrgId);
      setBooks(fetchedBooks);
    } catch (err) {
      console.error("Error reintentando:", err);
    } finally {
      setRetryingId(null);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      if (file.name.endsWith(".docx")) {
        setSelectedFile(file);
        // Auto-fill title if empty
        if (!newTitle) {
          setNewTitle(file.name.replace(".docx", ""));
        }
      } else {
        alert("Por favor, selecciona un archivo Word (.docx) válido.");
      }
    }
  };

  const handleCreateBook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) {
      alert("Por favor, introduce un título.");
      return;
    }
    if (!selectedFile) {
      alert("Por favor, selecciona un archivo.");
      return;
    }
    if (!selectedOrgId) {
      alert("No hay ninguna Organización seleccionada. Debes crear una primero.");
      return;
    }
    setIsSubmitting(true);
    setUploadProgress(0);

    let createdBookId: string | null = null;

    try {
      // 1. Upload to Firebase Storage
      const fileId = `${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      const storagePath = `organizations/${selectedOrgId}/manuscripts/${fileId}.docx`;
      const storageRef = ref(storage, storagePath);
      
      const uploadTask = uploadBytesResumable(storageRef, selectedFile);

      uploadTask.on('state_changed', 
        (snapshot) => {
          const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
          setUploadProgress(progress);
        }, 
        (error) => {
          console.error("Upload error", error);
          alert("Error subiendo el archivo: " + error.message);
          setIsSubmitting(false);
        }, 
        async () => {
          // 2. Get Download URL
          const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
          
          // 3. Create Book in Firestore (status: 'draft' until worker confirms)
          createdBookId = await createBook(selectedOrgId, user!.uid, newTitle.trim(), downloadURL, selectedFile!.name);
          
          // 4. Trigger AI Worker — if it fails the book is marked 'error' automatically
          const ok = await triggerIngestion(createdBookId, selectedOrgId, downloadURL, user!.uid);
          if (ok) {
            // Worker confirmed → set processing (worker will later set review_editor)
            await updateBookStatus(selectedOrgId, createdBookId, "processing");
          }
          // If !ok, triggerIngestion already wrote 'error' status

          // 5. Refresh & Reset
          const fetchedBooks = await getBooksByOrganization(selectedOrgId);
          setBooks(fetchedBooks);
          
          setIsModalOpen(false);
          setNewTitle("");
          setSelectedFile(null);
          setUploadProgress(0);
          setIsSubmitting(false);

          if (!ok) {
            alert(
              "El manuscrito se subió correctamente, pero el servidor de análisis no está disponible.\n" +
              "Puedes volver a intentarlo más tarde con el botón \"Reintentar análisis\"."
            );
          }
        }
      );
    } catch (err) {
      console.error(err);
      if (createdBookId) {
        await updateBookStatus(selectedOrgId, createdBookId, "error",
          err instanceof Error ? err.message : "Error inesperado");
      }
      alert("Error inesperado subiendo el manuscrito");
      setIsSubmitting(false);
    }
  };

  if (loading || isLoading) {
    return <div style={{ padding: "2.5rem", color: "var(--text-muted)" }}>Cargando catálogo...</div>;
  }

  return (
    <div className="fade-in" style={{ padding: "2.5rem", maxWidth: "1100px", margin: "0 auto" }}>
      {/* Header */}
      <div className="page-header">
        <div>
          <h1>{(role === "Autor" || role === "Traductor") ? "Mis Manuscritos" : "Catálogo de Manuscritos"}</h1>
          <p>Sube archivos Word (.docx) para que sean ingestados y analizados mediante procesamiento por lotes.</p>
        </div>
        
        <button className="btn" style={{ padding: "0.75rem 1.5rem" }} onClick={() => setIsModalOpen(true)}>
          <FolderOpen size={18} style={{ marginRight: "0.5rem", display: "inline-block", verticalAlign: "middle" }} />
          Subir Manuscrito
        </button>
      </div>

      {/* Org Selector for SuperAdmins */}
      {role === "SuperAdmin" && orgs.length > 0 && (
        <div className="card-static" style={{ marginBottom: "1.5rem", padding: "1rem 1.25rem", display: "flex", alignItems: "center", gap: "1rem" }}>
          <label style={{ fontWeight: 600, fontSize: "0.875rem", color: "var(--text-main)", whiteSpace: "nowrap" }}>Entorno:</label>
          <select className="input" value={selectedOrgId} onChange={handleOrgChange} style={{ maxWidth: "280px" }}>
            {orgs.map(org => (
              <option key={org.id} value={org.id}>{org.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* Books Grid */}
      {books.length === 0 ? (
        <div className="card-static" style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "4rem 2rem", textAlign: "center" }}>
          <div style={{ width: "56px", height: "56px", borderRadius: "var(--radius-lg)", backgroundColor: "var(--primary-light)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "1.25rem", color: "var(--primary)" }}>
            <FolderOpen size={28} strokeWidth={1.75} />
          </div>
          <h3 style={{ fontSize: "1.125rem", fontWeight: 700, color: "var(--text-main)" }}>No hay manuscritos en esta organización</h3>
          <p style={{ color: "var(--text-muted)", marginTop: "0.5rem", fontSize: "0.875rem" }}>Sube el primer documento para comenzar el proceso de corrección.</p>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "1.25rem" }}>
          {books.map(book => {
            const sc = STATUS_CONFIG[book.status] ?? STATUS_CONFIG.draft;
            const dateStr = book.createdAt?.toDate ? book.createdAt.toDate().toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
            return (
              <div key={book.id} className="card" style={{ padding: "1.5rem", display: "flex", flexDirection: "column" }}>
                <div style={{ marginBottom: "1rem" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.625rem" }}>
                    <span style={{ fontSize: "0.7rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", padding: "0.2rem 0.6rem", borderRadius: "99px", backgroundColor: sc.bg, color: sc.color, display: "flex", alignItems: "center", gap: "0.25rem" }}>
                      {book.status === 'processing' && <Loader2 size={10} style={{ animation: 'spin 1s linear infinite' }} />}
                      {book.status === 'error' && <AlertCircle size={10} />}
                      {sc.label}
                    </span>
                    <span style={{ fontSize: "0.7rem", color: "var(--text-muted)", display: "flex", alignItems: "center", gap: "0.25rem" }}>
                      <Clock size={11} /> {dateStr}
                    </span>
                  </div>
                  <h3 style={{ fontSize: "1.0625rem", fontWeight: 700, color: "var(--text-main)", lineHeight: 1.3 }}>{book.title}</h3>
                  {book.fileName && (
                    <p style={{ display: "flex", alignItems: "center", gap: "0.25rem", fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.4rem" }}>
                      <FileText size={12} /> {book.fileName}
                    </p>
                  )}
                  {/* Error message for failed ingestions */}
                  {book.status === 'error' && (
                    <p style={{ fontSize: "0.7rem", color: "#ef4444", marginTop: "0.5rem", padding: "0.4rem 0.6rem", background: "rgba(239,68,68,0.08)", borderRadius: "var(--radius)", borderLeft: "2px solid #ef4444" }}>
                      El servidor de análisis no pudo procesar este manuscrito. Puedes volver a intentarlo.
                    </p>
                  )}
                </div>

                <div style={{ marginTop: "auto", paddingTop: "0.875rem", borderTop: "1px solid var(--border-color)", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  {/* Retry button for error or stuck-processing books */}
                  {(book.status === 'error' || book.status === 'draft') && book.fileUrl && (
                    <button
                      className="btn"
                      style={{
                        width: "100%", fontSize: "0.8125rem",
                        backgroundColor: "#ef4444", display: "flex",
                        alignItems: "center", justifyContent: "center", gap: "0.375rem",
                      }}
                      onClick={() => handleRetryIngestion(book)}
                      disabled={retryingId === book.id}
                    >
                      {retryingId === book.id
                        ? <><Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> Reintentando...</>
                        : <><RefreshCw size={14} /> Reintentar análisis</>}
                    </button>
                  )}
                  {book.status === "approved" && (
                    <>
                      <button
                        className="btn"
                        style={{
                          width: "100%", fontSize: "0.8125rem",
                          backgroundColor: "var(--success)", display: "flex",
                          alignItems: "center", justifyContent: "center", gap: "0.375rem",
                        }}
                        onClick={() => handleDownloadEditedDocx(book)}
                        disabled={downloadingId === book.id}
                      >
                        {downloadingId === book.id
                          ? <><Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> Generando...</>
                          : <><Download size={14} /> Descargar Editado</>}
                      </button>
                      <button
                        className="btn btn-secondary"
                        style={{
                          width: "100%", fontSize: "0.8125rem",
                          display: "flex", alignItems: "center", justifyContent: "center", gap: "0.375rem",
                          borderColor: "#f59e0b", color: "#f59e0b",
                        }}
                        onClick={() => handleReopenEditing(book)}
                        disabled={reopeningId === book.id}
                      >
                        {reopeningId === book.id
                          ? <><Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> Reabriendo...</>
                          : <><Unlock size={14} /> Reabrir Edición</>}
                      </button>
                    </>
                  )}
                  {book.status !== 'error' && book.status !== 'draft' && (
                    <Link
                      href={`/dashboard/editor?bookId=${book.id}`}
                      className="btn btn-secondary"
                      style={{ textDecoration: "none", width: "100%", fontSize: "0.8125rem", display: "block", textAlign: "center" }}
                    >
                      {book.status === "approved" ? "Ver en Editor" : "Abrir Editor →"}
                    </Link>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Upload Modal */}
      {isModalOpen && (
        <div className="modal-overlay">
          <div className="card fade-in modal-content" style={{ maxWidth: "500px" }}>
            <h2 style={{ fontSize: "1.25rem", fontWeight: 700, marginBottom: "1.5rem", color: "var(--text-main)" }}>Nuevo Manuscrito</h2>
            
            <form onSubmit={handleCreateBook}>
              <div style={{ marginBottom: "1.25rem" }}>
                <label 
                  className="card-static" 
                  style={{ 
                    cursor: "pointer", 
                    display: "flex", 
                    flexDirection: "column",
                    justifyContent: "center", 
                    alignItems: "center", 
                    height: "120px", 
                    borderStyle: "dashed",
                    borderColor: selectedFile ? "var(--primary)" : "var(--border-color)",
                    backgroundColor: selectedFile ? "rgba(233, 68, 90, 0.05)" : "var(--bg-color)"
                  }}
                >
                  <input 
                    type="file" 
                    accept=".docx" 
                    style={{ display: "none" }} 
                    ref={fileInputRef}
                    onChange={handleFileChange}
                  />
                  {selectedFile ? (
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.375rem" }}>
                      <CheckCircle2 style={{ color: "var(--primary)" }} />
                      <span style={{ color: "var(--text-main)", fontSize: "0.875rem", fontWeight: 600 }}>{selectedFile.name}</span>
                      <span style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>
                        {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                      </span>
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.5rem" }}>
                       <UploadCloud size={24} style={{ color: "var(--text-muted)" }} />
                       <span style={{ color: "var(--text-muted)", fontSize: "0.875rem" }}>Seleccionar archivo Word (.docx)</span>
                    </div>
                  )}
                </label>
              </div>

              <div style={{ marginBottom: "1.75rem" }}>
                <label style={{ display: "block", marginBottom: "0.375rem", fontWeight: 600, color: "var(--text-main)", fontSize: "0.875rem" }}>Título de la Obra</label>
                <input 
                  type="text" 
                  className="input" 
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="Ej. Cien años de soledad"
                  required
                />
              </div>

              {isSubmitting && (
                <div style={{ marginBottom: "1.5rem" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", marginBottom: "0.375rem" }}>
                    <span style={{ color: "var(--text-muted)" }}>Subiendo archivo...</span>
                    <span style={{ fontWeight: 600, color: "var(--primary)" }}>{Math.round(uploadProgress)}%</span>
                  </div>
                  <div style={{ width: "100%", height: "6px", backgroundColor: "var(--border-color)", borderRadius: "3px", overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${uploadProgress}%`, backgroundColor: "var(--primary)", transition: "width 0.2s ease" }} />
                  </div>
                </div>
              )}

              <div style={{ display: "flex", gap: "0.75rem" }}>
                <button 
                  type="button" 
                  className="btn btn-secondary" 
                  style={{ flex: 1 }} 
                  onClick={() => setIsModalOpen(false)}
                  disabled={isSubmitting}
                >
                  Cancelar
                </button>
                <button type="submit" className="btn" style={{ flex: 1 }} disabled={isSubmitting || !selectedFile || !newTitle.trim()}>
                  {isSubmitting ? "Procesando..." : "Subir Manuscrito"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
