# PLAN ESTRATÉGICO
## De MVP funcional a plataforma editorial escalable basada en IA

---

# 1. VISIÓN DEL PRODUCTO

## Problema
Las editoriales necesitan:
- Corrección ortográfica automatizada fiable
- Corrección gramatical y de estilo avanzada
- Adaptación estricta a guía editorial propia
- Trazabilidad completa de cambios
- Flujo colaborativo con correctores humanos
- Seguridad y confidencialidad de manuscritos inéditos

El proceso actual es manual, costoso, difícil de escalar y con baja trazabilidad estructurada.

## Solución
Plataforma de corrección editorial asistida por IA con arquitectura multi-agente:

1. Corrección ortográfica (motor lingüístico determinista)
2. Corrección gramatical y estilística (LLM)
3. Evaluación automática de calidad (LLM evaluador independiente)
4. IA supervisora (“editor jefe IA”)
5. Human-in-the-loop
6. Reentrenamiento continuo con feedback real

Objetivo estratégico: convertirse en el corrector editorial de referencia en español y lenguas de la península.

---

## Ventaja Estratégica Inicial

El sistema no parte de cero.

Se apoya en un modelo fundacional entrenado previamente con corpus literario de alta calidad (incluyendo materiales de la Biblioteca Nacional), lo que aporta:

- Fluidez lingüística avanzada
- Dominio sintáctico amplio
- Conocimiento estilístico literario
- Coherencia narrativa estructural

Sin embargo, un modelo literario no es un modelo editorial.

La ventaja competitiva real se construirá mediante:

- Capa editorial estructurada
- Dataset de decisiones humanas reales
- Especialización progresiva mediante fine-tuning
- Integración sistemática de guías editoriales parametrizables

El objetivo no es tener una IA que “corrige texto”, sino una IA que aplica criterio editorial consistente y trazable.

---

# 2. ESTADO ACTUAL (MVP)

## Stack actual
- Frontend: Lovable
- Orquestación: n8n
- Base de datos: Supabase
- LLM API (cloud)
- Flujo de revisión humano

## Capacidades actuales
- Subida de texto
- Corrección automatizada
- Revisión humana
- Persistencia de cambios
- Parametrización básica de estilo mediante prompting

## Limitaciones del MVP
- No existe fine-tuning propio
- Arquitectura no preparada para carga editorial masiva
- No existe infraestructura ML dedicada
- Seguridad básica
- Modelo generalista adaptado mediante prompting

### Aclaración estratégica sobre el modelo actual
El MVP utiliza un modelo LLM generalista vía API adaptado mediante prompting y guía editorial.

Esto permite:
- Corrección ortográfica y gramatical de alta calidad
- Mejora estilística razonable
- Adaptación superficial a guías editoriales

Sin embargo, el modelo:
- No ha sido entrenado con dataset editorial anotado profesionalmente
- No ha aprendido decisiones consistentes de una editorial concreta
- No incorpora identidad editorial como conocimiento interno
- No optimiza coherencia global a nivel libro

El salto cualitativo futuro consiste en evolucionar de una “IA que corrige” a una “IA que aplica criterio editorial propio”.

---

# 3. ARQUITECTURA OBJETIVO (PRODUCTO ESCALABLE)

## 3.1 Capa de Aplicación
- Frontend profesional (React / Next.js)
- Control de versiones por libro
- Gestión multi-tenant por editorial
- Gestión de guías editoriales cargables
- Panel avanzado de revisión tipo Track Changes
- Gestión por capítulos y bloques

---

## 3.2 Capa de Orquestación
- Backend dedicado (FastAPI o similar)
- Workers asíncronos (Celery / Temporal)
- Cola de tareas (Redis / Kafka)
- Microservicios desacoplados
- Separación clara entre capa editorial y capa ML

---

## 3.3 Capa de IA (Arquitectura Multi-Agente Especializada)

La arquitectura no entrena desde cero.
Se basa en un modelo fundacional literario y construye una capa editorial encima.

### Estrategia de Especialización en 3 Niveles

