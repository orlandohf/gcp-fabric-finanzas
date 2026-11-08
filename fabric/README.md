# Microsoft Fabric — Mis Gastos (TEST y PRD)

Tenant de Fabric: <tenant> · Capacidad: **Trial** (`<id-capacidad>`)

## Flujo de datos
```
Cloud Run (outbox) ──Kafka──▶ Eventstream es_finanzas_gcp ──(ProcessedIngestion, streaming)──▶ Eventhouse eh_finanzas
                                                              ├─ Bronze  raw_gastos            (01_bronze.kql)
                                                              ├─ Silver  gastos_silver         (02_silver.kql, update policy)
                                                              └─ Gold    gastos_ultima_version + fn_*   (03_gold.kql)
                                                                          └─ OneLake availability → Lakehouse (Delta) → Power BI Direct Lake
```

## Entornos
| | TEST | PRD |
|---|---|---|
| Workspace | `test_wt` (`<id-workspace-test>`) | `finanzas-prd` (`<id-workspace-prd>`) |
| Eventhouse / KQL DB | `eh_finanzas` · `https://<cluster>.kusto.fabric.microsoft.com` | `eh_finanzas` · `https://<cluster>.kusto.fabric.microsoft.com` |
| Eventstream | `es_finanzas_gcp` (fuente Custom Endpoint `cloudrun-gastos`) | `es_finanzas_gcp` (clonado de TEST vía API) |
| ¿Quién envía datos? | Eventos sintéticos / pruebas manuales | Cloud Run producción (`FABRIC_ENTORNO=prd`) |
| ¿Quién cambia los ítems? | Tú, en el portal | **Solo** el pipeline (CI/CD) |

## Lecciones aprendidas (no repetir)
- El destino Eventhouse del Eventstream crea `raw_gastos` con **fechas como `string`** y columnas de sistema
  (`EventProcessedUtcTime`, `PartitionId`, `EventEnqueuedUtcTime`). Bronze se respeta tal cual; Silver tipa.
- `raw_gastos` recibe **ingesta en streaming** → la **update policy no puede hacer `join`/`lookup` a otras tablas ni usar
  `ingestion_time()`** (falla con un genérico `Request is invalid`). Por eso Silver usa `now()` y la conversión USD→PEN
  vive en Gold (`fn_gastos_actuales`).
- En KQL el literal `1` es `long`: castear con `toint()` cuando la columna destino es `int` (la update policy exige esquema exacto).
- `.create-or-alter materialized-view ... backfill` falla si la vista ya existe → usar `.create ifnotexists`.
- Consultar la vista materializada **por nombre** (no `materialized_view()`) para incluir el delta aún no materializado.

## Ejecutar los scripts KQL
Orden: `01_bronze.kql` → `02_silver.kql` → `03_gold.kql` → `99_verificacion.kql`. Todos son **idempotentes**
(verificado re-ejecutándolos completos en TEST y PRD). Cada comando de control empieza con `.` y se envía por separado
a `POST {queryUri}/v1/rest/mgmt` con un token de `https://kusto.kusto.windows.net`.

## CI/CD (siguiente paso)
Requiere un **service principal** de Entra ID con rol en ambos workspaces y el tenant setting
"Service principals can use Fabric APIs". Con eso, GitHub Actions:
1. en PR: valida los `.kql` contra TEST;
2. en merge a `main`: aplica `fabric/kql/0*.kql` en TEST y, tras **aprobación manual** (environment `fabric-prd`), en PRD;
   y despliega los ítems (Eventstream, etc.) con `fabric-cicd` + `parameter.yml` para los IDs por entorno.
