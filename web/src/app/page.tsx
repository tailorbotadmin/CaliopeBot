"use client";

import { useState } from "react";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { FileCheck, Sparkles, ShieldCheck, Users } from "lucide-react";

export default function Home() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const { user, loading } = useAuth();
  const router = useRouter();

  if (loading) return <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>Cargando...</div>;
  if (user) {
    router.push("/dashboard");
    return null;
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      await signInWithEmailAndPassword(auth, email, password);
      router.push("/dashboard");
    } catch {
      setError("Credenciales inválidas. Verifica tu email y contraseña.");
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
          <div className="features">
            <Sparkles size={16} /> Correcciones automáticas con IA
          </div>
          <div className="features">
            <ShieldCheck size={16} /> Revisión y aprobación humana
          </div>
          <div className="features">
            <Users size={16} /> Entornos aislados por organización
          </div>
        </div>
      </div>

      {/* Right Panel — Login Form */}
      <div className="login-form-panel">
        <div className="login-form-container fade-in">
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
                onChange={(e) => setEmail(e.target.value)}
                placeholder="tu@email.com"
                required
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
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
              />
            </div>

            {error && (
              <p style={{ color: "var(--danger)", fontSize: "0.875rem", padding: "0.5rem 0.75rem", backgroundColor: "rgba(239, 68, 68, 0.08)", borderRadius: "var(--radius-md)" }}>
                {error}
              </p>
            )}

            <button type="submit" className="btn" style={{ width: "100%", padding: "0.75rem", fontSize: "0.9375rem", marginTop: "0.5rem" }}>
              Iniciar sesión
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