#### Nivel 1 — Modelo literario base
Modelo GPT-2 entrenado con corpus literario.
Ventaja: excelente base lingüística.
Limitación: no interioriza criterio editorial sistemático.

#### Nivel 2 — Capa editorial aplicada
Construida mediante:
- Prompting estructurado
- Guías editoriales parametrizadas
- Evaluador independiente
- Validación humana
- Dataset incremental estructurado

Objetivo: convertir modelo lingüístico en sistema editorial operativo.

#### Nivel 3 — Especialización mediante fine-tuning
Aplicación progresiva de:
- SFT (Supervised Fine-Tuning)
- LoRA / QLoRA
- DPO o aprendizaje por preferencias

Objetivo: internalizar criterio editorial dentro del modelo.

---

### Arquitectura Multi-Agente

#### Agente 1 — Corrector Lingüístico Base
- Motor determinista (LanguageTool u otro)
- Detección objetiva ortográfica y sintáctica
- Limpieza estructural previa

#### Agente 2 — Corrector Editorial IA
- Modelo Instruct optimizado para español
- Aplicación de guía editorial
- Mejora de claridad y estilo
- Conservación de tono
- Control de intervención

En fases avanzadas:
- Fine-tuned Salamandra (BSC)
- Modelo editorial propio especializado

#### Agente 3 — Evaluador de Calidad
- Modelo independiente del corrector
- Evalúa fidelidad semántica
- Detecta sobrecorrección
- Genera score estructurado

#### Agente 4 — Editor Jefe IA
- Determina paso a humano
- Detecta inconsistencias globales
- Optimiza flujo editorial

#### Agente 5 — Humano (Human-in-the-Loop)
- Acepta / rechaza / modifica
- Genera dataset incremental
- Ajusta guías editoriales

---

# 4. COMPETENCIAS NECESARIAS PARA ESCALAR

## 4.1 Machine Learning

El objetivo no es crear un modelo desde cero, sino transformar un modelo fundacional literario en un modelo editorial especializado.

### 4.1.1 Material necesario para especialización

#### A) Adaptación de Dominio (DAPT — opcional)
Texto sin etiquetar del dominio:
- Narrativa
- Infantil
- Ensayo
- Texto educativo
- Manuales

Objetivo: ajustar distribución lingüística del dominio.

No imprescindible si el modelo base domina el idioma.

---

#### B) Dataset Supervisado de Corrección (Imprescindible)
Estructura mínima:
- Texto original
- Texto corregido
- Tipo de corrección
- Intensidad de intervención
- Guía editorial aplicada
- Explicación opcional

Tipos:
- Ortografía y puntuación
- Gramática
- Claridad
- Registro
- Consistencia interna
- Normas tipográficas
- Adaptación a colección

Este dataset constituye el activo estratégico principal.

---

#### C) Dataset de Preferencias (Recomendado)
Registros de:
- Aceptaciones
- Rechazos
- Correcciones manuales
- Alternativas solicitadas

Permite aplicar:
- DPO
- RLHF
- Ranking learning

Objetivo:
- Minimizar sobrecorrección
- Aprender identidad editorial
- Ajustar intervención por género

---

#### D) Conjunto de Evaluación Editorial
Dataset cerrado para benchmarking:
- Infantil
- No ficción
- Ficción
- Texto educativo
- Variedades lingüísticas (ES, CA, GL, EU)

Métricas:
- Tasa de aceptación humana
- Errores introducidos
- Conservación semántica
- Consistencia global
- Satisfacción editorial

---

### 4.1.2 Pretensión Estratégica

La pretensión no es ofrecer una IA genérica que corrige texto.

La pretensión es:
- Construir una capa editorial estructurada sobre modelo fundacional
- Internalizar criterio editorial real mediante dataset validado
- Convertir feedback humano en ventaja competitiva
- Evolucionar hacia modelo editorial especializado entrenado progresivamente

---

## 4.2 DevOps

Necesario para:
- Infraestructura cloud escalable
- Contenerización (Docker)
- Orquestación (Kubernetes)
- Auto-scaling GPU
- Gestión de costes
- CI/CD
- Monitorización (Prometheus / Grafana)

