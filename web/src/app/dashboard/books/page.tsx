"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import {
  getBooksByOrganization, getOrganizations, createBook,
  updateBookStatus, assignBookEditor, notifyResponsables, createNotification,
  Book, Organization, getOrgUsers, UserProfile,
} from "@/lib/firestore";
import {
  FolderOpen, FileText, UploadCloud, CheckCircle2, Clock, Loader2,
  Download, Unlock, AlertCircle, RefreshCw, Trash2, UserCircle2, Plus, X, UserCheck,
} from "lucide-react";
import { ref, uploadBytesResumable, getDownloadURL, deleteObject } from "firebase/storage";
import { storage, db } from "@/lib/firebase";
import { collection, query, orderBy, getDocs, doc, deleteDoc } from "firebase/firestore";
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
  error:               { label: "Error",               color: "#ef4444",            bg: "rgba(239,68,68,0.12)" },
};

// Admin kept for backward-compat with existing tokens; Responsable_Editorial is the canonical admin role
const ADMIN_ROLES = ["SuperAdmin", "Responsable_Editorial"];

export default function BooksPage() {
  const { user, role, organizationId, loading } = useAuth();

  const [books, setBooks] = useState<Book[]>([]);
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [orgAuthors, setOrgAuthors] = useState<UserProfile[]>([]);
  const [orgEditors, setOrgEditors] = useState<UserProfile[]>([]); // Editors for assignment
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedOrgId, setSelectedOrgId] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  // Author selection in modal
  const [selectedAuthorId, setSelectedAuthorId] = useState("");
  const [newAuthorName, setNewAuthorName] = useState("");
  const [showAddAuthor, setShowAddAuthor] = useState(false);
  const [addingAuthor, setAddingAuthor] = useState(false);

  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [reopeningId, setReopeningId] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Delete confirmation modal
  const [deleteTarget, setDeleteTarget] = useState<Book | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const isAdmin = ADMIN_ROLES.includes(role ?? "");
  const isAuthor = role === "Autor";

  // Load authors (Autor/Traductor) for the selected org
  const loadAuthors = useCallback(async (orgId: string) => {
    if (!isAdmin) return;
    try {
      const users = await getOrgUsers(orgId);
      setOrgAuthors(users.filter(u => u.role === "Autor"));
      // Also load editors for assignment
      setOrgEditors(users.filter(u => u.role === "Editor" || u.role === "Responsable_Editorial"));
    } catch {
      setOrgAuthors([]);
      setOrgEditors([]);
    }
  }, [isAdmin]);

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
          await loadAuthors(_orgs[0].id);
        }
      } else if (organizationId) {
        const fetchedBooks = isAuthor
          ? (await getBooksByOrganization(organizationId)).filter(b => b.authorId === user!.uid)
          : await getBooksByOrganization(organizationId);
        setBooks(fetchedBooks);
        setSelectedOrgId(organizationId);
        await loadAuthors(organizationId);
      }
    } catch (err) {
      console.error("Error al cargar manuscritos", err);
    } finally {
      setIsLoading(false);
    }
  }, [role, organizationId, isAuthor, user, loadAuthors]);

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
      await loadAuthors(orgId);
      setIsLoading(false);
    }
  };

  // ---- Download edited .docx ----
  const handleDownloadEditedDocx = async (book: Book) => {
    if (!book.id || !selectedOrgId) return;
    setDownloadingId(book.id);
    try {
      const chunksRef = collection(db, "organizations", selectedOrgId, "books", book.id, "chunks");
      const q = query(chunksRef, orderBy("order", "asc"));
      const snap = await getDocs(q);

      const paragraphs: Paragraph[] = [];
      snap.docs.forEach(d => {
        const data = d.data();
        const text = data.text ?? "";
        const suggestions: { originalText: string; correctedText: string; status: string }[] =
          data.suggestions ?? [];
        let final = text;
        suggestions
          .filter(s => s.status === "accepted")
          .sort((a, b) => b.originalText.length - a.originalText.length)
          .forEach(s => { final = final.replaceAll(s.originalText, s.correctedText); });

        paragraphs.push(new Paragraph({
          children: [new TextRun({ text: final, size: 24, font: "Times New Roman" })],
          spacing: { after: 200 },
        }));
      });

      const doc2 = new Document({ sections: [{ properties: {}, children: paragraphs }] });
      const blob = await Packer.toBlob(doc2);
      saveAs(blob, `${book.title.replace(/\s+/g, "_")}_editado.docx`);
    } catch (err) {
      console.error("Error descargando:", err);
      alert("Error generando el documento editado.");
    } finally {
      setDownloadingId(null);
    }
  };

  // ---- Reopen editing ----
  const handleReopenEditing = async (book: Book) => {
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

  // ---- Delete book (with confirmation modal) ----
  const handleDeleteBook = async (book: Book) => {
    if (!book.id || !selectedOrgId) {
      alert("Error: no hay organización seleccionada.");
      return;
    }
    setDeletingId(book.id);
    try {
      // 1. Delete all chunks (subcollection)
      const chunksRef = collection(db, "organizations", selectedOrgId, "books", book.id, "chunks");
      const chunksSnap = await getDocs(chunksRef);
      const delChunks = chunksSnap.docs.map(d => deleteDoc(d.ref));
      await Promise.all(delChunks);

      // 2. Delete the book document
      await deleteDoc(doc(db, "organizations", selectedOrgId, "books", book.id));

      // 3. Try to delete the Storage file (best-effort — extract path from URL)
      if (book.fileUrl) {
        try {
          // Firebase Storage URLs contain the path after /o/
          const pathMatch = book.fileUrl.match(/\/o\/(.+?)(\?|$)/);
          if (pathMatch) {
            const storagePath = decodeURIComponent(pathMatch[1]);
            const fileRef = ref(storage, storagePath);
            await deleteObject(fileRef);
          }
        } catch {
          // Ignore — file may already be deleted or inaccessible
        }
      }

      // 4. Remove from local state
      setBooks(prev => prev.filter(b => b.id !== book.id));
      setDeleteTarget(null);
    } catch (err) {
      console.error("Error eliminando manuscrito:", err);
      alert("No se pudo eliminar el manuscrito: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setDeletingId(null);
    }
  };

  // ---- Assign corrector (editor) to a book ----
  const handleAssignEditor = async (book: Book, editorId: string) => {
    if (!selectedOrgId) return;
    setAssigningId(book.id);
    try {
      const editor = editorId ? orgEditors.find(e => e.uid === editorId) ?? null : null;
      await assignBookEditor(
        selectedOrgId,
        book.id,
        editor ? editor.uid : null,
        editor ? (editor.displayName ?? editor.email) : null,
      );
      setBooks(prev => prev.map(b =>
        b.id === book.id
          ? { ...b, assignedEditorId: editor?.uid ?? undefined, assignedEditorName: editor ? (editor.displayName ?? editor.email) : undefined }
          : b
      ));
      // Notify assigned editor
      if (editor && selectedOrgId) {
        try {
          await createNotification(selectedOrgId, {
            type: "editor_assigned",
            title: "Manuscrito asignado para corrección",
            message: `Se te ha asignado el manuscrito "${book.title}" para que lo corrijas.`,
            bookId: book.id,
            bookTitle: book.title,
            recipientId: editor.uid,
            organizationId: selectedOrgId,
            read: false,
          });
        } catch { /* non-critical */ }
      }
    } catch (err) {
      console.error("Error asignando corrector:", err);
      alert("No se pudo asignar el corrector.");
    } finally {
      setAssigningId(null);
    }
  };

  // ---- Trigger AI Worker ----
  const triggerIngestion = async (bookId: string, orgId: string, fileUrl: string, authorId: string): Promise<boolean> => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000);
      const res = await fetch(`${API_URL}/api/v1/ingest-book`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookId, organizationId: orgId, fileUrl, authorId }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (!res.ok) {
        const detail = await res.text().catch(() => res.statusText);
        throw new Error(`Worker respondió ${res.status}: ${detail}`);
      }
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("AI Worker error:", msg);
      await updateBookStatus(orgId, bookId, "error", msg);
      return false;
    }
  };

  // ---- Retry analysis ----
  const handleRetryIngestion = async (book: Book) => {
    if (!book.id || !book.fileUrl || !selectedOrgId) return;
    if (!confirm(`¿Reintentar el análisis de "${book.title}"?`)) return;
    setRetryingId(book.id);
    try {
      await updateBookStatus(selectedOrgId, book.id, "processing", "");
      const ok = await triggerIngestion(book.id, selectedOrgId, book.fileUrl, book.authorId);
      if (ok) {
        const fetchedBooks = await getBooksByOrganization(selectedOrgId);
        setBooks(fetchedBooks);
      }
    } catch (err) {
      console.error("Error reintentando:", err);
    } finally {
      setRetryingId(null);
    }
  };

  // Retry analysis for stuck books (status=processing, chunks already exist)
  const handleRetryAnalysis = async (book: Book) => {
    if (!book.id || !selectedOrgId) return;
    // No confirm() — blocks silently in production/CSP environments
    setRetryingId(book.id);
    try {
      const token = await user?.getIdToken();
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/v1/retry-book`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({
          organizationId: selectedOrgId,
          bookId: book.id,
          authorId: book.authorId ?? "",
        }),
      });
      if (res.ok) {
        const data = await res.json();
        console.log("Retry triggered:", data);
        // Refresh book list to reflect new status
        const fetchedBooks = await getBooksByOrganization(selectedOrgId);
        setBooks(fetchedBooks);
      } else {
        const errBody = await res.json().catch(() => ({}));
        alert(`Error al reintentar: ${errBody.detail ?? res.statusText}`);
      }
    } catch (err) {
      console.error("Error en retryAnalysis:", err);
      alert("Error al conectar con el servidor de análisis.");
    } finally {
      setRetryingId(null);
    }
  };


  // ---- Add new author ----
  const handleAddAuthor = async () => {
    if (!newAuthorName.trim() || !selectedOrgId) return;
    setAddingAuthor(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/users/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: newAuthorName.trim(),
          role: "Autor",
          organizationId: selectedOrgId,
          createdBy: user?.uid,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const newAuthor: UserProfile = {
          uid: data.uid ?? `temp_${Date.now()}`,
          email: data.email ?? "",
          displayName: newAuthorName.trim(),
          role: "Autor",
          organizationId: selectedOrgId,
          createdAt: new Date() as never,
        };
        setOrgAuthors(prev => [...prev, newAuthor]);
        setSelectedAuthorId(newAuthor.uid);
        setNewAuthorName("");
        setShowAddAuthor(false);
      } else {
        alert("No se pudo crear el autor. Usa Configuración → Usuarios para añadirlo.");
      }
    } catch {
      alert("Error conectando con el servidor para crear el autor.");
    } finally {
      setAddingAuthor(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      if (file.name.endsWith(".docx")) {
        setSelectedFile(file);
        if (!newTitle) setNewTitle(file.name.replace(".docx", ""));
      } else {
        alert("Por favor, selecciona un archivo Word (.docx) válido.");
      }
    }
  };

  const openModal = () => {
    setIsModalOpen(true);
    // Pre-select current user if Autor
    if (isAuthor && user) setSelectedAuthorId(user.uid);
    else setSelectedAuthorId(orgAuthors[0]?.uid ?? "");
  };

  const handleCreateBook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) { alert("Por favor, introduce un título."); return; }
    if (!selectedFile) { alert("Por favor, selecciona un archivo."); return; }
    if (!selectedOrgId) { alert("No hay ninguna Organización seleccionada."); return; }

    // Determine authorId
    const effectiveAuthorId = isAuthor ? user!.uid : (selectedAuthorId || user!.uid);

    setIsSubmitting(true);
    setUploadProgress(0);
    let createdBookId: string | null = null;

    try {
      const fileId = `${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      const storagePath = `organizations/${selectedOrgId}/manuscripts/${fileId}.docx`;
      const storageRef = ref(storage, storagePath);
      const uploadTask = uploadBytesResumable(storageRef, selectedFile);

      uploadTask.on("state_changed",
        (snapshot) => {
          setUploadProgress((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
        },
        (error) => {
          console.error("Upload error", error);
          alert("Error subiendo el archivo: " + error.message);
          setIsSubmitting(false);
        },
        async () => {
          const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
          createdBookId = await createBook(
            selectedOrgId,
            effectiveAuthorId,
            newTitle.trim(),
            downloadURL,
            selectedFile!.name,
            // store author display name for easy display in the list
            orgAuthors.find(a => a.uid === effectiveAuthorId)?.displayName
              ?? (effectiveAuthorId === user!.uid ? (user!.displayName ?? user!.email ?? "") : "")
          );
          const ok = await triggerIngestion(createdBookId, selectedOrgId, downloadURL, effectiveAuthorId);
          if (ok) {
            await updateBookStatus(selectedOrgId, createdBookId, "processing");
            // Notify Responsables Editoriales
            try {
              await notifyResponsables(selectedOrgId, {
                type: "manuscript_uploaded",
                title: "Nuevo manuscrito subido",
                message: `${user!.displayName ?? user!.email} ha subido "${newTitle.trim()}" para revisión.`,
                bookId: createdBookId,
                bookTitle: newTitle.trim(),
                organizationId: selectedOrgId,
                read: false,
              });
            } catch { /* non-critical */ }
          }

          const fetchedBooks = isAuthor
            ? (await getBooksByOrganization(selectedOrgId)).filter(b => b.authorId === user!.uid)
            : await getBooksByOrganization(selectedOrgId);
          setBooks(fetchedBooks);

          setIsModalOpen(false);
          setNewTitle("");
          setSelectedFile(null);
          setUploadProgress(0);
          setSelectedAuthorId("");
          setNewAuthorName("");
          setShowAddAuthor(false);
          setIsSubmitting(false);

          if (!ok) {
            // Notify Author of failed processing
            try {
              if (organizationId && user) {
                await createNotification(organizationId, {
                  type: "upload_failed",
                  title: "Error en el análisis del manuscrito",
                  message: `No se pudo analizar "${newTitle.trim()}". Usa el botón "Reintentar análisis" cuando el servidor esté disponible.`,
                  bookId: createdBookId,
                  bookTitle: newTitle.trim(),
                  recipientId: user.uid,
                  organizationId: organizationId,
                  read: false,
                });
              }
            } catch { /* non-critical */ }
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
          <h1>{isAuthor ? "Mis Manuscritos" : "Catálogo de Manuscritos"}</h1>
          <p>Sube archivos Word (.docx) para que sean analizados mediante IA editorial.</p>
        </div>
        <button className="btn" style={{ padding: "0.75rem 1.5rem" }} onClick={openModal}>
          <FolderOpen size={18} style={{ marginRight: "0.5rem", display: "inline-block", verticalAlign: "middle" }} />
          Subir Manuscrito
        </button>
      </div>

      {/* Editorial Selector for SuperAdmins */}
      {role === "SuperAdmin" && orgs.length > 0 && (
        <div className="card-static" style={{ marginBottom: "1.5rem", padding: "1rem 1.25rem", display: "flex", alignItems: "center", gap: "1rem" }}>
          <label style={{ fontWeight: 600, fontSize: "0.875rem", color: "var(--text-main)", whiteSpace: "nowrap" }}>Editorial:</label>
          <select className="input" value={selectedOrgId} onChange={handleOrgChange} style={{ maxWidth: "280px" }}>
            {orgs.map(org => (
              <option key={org.id} value={org.id}>{org.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* Books List */}
      {books.length === 0 ? (
        <div className="card-static" style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "4rem 2rem", textAlign: "center" }}>
          <div style={{ width: "56px", height: "56px", borderRadius: "var(--radius-lg)", backgroundColor: "var(--primary-light)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "1.25rem", color: "var(--primary)" }}>
            <FolderOpen size={28} strokeWidth={1.75} />
          </div>
          <h3 style={{ fontSize: "1.125rem", fontWeight: 700, color: "var(--text-main)" }}>No hay manuscritos en esta editorial</h3>
          <p style={{ color: "var(--text-muted)", marginTop: "0.5rem", fontSize: "0.875rem" }}>Sube el primer documento para comenzar el proceso de corrección.</p>
        </div>
      ) : (
        <div className="card-static" style={{ overflow: "hidden", padding: 0 }}>
          {/* List header */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "200px 100px 150px 105px 80px 145px",
            gap: "0 0.5rem",
            padding: "0.625rem 1.25rem",
            borderBottom: "1px solid var(--border-color)",
            fontSize: "0.7rem",
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            color: "var(--text-muted)",
          }}>
            <span>Manuscrito</span>
            <span>Autor</span>
            <span>Editor asignado</span>
            <span>Estado</span>
            <span>Fecha</span>
            <span style={{ textAlign: "right" }}>Acciones</span>
          </div>

          {books.map((book, idx) => {
            const sc = STATUS_CONFIG[book.status] ?? STATUS_CONFIG.draft;
            const dateStr = book.createdAt?.toDate
              ? book.createdAt.toDate().toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" })
              : "—";
            const isLast = idx === books.length - 1;
            return (
              <div
                key={book.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "200px 100px 150px 105px 80px 145px",
                  gap: "0 0.5rem",
                  padding: "0.875rem 1.25rem",
                  alignItems: "center",
                  borderBottom: isLast ? "none" : "1px solid var(--border-color)",
                  transition: "background 0.15s",
                }}
                onMouseEnter={e => (e.currentTarget.style.background = "var(--bg-color)")}
                onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
              >
                {/* Title + filename */}
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.2rem" }}>
                    <FileText size={15} style={{ color: "var(--primary)", flexShrink: 0 }} />
                    <span style={{ fontWeight: 700, fontSize: "0.9375rem", color: "var(--text-main)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {book.title}
                    </span>
                  </div>
                  {book.fileName && (
                    <span style={{ fontSize: "0.7rem", color: "var(--text-muted)", paddingLeft: "1.4rem" }}>{book.fileName}</span>
                  )}
                  {book.status === "error" && (
                    <p style={{ fontSize: "0.68rem", color: "#ef4444", marginTop: "0.25rem", paddingLeft: "1.4rem" }}>
                      Error en la edición — usa Reintentar
                    </p>
                  )}
                </div>

                {/* Autor column */}
                <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", display: "flex", alignItems: "center", gap: "0.3rem", overflow: "hidden" }}>
                  <UserCircle2 size={12} style={{ flexShrink: 0 }} />
                  <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {book.authorName
                      ?? orgAuthors.find(a => a.uid === book.authorId)?.displayName
                      ?? (book.authorId === user?.uid ? (user?.displayName ?? "Yo") : book.authorId.slice(0, 8))}
                  </span>
                </div>

                {/* Editor asignado column — dropdown for admins, label for others */}
                <div style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}>
                  {isAdmin ? (
                    <>
                      <UserCheck size={12} style={{ color: "var(--primary)", flexShrink: 0 }} />
                      <select
                        value={book.assignedEditorId ?? ""}
                        onChange={e => handleAssignEditor(book, e.target.value)}
                        disabled={assigningId === book.id || orgEditors.length === 0}
                        title={orgEditors.length === 0 ? "No hay editores en la organización" : "Asignar editor"}
                        style={{
                          fontSize: "0.78rem",
                          padding: "0.2rem 0.3rem",
                          borderRadius: "var(--radius)",
                          border: "1px solid var(--border-color)",
                          backgroundColor: book.assignedEditorId ? "rgba(99,102,241,0.08)" : "var(--card-bg)",
                          color: book.assignedEditorId ? "#6366f1" : "var(--text-muted)",
                          cursor: orgEditors.length === 0 ? "not-allowed" : "pointer",
                          width: "100%",
                          maxWidth: "155px",
                        }}
                      >
                        <option value="">{orgEditors.length === 0 ? "Sin editores" : "Sin asignar"}</option>
                        {orgEditors.map(e => (
                          <option key={e.uid} value={e.uid}>{e.displayName ?? e.email}</option>
                        ))}
                      </select>
                    </>
                  ) : (
                    <span style={{ fontSize: "0.78rem", color: book.assignedEditorName ? "#6366f1" : "var(--text-muted)" }}>
                      {book.assignedEditorName ?? "—"}
                    </span>
                  )}
                </div>

                {/* Status badge */}
                <div>
                  <span style={{
                    display: "inline-flex", alignItems: "center", gap: "0.25rem",
                    fontSize: "0.68rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em",
                    padding: "0.2rem 0.5rem", borderRadius: "99px",
                    backgroundColor: sc.bg, color: sc.color,
                  }}>
                    {book.status === "processing" && <Loader2 size={9} style={{ animation: "spin 1s linear infinite" }} />}
                    {book.status === "error" && <AlertCircle size={9} />}
                    {sc.label}
                  </span>
                </div>

                {/* Date */}
                <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", display: "flex", alignItems: "center", gap: "0.3rem" }}>
                  <Clock size={11} />{dateStr}
                </div>

                {/* Actions */}
                <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: "0.375rem" }}>
                  {/* Retry — for error/draft: full re-ingestion */}
                  {(book.status === "error" || book.status === "draft") && book.fileUrl && (
                    <button
                      title="Reintentar análisis (re-ingesta)"
                      className="btn btn-secondary"
                      style={{ padding: "0.3rem 0.5rem", fontSize: "0.75rem", display: "flex", alignItems: "center", gap: "0.25rem" }}
                      onClick={() => handleRetryIngestion(book)}
                      disabled={retryingId === book.id}
                    >
                      {retryingId === book.id
                        ? <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} />
                        : <RefreshCw size={13} />}
                    </button>
                  )}

                  {/* Retry — for stuck processing: re-trigger analysis without re-ingestion */}
                  {book.status === "processing" && (
                    <button
                      title="El análisis parece bloqueado. Haz clic para reiniciarlo."
                      className="btn btn-secondary"
                      style={{ padding: "0.3rem 0.5rem", fontSize: "0.75rem", display: "flex", alignItems: "center", gap: "0.25rem", color: "#f59e0b", borderColor: "rgba(245,158,11,0.4)" }}
                      onClick={() => handleRetryAnalysis(book)}
                      disabled={retryingId === book.id}
                    >
                      {retryingId === book.id
                        ? <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} />
                        : <RefreshCw size={13} />}
                    </button>
                  )}

                  {/* Retry analysis — for review_editor with 0 suggestions (analysis failed silently) */}
                  {book.status === "review_editor" && (
                    <button
                      title="Reanálisis IA (el análisis anterior falló)"
                      className="btn btn-secondary"
                      style={{ padding: "0.3rem 0.5rem", fontSize: "0.75rem", display: "flex", alignItems: "center", gap: "0.25rem", color: "#f59e0b", borderColor: "rgba(245,158,11,0.4)" }}
                      onClick={() => handleRetryAnalysis(book)}
                      disabled={retryingId === book.id}
                    >
                      {retryingId === book.id
                        ? <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} />
                        : <RefreshCw size={13} />}
                    </button>
                  )}

                  {/* Open editor */}
                  {book.status !== "error" && book.status !== "draft" && (
                    <Link
                      href={`/dashboard/editor?bookId=${book.id}`}
                      title={book.status === "approved" ? "Ver en Editor" : "Abrir Editor"}
                      className="btn btn-secondary"
                      style={{ padding: "0.3rem 0.6rem", fontSize: "0.78rem", textDecoration: "none", display: "inline-flex", alignItems: "center" }}
                    >
                      {book.status === "approved" ? "Ver" : "Editar →"}
                    </Link>
                  )}

                  {/* Download edited docx — available from review_editor onwards */}
                  {["review_editor", "review_author", "review_responsable", "approved"].includes(book.status) && (
                    <button
                      title="Descargar manuscrito editado (.docx)"
                      className="btn"
                      style={{ padding: "0.3rem 0.5rem", fontSize: "0.75rem", backgroundColor: "var(--success)", display: "flex", alignItems: "center" }}
                      onClick={() => handleDownloadEditedDocx(book)}
                      disabled={downloadingId === book.id}
                    >
                      {downloadingId === book.id
                        ? <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} />
                        : <Download size={13} />}
                    </button>
                  )}

                  {/* Reopen editing */}
                  {book.status === "approved" && (
                    <button
                      title="Reabrir edición"
                      className="btn btn-secondary"
                      style={{ padding: "0.3rem 0.5rem", fontSize: "0.75rem", display: "flex", alignItems: "center", borderColor: "#f59e0b", color: "#f59e0b" }}
                      onClick={() => handleReopenEditing(book)}
                      disabled={reopeningId === book.id}
                    >
                      {reopeningId === book.id
                        ? <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} />
                        : <Unlock size={13} />}
                    </button>
                  )}

                  {/* Delete — triggers confirmation modal */}
                  <button
                    title="Eliminar manuscrito"
                    className="btn btn-secondary"
                    style={{ padding: "0.3rem 0.5rem", fontSize: "0.75rem", display: "flex", alignItems: "center", borderColor: "#ef4444", color: "#ef4444" }}
                    onClick={() => setDeleteTarget(book)}
                    disabled={deletingId === book.id}
                  >
                    {deletingId === book.id
                      ? <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} />
                      : <Trash2 size={13} />}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ────────────────── DELETE CONFIRMATION MODAL ────────────────── */}
      {deleteTarget && (
        <div className="modal-overlay">
          <div className="card fade-in modal-content" style={{ maxWidth: "440px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1.25rem" }}>
              <h2 style={{ fontSize: "1.125rem", fontWeight: 700, color: "var(--text-main)" }}>
                ¿Eliminar manuscrito?
              </h2>
              <button onClick={() => setDeleteTarget(null)} className="btn-ghost" style={{ padding: "0.25rem" }}>
                <X size={18} />
              </button>
            </div>

            <div style={{ padding: "1rem", backgroundColor: "rgba(239,68,68,0.08)", borderRadius: "var(--radius)", marginBottom: "1.25rem", borderLeft: "3px solid #ef4444" }}>
              <p style={{ fontWeight: 700, color: "var(--text-main)", marginBottom: "0.375rem" }}>
                «{deleteTarget.title}»
              </p>
              <p style={{ fontSize: "0.8rem", color: "#ef4444" }}>
                ⚠️ Se perderán permanentemente todas las ediciones, correcciones y sugerencias guardadas.
                Esta acción no se puede deshacer.
              </p>
            </div>

            <div style={{ display: "flex", gap: "0.75rem" }}>
              <button
                className="btn btn-secondary"
                style={{ flex: 1 }}
                onClick={() => setDeleteTarget(null)}
                disabled={deletingId === deleteTarget.id}
              >
                Cancelar
              </button>
              <button
                className="btn"
                style={{ flex: 1, backgroundColor: "#ef4444", borderColor: "#ef4444" }}
                onClick={() => handleDeleteBook(deleteTarget)}
                disabled={deletingId === deleteTarget.id}
              >
                {deletingId === deleteTarget.id
                  ? <><Loader2 size={14} style={{ animation: "spin 1s linear infinite", marginRight: "0.375rem" }} />Eliminando...</>
                  : "Sí, eliminar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ────────────────── UPLOAD MODAL ────────────────── */}
      {isModalOpen && (
        <div className="modal-overlay">
          <div className="card fade-in modal-content" style={{ maxWidth: "520px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
              <h2 style={{ fontSize: "1.25rem", fontWeight: 700, color: "var(--text-main)" }}>Nuevo Manuscrito</h2>
              <button onClick={() => setIsModalOpen(false)} className="btn-ghost" style={{ padding: "0.25rem" }}>
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleCreateBook}>
              {/* File drop zone */}
              <div style={{ marginBottom: "1.25rem" }}>
                <label
                  className="card-static"
                  style={{
                    cursor: "pointer",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "center",
                    alignItems: "center",
                    height: "110px",
                    borderStyle: "dashed",
                    borderColor: selectedFile ? "var(--primary)" : "var(--border-color)",
                    backgroundColor: selectedFile ? "rgba(233, 68, 90, 0.05)" : "var(--bg-color)",
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

              {/* Title */}
              <div style={{ marginBottom: "1.125rem" }}>
                <label style={{ display: "block", marginBottom: "0.375rem", fontWeight: 600, color: "var(--text-main)", fontSize: "0.875rem" }}>
                  Título de la Obra
                </label>
                <input
                  type="text"
                  className="input"
                  value={newTitle}
                  onChange={e => setNewTitle(e.target.value)}
                  placeholder="Ej. Cien años de soledad"
                  required
                />
              </div>

              {/* Author field */}
              <div style={{ marginBottom: "1.5rem" }}>
                <label style={{ display: "block", marginBottom: "0.375rem", fontWeight: 600, color: "var(--text-main)", fontSize: "0.875rem" }}>
                  <UserCircle2 size={14} style={{ display: "inline", marginRight: "0.3rem", verticalAlign: "middle" }} />
                  Autor
                </label>

                {isAuthor ? (
                  /* For authors: read-only their own name */
                  <input
                    type="text"
                    className="input"
                    value={user?.displayName ?? user?.email ?? "Mi cuenta"}
                    disabled
                    style={{ opacity: 0.7 }}
                  />
                ) : (
                  /* For admins: dropdown of existing authors + add new */
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                    <div style={{ display: "flex", gap: "0.5rem" }}>
                      <select
                        className="input"
                        value={selectedAuthorId}
                        onChange={e => setSelectedAuthorId(e.target.value)}
                        style={{ flex: 1 }}
                      >
                        <option value="">— Seleccionar autor —</option>
                        {orgAuthors.map(a => (
                          <option key={a.uid} value={a.uid}>
                            {a.displayName ?? a.email}
                          </option>
                        ))}
                        <option value={user!.uid}>Yo mismo ({user?.displayName ?? user?.email})</option>
                      </select>

                      {isAdmin && (
                        <button
                          type="button"
                          className="btn btn-secondary"
                          style={{ padding: "0.5rem 0.75rem", display: "flex", alignItems: "center", gap: "0.25rem", whiteSpace: "nowrap" }}
                          onClick={() => setShowAddAuthor(v => !v)}
                          title="Añadir nuevo autor"
                        >
                          <Plus size={14} /> Añadir
                        </button>
                      )}
                    </div>

                    {showAddAuthor && (
                      <div style={{ display: "flex", gap: "0.5rem", padding: "0.75rem", backgroundColor: "var(--bg-color)", borderRadius: "var(--radius)", border: "1px solid var(--border-color)" }}>
                        <input
                          type="text"
                          className="input"
                          placeholder="Nombre del autor"
                          value={newAuthorName}
                          onChange={e => setNewAuthorName(e.target.value)}
                          style={{ flex: 1 }}
                        />
                        <button
                          type="button"
                          className="btn"
                          style={{ padding: "0.5rem 0.75rem" }}
                          onClick={handleAddAuthor}
                          disabled={addingAuthor || !newAuthorName.trim()}
                        >
                          {addingAuthor ? <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> : "Crear"}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Upload progress */}
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
                <button
                  type="submit"
                  className="btn"
                  style={{ flex: 1 }}
                  disabled={isSubmitting || !selectedFile || !newTitle.trim()}
                >
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
