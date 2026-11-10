# Microsoft Fabric — Mis Gastos (TEST y PRD)

Capacidad: **Fabric Trial** (los IDs reales viven fuera del repositorio)

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
| Workspace | `<workspace-test>` | `<workspace-prd>` |
| Eventhouse / KQL DB | `eh_finanzas` · `https://<cluster>.kusto.fabric.microsoft.com` | `eh_finanzas` · `https://<cluster>.kusto.fabric.microsoft.com` |
| Eventstream | `es_finanzas_gcp` (fuente Custom Endpoint `cloudrun-gastos`) | `es_finanzas_gcp` (clonado de TEST vía API) |
| ¿Quién envía datos? | Eventos sintéticos / pruebas manuales | Cloud Run producción (`FABRIC_ENTORNO=prd`) |
| ¿Quién cambia los ítems? | Tú, en el portal | **Solo** el pipeline (CI/CD) |

## Multiusuario (usuario_id)
Desde la versión para amigos y familia, cada evento trae `usuario_id` (UUID seudónimo; el correo nunca sale de PostgreSQL).
`raw_gastos` y `gastos_silver` lo agregan **al final** con `.create-merge`; Gold lo resuelve en `fn_gastos_actuales()` con un
`lookup` (la vista materializada no se recrea). **Desplegar el KQL antes que la app**, y verificar con la consulta 8 de
`99_verificacion.kql` (`sin_dueno = 0`). Si `usuario_id` llega vacío en Bronze con la columna ya creada, revisar el destino
Eventhouse del Eventstream (mapeo de campos).

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

## Desplegar los scripts KQL (sin service principal)
```powershell
# 1. Copiar fabric/entornos.local.json.example a fabric/entornos.local.json y completar los queryUri (no se versiona)
# 2. Con az login en el tenant de Fabric:
powershell -ExecutionPolicy Bypass -File fabricscriptsdesplegar_kql.ps1 -Entorno test
powershell -ExecutionPolicy Bypass -File fabricscriptsdesplegar_kql.ps1 -Entorno prd     # pide confirmar escribiendo PRD
powershell -ExecutionPolicy Bypass -File fabricscriptsdesplegar_kql.ps1 -Entorno prd -SoloVerificar
```
El script separa cada `.kql` en comandos de control, los envía en orden a `/v1/rest/mgmt` y termina con una verificación
(Bronze, Silver y gastos vigentes).

## Promoción TEST → PRD en el portal (sin service principal)
1. **Git integration** en `<workspace-test>`: *Configuración del área de trabajo › Integración de Git › GitHub* (con un
   token personal de GitHub de alcance *Contents: read/write* sobre este repo), rama `fabric-dev`, carpeta `fabric/workspace`.
   Cada cambio hecho en el portal se guarda con *Control de código fuente › Confirmar*.
2. **Deployment pipeline** con dos etapas: *Test* = `<workspace-test>`, *Production* = `<workspace-prd>`.
   Promover con **implementación selectiva**: solo la base KQL / Eventhouse. **No** promover el Eventstream: su destino
   apunta al Eventhouse de su propio entorno y su Custom Endpoint tiene otra cadena de conexión.

## CI/CD automático (futuro, requiere service principal)
Requiere un **service principal** de Entra ID con rol en ambos workspaces y el tenant setting
"Service principals can use Fabric APIs". Con eso, GitHub Actions:
1. en PR: valida los `.kql` contra TEST;
2. en merge a `main`: aplica `fabric/kql/0*.kql` en TEST y, tras **aprobación manual** (environment `fabric-prd`), en PRD;
   y despliega los ítems (Eventstream, etc.) con `fabric-cicd` + `parameter.yml` para los IDs por entorno.