Perfil requerido:
DevOps Engineer con experiencia en IA.

---

## 4.3 Arquitectura de Datos

Necesario para:
- Modelo de datos editorial robusto
- Versionado por libro
- Dataset incremental
- Separación multi-tenant
- Auditoría y trazabilidad

Perfil requerido:
Data Architect.

---

## 4.4 Frontend / UX

Necesario para:
- Experiencia tipo Track Changes
- Visualización avanzada de diferencias
- Gestión por capítulos
- Sistema de comentarios
- Flujo editorial profesional

Perfil requerido:
Frontend Engineer + UX especializado.

---

## 4.5 Editor Profesional

Necesario para:
- Validar calidad real
- Optimizar guías
- Definir estándares
- Ajustar intervención por género

Rol estratégico.

---

## 4.6 Ciberseguridad

Necesario para:
- Encriptación en tránsito y reposo
- Control de acceso granular
- Protección de manuscritos inéditos
- Cumplimiento RGPD
- Auditoría de accesos

Perfil requerido:
Especialista en seguridad cloud.

---

# 5. ROADMAP DE ESCALADO

## Fase 1 (0–3 meses)
- Consolidación MVP
- Arquitectura cloud limpia
- Modelo Instruct estable vía API
- Estructuración dataset editorial

## Fase 2 (3–6 meses)
- Primer fine-tuning LoRA
- Separación microservicios
- Mejora UX
- Seguridad reforzada

## Fase 3 (6–12 meses)
- Modelo editorial especializado propio
- Evaluador robusto
- Editor jefe IA avanzado
- Escalado multi-editorial

---

# 6. RIESGOS

- Subestimar complejidad ML
- Dataset de baja calidad
- Infraestructura mal diseñada
- Costes GPU descontrolados
  - Mitigación estratégica posible: establecer un acuerdo de colaboración con el BSC (Barcelona Supercomputing Center) para el uso de capacidad de cómputo asociada al modelo base. Dado que uno de los objetivos institucionales es fomentar la adopción y utilidad práctica del modelo desarrollado, puede explorarse una colaboración que incluya acceso a infraestructura HPC para investigación aplicada, fine-tuning supervisado y experimentación editorial avanzada. Esto reduciría el CAPEX inicial en GPU y aceleraría la fase de especialización del modelo.
- No implicar editores reales

---

# 7. CONCLUSIÓN

El producto funciona actualmente como MVP validado.

Para convertirlo en plataforma editorial de referencia se requiere:

- Especialización ML estructurada
- Arquitectura cloud profesional
- Modelo de datos robusto
- Seguridad empresarial
- Implicación editorial real

El proyecto no es únicamente tecnológico.
Es una construcción progresiva de criterio editorial sistematizado.



---

# 8. ¿QUÉ PUEDE HACER EL PRODUCT MANAGER (SIN MACHINE LEARNING)?

Este apartado define únicamente responsabilidades realistas para un perfil **Product Manager** sin conocimientos de fine‑tuning ni ML. La función principal es **convertir un modelo base en un producto editorial usable**, maximizando aprendizaje de cliente, calidad y trazabilidad.

---

## 8.1 Responsabilidades que se pueden asumir internamente

### 1) Dirección de producto (core)
- Definir visión, alcance y criterios de éxito (MVP vs escalado)
- Roadmap, priorización y definición de entregables por iteración
- Traducción de necesidades editoriales a requisitos funcionales y técnicos
- Definición de métricas: tasa de aceptación humana, errores introducidos, tiempos de ciclo, coste por 1.000 palabras, etc.

### 2) Descubrimiento con editoriales y definición del flujo editorial
- Entrevistas con editores/correctores para mapear el flujo real (ingesta → corrección → revisión → aprobación → export)
- Identificación de casos de uso críticos: novela, infantil, texto educativo, ensayo, etc.
- Definición de “políticas editoriales” y cómo se operativizan (ej.: comillas, rayas, cursivas, mayúsculas, números, siglas, citas, referencias)

