# Microsoft Fabric — Mis Gastos (TEST y PRD)

## Flujo de datos
```
Cloud Run (outbox) ──Kafka──▶ Eventstream ──▶ Eventhouse (KQL DB "finanzas")
                                               ├─ Bronze  raw_gastos           (01_bronze.kql)
                                               ├─ Silver  gastos_silver        (02_silver.kql, update policy)
                                               └─ Gold    gastos_ultima_version + fn_*  (03_gold.kql)
                                                           └─ OneLake availability → Lakehouse (Delta) → Power BI Direct Lake
```

## Entornos
| | TEST | PRD |
|---|---|---|
| Workspace | `finanzas-test` | `finanzas-prd` |
| Eventstream | `es_gastos` (fuente: Custom Endpoint TEST) | `es_gastos` (fuente: Custom Endpoint PRD) |
| ¿Quién envía datos? | Generador de eventos sintéticos (`scripts/generar_eventos.py`) | Cloud Run producción |
| ¿Quién cambia los ítems? | Tú, en el portal (Git integration → rama `fabric-dev`) | **Solo** GitHub Actions (`fabric-cicd`) |
| Secreto de conexión | GitHub Environment `fabric-test` | Secret Manager GCP + GitHub Environment `fabric-prd` (aprobación manual) |

## CI/CD
1. Trabajas en `finanzas-test` (conectado a Git, carpeta `/fabric/workspace`) y haces *commit* desde el portal a `fabric-dev`.
2. PR `fabric-dev` → `main`: CI valida estructura y que los `.kql` sean idempotentes.
3. Merge a `main`: GitHub Actions
   - despliega los ítems con [`fabric-cicd`](https://microsoft.github.io/fabric-cicd/) al workspace TEST (verificación) y,
   - tras **aprobación manual** del environment `fabric-prd`, al workspace PRD;
   - ejecuta `fabric/kql/0*.kql` en el Eventhouse del entorno (idempotentes) y `99_verificacion.kql`.
4. Valores que cambian por entorno (IDs de Eventhouse/Lakehouse, conexiones) → `fabric/parameter.yml`.

Reglas: un solo "escritor" por rama; nunca dos operaciones Git simultáneas sobre un workspace; desplegar cada ítem con los ítems que referencia.

## Orden de ejecución de los scripts KQL
`01_bronze.kql` → `02_silver.kql` → `03_gold.kql` → `99_verificacion.kql` (cada comando de control por separado en el KQL queryset).

> Los eventos v1 (antes de la outbox) no traen `op_type`/`version`: Silver los normaliza como `INSERT` versión 1.
