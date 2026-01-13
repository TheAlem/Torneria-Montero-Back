# Tornería Montero Backend — Motor híbrido (ML + heurísticas)

Este backend implementa un **motor híbrido** para asignación y estimación de tiempos en un taller real de tornería. El objetivo es combinar **ML (predicción)** con **heurísticas operativas** (reglas del taller), manteniendo un flujo **explicable, seguro y trazable** sin cambiar el esquema de base de datos.

---

## 1) Diseño del motor híbrido (diagrama textual + flujo)

```
Pedido (descripcion, prioridad, precio, responsable?, fecha_estimada)
  │
  ├─► parseDescripcion
  │     - materiales (teflón, nylon, bronces, 1045, fundido, aluminio, inox, etc.)
  │     - procesos (torneado/fresado/roscado/taladrado/soldadura/pulido)
  │     - tareas generales (amolado, esmerilado, corte, prensa, taladro simple)
  │     - flags (tolerancias, rosca, múltiples piezas, diámetro)
  │
  ├─► ML base (regresión lineal + priors)
  │     - meta.names para compatibilidad
  │     - output: duración base (seg)
  │
  ├─► Heurísticas (guardrails)
  │     - hard constraints: filtra candidatos (fresado/soldadura/torneado)
  │     - soft constraints: carga actual, experiencia, histórico
  │     - ajustes de tiempo por material/proceso/tarea general
  │
  ├─► Score final (ranking)
  │     - skill overlap + WIP + desvío histórico + rol técnico + prioridad
  │
  └─► Salida explicable
        - Top 1-3 responsables técnicos + razones
        - Apoyo manual (ayudantes) sólo sugerido
        - ETA ajustada + intervalo + semáforo
```

---

## 2) Reglas heurísticas (hard/soft) con ejemplos

### Hard constraints (no negociables)
* **Fresado →** sólo candidatos con skill `fresado` (Ej: Erick).  
* **Soldadura / recargue / rellenado →** sólo candidatos con skill `soldadura` (Ej: Cristian/Moisés).  
* **Torneado/roscado/tolerancia →** sólo candidatos con skill `torneado`.  
* **Tareas generales** (pulido, amolado, esmeril, taladro simple, cortadora, prensa) **no excluyen** candidatos.  
* **Ayudantes nunca se auto‑asignan** (aparecen sólo como apoyo manual).

### Soft constraints (ponderación)
* Penalizar WIP alto (carga actual).
* Favorecer experiencia cuando hay tolerancias/roscado/recargue.
* Ajustes por material y proceso (ej. 1045 +20%, bronce fosforado +12%).
* Si el semáforo sale **rojo**, sugerir **replanificar/reescalar**.

---

## 3) Plan de mejora ML (baseline, evaluación, retraining, versionado)

### Baseline
* **Regresión lineal (ridge opcional)** con features:
  - prioridad, precio
  - NLP simple (materiales/procesos/tags/flags)
  - diámetro/tamaño si aparece en texto
  - carga del técnico, antigüedad, skill overlap

### Evaluación
* MAE/MAPE global.
* Métricas por material/proceso (tag-based) en metadata del modelo.

### Retraining incremental
* Entrenamiento vía `POST /ml/train`.
* Priors por prioridad (ALTA/MEDIA/BAJA) para cold‑start.
* Clamping de outliers con `ML_MIN_SECONDS` y `ML_MAX_SECONDS`.

### Versionado de modelos
* `meta.names` controla compatibilidad hacia atrás.
* `meta.priors`, `meta.precioScale` y métricas se guardan en el modelo.
* `modelo_version` se registra junto a cada inferencia.

---

## 4) Endpoints y payloads (existentes)

### 4.1 Crear/Actualizar pedido
* `POST /api/pedidos`  
  - Payload: `titulo`, `descripcion`, `prioridad`, `precio`, `cliente`/`cliente_id`, etc.
* `PUT /api/pedidos/{id}`  
  - Actualiza estado, responsable, fechas, notas, etc.

### 4.2 Sugerencias de asignación + apoyo manual
* `GET /api/asignar/suggest?pedidoId=123`  
  - Respuesta: `candidates` (técnicos) + `apoyo_manual` (ayudantes sugeridos).

### 4.3 Confirmar asignación (acción humana)
* `POST /api/asignar`  
  - Payload: `{ pedido_id, trabajador_id, origen }`
  - Si no hay `trabajador_id`, se sugiere **automáticamente** un técnico (nunca ayudante).

### 4.4 Registrar tiempos reales (inicio/fin/duración)
* La transición de estados gestiona tiempos reales automáticamente:
  - `PATCH /kanban/{id}/status` con `newStatus = EN_PROGRESO` abre tiempo.
  - Cambio a `QA/ENTREGADO` cierra tiempo.

### 4.5 Reportes
* `GET /reportes/semanal`  
* `GET /reportes/mensual`  
  - Productividad, estimado vs real, semáforos, backlog.

---

## 5) Checklist de calidad backend

* **Validaciones** (Zod en creación/actualización).
* **Seguridad y roles** (ADMIN/ENCARGADO vs CLIENTE).
* **Logs de inferencia** (input + output + razones + versión).
* **Trazabilidad** en `predicciones_tiempo`.
* **Compatibilidad** garantizada con `meta.names`.
* **Tests** de parsing y reglas hard constraints.

---

## 6) Ajustes al extractor de materiales/procesos (compatibles)

Detecta:
* **Teflón / PTFE**
* **Nylon / Nilón**
* **Bronce** (fundido, laminado, fosforado)
* **Hierro/Acero 1045 maquinable**
* **Fierro fundido común**
* **Aluminio / alu**

Detecta tareas generales:
* Pulido, amoladora, esmeril, corte/cortadora, taladro simple, prensa.

Detecta recargue/rellenado:
* Mapea a soldadura + guardrail de skill.

---

## Uso rápido (ML)

```bash
POST /ml/train
GET  /ml/status
```

---

> Nota crítica: **los ayudantes nunca se asignan automáticamente**. Sólo se listan como *apoyo manual* y requieren aprobación humana.
