"use client";

import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { auth } from "@/lib/firebase";

export default function SettingsPage() {
  const { user, role, organizationId } = useAuth();
  
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    password: "",
    role: "Autor"
  });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState({ type: "", text: "" });

  if (role !== "SuperAdmin" && role !== "Admin") {
    return (
      <div style={{ padding: "3rem", textAlign: "center", color: "var(--text-muted)" }}>
        No tienes permisos para acceder a esta configuración.
      </div>
    );
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage({ type: "", text: "" });

    try {
      const token = await auth.currentUser?.getIdToken(true);
      if (!token) throw new Error("No token available");

      const response = await fetch("http://localhost:8000/api/v1/users/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({
          email: formData.email,
          password: formData.password,
          name: formData.name,
          role: formData.role,
          organizationId: organizationId
        })
      });

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.detail || "Error al crear usuario");
      }

      setMessage({ type: "success", text: "Usuario creado correctamente." });
      setFormData({ name: "", email: "", password: "", role: "Autor" });
    } catch (err: any) {
      console.error(err);
      setMessage({ type: "error", text: err.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fade-in" style={{ padding: "2.5rem", maxWidth: "800px", margin: "0 auto" }}>
      <div className="page-header">
        <div>
          <h1>Configuración de Organización</h1>
          <p>Gestiona tu equipo y da de alta a nuevos usuarios en la plataforma.</p>
        </div>
      </div>

      <div className="card-static" style={{ padding: "2rem" }}>
        <h2 style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: "1.5rem" }}>Añadir Miembro al Equipo</h2>
        
        {message.text && (
          <div style={{ 
            padding: "1rem", 
            marginBottom: "1.5rem", 
            borderRadius: "6px",
            backgroundColor: message.type === "success" ? "rgba(16, 185, 129, 0.1)" : "rgba(239, 68, 68, 0.1)",
            color: message.type === "success" ? "var(--success)" : "var(--danger)",
            border: `1px solid ${message.type === "success" ? "rgba(16, 185, 129, 0.2)" : "rgba(239, 68, 68, 0.2)"}`
          }}>
            {message.text}
          </div>
        )}

        <form onSubmit={handleCreateUser} style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
          <div>
            <label className="label">Nombre Completo</label>
            <input 
              type="text" 
              name="name"
              className="input" 
              placeholder="Ej. Ana García" 
              value={formData.name}
              onChange={handleInputChange}
              required 
            />
          </div>

          <div>
            <label className="label">Correo Electrónico</label>
            <input 
              type="email" 
              name="email"
              className="input" 
              placeholder="correo@ejemplo.com" 
              value={formData.email}
              onChange={handleInputChange}
              required 
            />
          </div>

          <div>
            <label className="label">Contraseña Temporal</label>
            <input 
              type="password" 
              name="password"
              className="input" 
              placeholder="Asigna una contraseña segura (min 6 caracteres)" 
              value={formData.password}
              onChange={handleInputChange}
              required 
              minLength={6}
            />
          </div>

          <div>
            <label className="label">Rol en la Organización</label>
            <select 
              className="input" 
              name="role"
              value={formData.role}
              onChange={handleInputChange}
              style={{ padding: "0.75rem", backgroundColor: "var(--card-bg)" }}
            >
              <option value="Autor">Autor (Sólo revisa sus manuscritos aprobados)</option>
              <option value="Editor">Editor (Corrige y revisa todos los documentos)</option>
              <option value="Responsable_Editorial">Responsable Editorial (Aprobación final)</option>
              <option value="Traductor">Traductor (Flujo similar al Autor)</option>
              {role === "SuperAdmin" && <option value="Admin">Administrador (Gestión total)</option>}
            </select>
          </div>

          <div style={{ marginTop: "1rem" }}>
            <button type="submit" className="btn" style={{ width: "100%" }} disabled={loading}>
              {loading ? "Creando usuario..." : "Crear Usuario"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
