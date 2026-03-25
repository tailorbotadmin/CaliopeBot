"use client";

import { useState } from "react";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

export default function Home() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const { user, loading } = useAuth();
  const router = useRouter();

  if (loading) return <div>Cargando...</div>;
  if (user) {
    router.push("/dashboard");
    return null;
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await signInWithEmailAndPassword(auth, email, password);
      router.push("/dashboard");
    } catch (err) {
      setError("Credenciales inválidas.");
    }
  };

  return (
    <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg, var(--bg-color) 0%, #e2e8f0 100%)" }}>
      <div className="card fade-in" style={{ maxWidth: "400px", width: "100%", padding: "2.5rem" }}>
        <h1 style={{ textAlign: "center", marginBottom: "0.5rem", fontSize: "1.875rem", fontWeight: 700 }}>CalíopeBot</h1>
        <p style={{ textAlign: "center", color: "var(--text-muted)", marginBottom: "2rem" }}>Corrector Editorial Inteligente</p>
        
        <form onSubmit={handleLogin} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div>
            <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.875rem", fontWeight: 500 }}>Email</label>
            <input 
              type="email" 
              className="input" 
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="editor@editorial.com"
              required 
            />
          </div>
          <div>
            <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.875rem", fontWeight: 500 }}>Contraseña</label>
            <input 
              type="password" 
              className="input" 
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required 
            />
          </div>
          {error && <p style={{ color: "var(--danger)", fontSize: "0.875rem" }}>{error}</p>}
          <button type="submit" className="btn" style={{ width: "100%", marginTop: "1rem", padding: "0.75rem" }}>
            Ingresar
          </button>
        </form>
      </div>
    </main>
  );
}