### 3) Gestión de guías de estilo cargables (sin entrenar modelos)
- Diseñar el **formato de guía editorial** (campos, reglas, ejemplos, excepciones)
- Definir UX para cargar/editar guías por editorial/colección
- Convertir guías en **prompts estructurados + guardrails** (plantillas) para la fase MVP
- Crear un catálogo de estilos: genérico, infantil, educativo, ficción, no ficción, etc.

### 4) UX/UI del corrector humano (Track Changes)
- Diseñar la experiencia de revisión: aceptar/rechazar, alternativas, edición manual, comentarios
- Definir cómo se visualizan cambios (diff por frase, por palabra, por categoría)
- Definir estados de corrección: propuesto → revisado → aprobado → aplicado
- Prototipado y validación rápida con Lovable (y especificación para migración futura a React)

### 5) Orquestación del workflow en n8n (MVP)
- Implementar el pipeline de agentes (sin ML):
  1) ortografía determinista
  2) corrección editorial vía API LLM
  3) evaluador independiente (scoring)
  4) “editor jefe IA” (reglas de enrutado)
  5) paso a humano
- Manejo de colas/estados, reintentos, logging, versionado de outputs
- Integración Drive/almacenamiento y endpoints para descarga

### 6) Modelo de datos funcional (conceptual) y requisitos para el Data Architect
- Definir entidades y relaciones **a nivel funcional** (no optimización técnica):
  - Organización, Usuario, Proyecto/Libro, Capítulo/Segmento, GuíaEditorial, Revisión, Cambio (diff), DecisiónHumana, Evaluación, Export
- Definir el contrato de datos que el sistema debe capturar para trazabilidad (auditoría) y para futuro entrenamiento (sin entrenar ahora)

### 7) Sistema de calidad editorial (sin ML)
- Definir la **rúbrica de evaluación** (qué es “bueno”): fidelidad, intervención, coherencia, tipografía, registro, consistencia
- Definir umbrales de paso (score mínimo, flags críticos, motivos de rechazo)
- Diseñar tests de regresión editorial con un set fijo de textos (benchmark interno)

### 8) Operación del dataset (sin entrenar, pero preparándolo bien)
- Diseñar cómo se captura el feedback humano:
  - aceptado/rechazado
  - editado manualmente
  - alternativa solicitada
  - motivo/etiqueta de error (puntuación, estilo, tipografía, coherencia…)
- Definir convenciones de etiquetado y guías para el editor humano
- Control de calidad del dataset (duplicados, inconsistencias, sesgos)

### 9) Coordinación de especialistas y proveedores
- Especificar el trabajo para:
  - ML Engineer (cuando toque): objetivos, dataset, métricas, validación
  - DevOps: despliegue, costes, observabilidad, seguridad
  - Data Architect: multi‑tenant, escalabilidad, auditoría
- Gestión de proveedores API (latencia, coste, SLAs, privacidad)

### 10) Seguridad por requisitos (sin ser experto)
- Definir requisitos: cifrado, control de accesos por rol, segregación multi‑tenant, logs, retención/borrado
- Checklist de riesgos y “definition of done” para ciberseguridad

---

## 8.2 Lo que NO debe asumirse internamente (y por qué)

- Fine‑tuning (LoRA/QLoRA/DPO/RLHF), selección de hiperparámetros, evaluación de checkpoints
- Optimización de inferencia GPU (cuantización avanzada, batching, KV cache, serving en producción)
- Arquitectura cloud a escala (Kubernetes, autoscaling, FinOps) sin experiencia
- Seguridad avanzada y compliance (auditorías, threat modeling, hardening)

Estas áreas requieren especialistas para evitar deuda técnica, riesgos de seguridad y costes GPU incontrolados.

---

## 8.3 Conclusión

El rol interno es **construir el producto correcto y el sistema editorial correcto**, no “entrenar transformers”.

La ventaja competitiva se crea al:
- convertir guías editoriales en reglas operables
- diseñar un flujo humano‑IA que un editor quiera usar a diario
- capturar decisiones humanas como dataset de alta calidad
- validar con clientes reales antes de escalar infraestructura y ML

