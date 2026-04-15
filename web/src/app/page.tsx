"use client";

import { useState } from "react";
import { signInWithEmailAndPassword, sendPasswordResetEmail } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { FileCheck, Sparkles, ShieldCheck, Users, Loader2, CheckCircle2 } from "lucide-react";

type View = "login" | "reset" | "reset_sent";

export default function Home() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [view, setView] = useState<View>("login");
  const [resetEmail, setResetEmail] = useState("");

  const { user, loading } = useAuth();
  const router = useRouter();

  if (loading) return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "var(--bg-dark)" }}>
      <Loader2 size={28} style={{ color: "var(--primary)", animation: "spin 1s linear infinite" }} />
    </div>
  );
  if (user) { router.push("/dashboard"); return null; }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsSubmitting(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
      router.push("/dashboard");
    } catch {
      setError("Credenciales inválidas. Verifica tu email y contraseña.");
      setIsSubmitting(false);
    }
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsSubmitting(true);
    try {
      await sendPasswordResetEmail(auth, resetEmail);
      setView("reset_sent");
    } catch {
      setError("No se pudo enviar el enlace. Verifica que el correo sea correcto.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="login-split">
      {/* Left Panel — Brand */}
      <div className="login-brand">
        <div className="brand-icon">
          <FileCheck size={28} strokeWidth={1.75} color="white" />
        </div>
        <h1>CalíopeBot</h1>
        <p>
          Plataforma de corrección editorial potenciada por IA. Sube tus textos, recibe propuestas inteligentes y aprueba el resultado final.
        </p>

        <div style={{ marginTop: "2.5rem", display: "flex", flexDirection: "column", gap: "0.875rem" }}>
          <div className="features"><Sparkles size={16} /> Correcciones automáticas con IA</div>
          <div className="features"><ShieldCheck size={16} /> Revisión y aprobación humana</div>
          <div className="features"><Users size={16} /> Entornos aislados por organización</div>
        </div>
      </div>

      {/* Right Panel — Form */}
      <div className="login-form-panel">
        <div className="login-form-container fade-in">

          {/* ── LOGIN VIEW ── */}
          {view === "login" && (
            <>
              <h2>Bienvenido de vuelta</h2>
              <p className="subtitle">Ingresa tus credenciales para acceder</p>

              <form onSubmit={handleLogin} style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
                <div>
                  <label style={{ display: "block", marginBottom: "0.375rem", fontSize: "0.875rem", fontWeight: 500, color: "var(--text-main)" }}>
                    Correo electrónico
                  </label>
                  <input
                    type="email"
                    className="input"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="tu@email.com"
                    required
                    disabled={isSubmitting}
                  />
                </div>
                <div>
                  <label style={{ display: "block", marginBottom: "0.375rem", fontSize: "0.875rem", fontWeight: 500, color: "var(--text-main)" }}>
                    Contraseña
                  </label>
                  <input
                    type="password"
                    className="input"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    disabled={isSubmitting}
                  />
                </div>

                {error && (
                  <p style={{ color: "var(--danger)", fontSize: "0.875rem", padding: "0.5rem 0.75rem", backgroundColor: "rgba(239, 68, 68, 0.08)", borderRadius: "var(--radius-md)" }}>
                    {error}
                  </p>
                )}

                <button type="submit" className="btn" style={{ width: "100%", padding: "0.75rem", fontSize: "0.9375rem", marginTop: "0.5rem" }} disabled={isSubmitting}>
                  {isSubmitting
                    ? <><Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} /> Iniciando...</>
                    : "Iniciar sesión"}
                </button>
              </form>

              <div style={{ marginTop: "1.25rem", textAlign: "center" }}>
                <button
                  onClick={() => { setView("reset"); setError(""); }}
                  style={{ background: "none", border: "none", color: "var(--primary)", fontSize: "0.875rem", cursor: "pointer", textDecoration: "underline" }}
                >
                  ¿Olvidaste tu contraseña?
                </button>
              </div>
            </>
          )}

          {/* ── PASSWORD RESET VIEW ── */}
          {view === "reset" && (
            <>
              <h2>Recuperar acceso</h2>
              <p className="subtitle">Te enviaremos un enlace para restablecer tu contraseña.</p>

              <form onSubmit={handleReset} style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
                <div>
                  <label style={{ display: "block", marginBottom: "0.375rem", fontSize: "0.875rem", fontWeight: 500, color: "var(--text-main)" }}>
                    Correo electrónico
                  </label>
                  <input
                    type="email"
                    className="input"
                    value={resetEmail}
                    onChange={e => setResetEmail(e.target.value)}
                    placeholder="tu@email.com"
                    required
                    autoFocus
                    disabled={isSubmitting}
                  />
                </div>

                {error && (
                  <p style={{ color: "var(--danger)", fontSize: "0.875rem", padding: "0.5rem 0.75rem", backgroundColor: "rgba(239, 68, 68, 0.08)", borderRadius: "var(--radius-md)" }}>
                    {error}
                  </p>
                )}

                <button type="submit" className="btn" style={{ width: "100%", padding: "0.75rem" }} disabled={isSubmitting}>
                  {isSubmitting
                    ? <><Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} /> Enviando...</>
                    : "Enviar enlace de recuperación"}
                </button>
              </form>

              <div style={{ marginTop: "1.25rem", textAlign: "center" }}>
                <button
                  onClick={() => { setView("login"); setError(""); }}
                  style={{ background: "none", border: "none", color: "var(--text-muted)", fontSize: "0.875rem", cursor: "pointer" }}
                >
                  ← Volver al inicio de sesión
                </button>
              </div>
            </>
          )}

          {/* ── RESET SENT VIEW ── */}
          {view === "reset_sent" && (
            <div style={{ textAlign: "center", padding: "1.5rem 0" }}>
              <CheckCircle2 size={48} style={{ color: "var(--success)", marginBottom: "1rem" }} />
              <h2 style={{ marginBottom: "0.5rem" }}>Enlace enviado</h2>
              <p style={{ color: "var(--text-muted)", fontSize: "0.9375rem", lineHeight: 1.6, marginBottom: "2rem" }}>
                Hemos enviado un enlace de recuperación a{" "}
                <strong style={{ color: "var(--text-main)" }}>{resetEmail}</strong>.{" "}
                Revisa tu bandeja de entrada (y carpeta de spam).
              </p>
              <button
                onClick={() => { setView("login"); setError(""); setResetEmail(""); }}
                className="btn"
                style={{ width: "100%" }}
              >
                Volver al inicio de sesión
              </button>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
