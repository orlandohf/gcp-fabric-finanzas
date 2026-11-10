# De SQL a Gold: todas las rutas, en GCP y en Fabric

La pregunta de fondo en PDE y en DP-700 casi nunca es "¿cómo se configura X?", sino **"¿cuál de estas herramientas usarías
aquí y por qué?"**. Este documento compara las formas de llevar los datos de una base transaccional (nuestro
PostgreSQL `gastos`) hasta una capa **Gold** lista para reportes.

> Verifica siempre la documentación vigente: los conectores, los orígenes soportados y los precios cambian seguido
> (sobre todo en Fabric, que publica novedades cada mes).

---

## 1. Antes de elegir: las cinco preguntas

| Pregunta | Por qué decide la herramienta |
|---|---|
| **¿Qué latencia necesito?** (segundos / minutos / horas) | Segundos → CDC o streaming. Horas → batch incremental, que es más barato y simple |
| **¿Necesito UPDATE y DELETE o solo inserciones?** | Los borrados solo los ve el CDC (log de la BD) o un outbox. Un batch por *watermark* (`actualizado_en > último`) **no ve los DELETE** |
| **¿Puedo tocar la base origen?** | El CDC por log exige `logical_decoding`, slots y un usuario con `REPLICATION`. El outbox exige cambiar la app. El batch solo necesita `SELECT` |
| **¿Cómo llego por red?** | Cloud SQL sin redes autorizadas (nuestro caso) obliga a usar proxy, IP privada, túnel SSH o un *gateway*. Es el **problema #1** en la vida real |
| **¿Quién lo va a mantener?** | Analista (low-code: Dataflow Gen2, Data Fusion, Copy job) o ingeniero (Spark, Beam, SQL versionado) |

Tipos de patrón que debes poder nombrar en el examen:
- **Full load** (recarga total): simple; caro con volumen; ve borrados por diferencia.
- **Incremental por *watermark*** (columna `actualizado_en` o `version`): barato; **no ve DELETE físicos** (solución: *soft delete* o conciliación periódica).
- **CDC por log** (WAL de PostgreSQL, binlog de MySQL): ve todo con baja latencia; más complejo de operar.
- **CDC a nivel de aplicación (outbox)**: el que usamos en la app; control total del contrato; requiere código.
- **Federación / zero-copy** (consultar o enlazar sin copiar): cero pipelines; dependes del rendimiento y la disponibilidad del origen.

---

## 2. Google Cloud: las rutas de Cloud SQL a Gold en BigQuery

```
                        ┌─────────────── (A) Datastream (CDC por WAL) ──────────────┐
                        │                                                           ▼
Cloud SQL PostgreSQL ───┼─── (B) Federated query EXTERNAL_QUERY + scheduled query ──▶ BigQuery Bronze ──(Dataform / SQL)──▶ Silver ──▶ Gold
                        │                                                           ▲
                        ├─── (C) Dataflow (Apache Beam: JDBC batch o Pub/Sub stream) ┤
                        ├─── (D) Dataproc Serverless (Spark JDBC) → BigLake/Iceberg ─┤
                        ├─── (E) Cloud Data Fusion (visual, CDAP) ───────────────────┤
                        └─── (F) Outbox → Pub/Sub → BigQuery subscription ───────────┘
Orquestación transversal: Cloud Composer (Airflow) · Workflows + Cloud Scheduler · Dataform workflows
```

| | (A) **Datastream** | (B) **Federated query** | (C) **Dataflow** | (D) **Dataproc Serverless** | (E) **Data Fusion** | (F) **Pub/Sub → BQ subscription** |
|---|---|---|---|---|---|---|
| Qué es | CDC gestionado, sin servidores | BigQuery consulta Cloud SQL en vivo (`EXTERNAL_QUERY`) | Runner gestionado de Apache Beam (batch y streaming unificados) | Spark sin gestionar clúster | ETL visual (CDAP) con cientos de plugins | Mensajería; la suscripción escribe directo en una tabla |
| Latencia típica | Segundos a minutos (*staleness* configurable) | La de la *scheduled query* (≥ minutos) | Segundos (streaming) u horas (batch) | Minutos u horas (batch) | Minutos u horas | Segundos |
| Ve UPDATE/DELETE | ✅ (WAL) | ⚠️ Solo con full load o *soft delete* | ⚠️ En batch, igual que (B). ✅ En streaming si la fuente es CDC | ⚠️ Como (B) | ⚠️ Como (B); tiene plugins de replicación CDC | ✅ si el productor emite eventos CDC (nuestro outbox) |
| Cambios en el origen | `cloudsql.logical_decoding=on`, publicación, slot, usuario `REPLICATION` | Ninguno (solo `SELECT`) | Ninguno en batch | Ninguno | Ninguno en batch | Cambiar la app (outbox) |
| Red hacia Cloud SQL | IP allowlist, túnel SSH o **private connectivity** (peering) | Conexión de BigQuery (BigQuery Connection API) | Workers en tu VPC → IP privada o proxy | Igual que Dataflow | Instancia privada con peering | No toca la BD |
| Código | Ninguno | SQL | Java/Python (o *templates* listos) | PySpark/Scala | Ninguno (visual) | Ninguno en GCP; el productor es tu app |
| Costo | Por GB procesado | Por bytes consultados en BQ (barato con pocos datos) | Por vCPU/h de workers (streaming 24/7 = caro) | Por DCU/s de cada batch | 💸 Por hora de instancia | Por GB de mensajes + escritura en BQ |
| Mejor para | **Réplica fiel y casi en tiempo real** de una OLTP | Pocos datos, prototipos, enriquecer consultas | Transformaciones complejas en vuelo, ventanas de tiempo, varias fuentes | Equipos que ya usan Spark, formatos abiertos (Iceberg) | Equipos sin programadores; muchos conectores | Arquitecturas orientadas a eventos |
| Malo para | Transformar en vuelo (solo replica); orígenes que se apagan seguido | Volumen alto (carga la OLTP), latencia baja | Equipos pequeños: curva de Beam | Latencia baja | Presupuesto pequeño | Replicar tablas sin tocar la app |
| En el examen suena como… | "replicar con mínima latencia y **sin cambiar la app**", "CDC serverless" | "consultar datos operativos **sin moverlos**" | "**exactly-once**, ventanas, datos tardíos, autoescalado" | "migrar jobs **Spark/Hadoop** existentes" | "UI **sin código**, integración empresarial" | "desacoplar productores y consumidores", "**ingesta sin código** desde Pub/Sub" |

**Silver → Gold dentro de BigQuery (ELT):**
| Herramienta | Ventaja | Desventaja |
|---|---|---|
| **Dataform** (SQLX, en la consola de BigQuery) | Versionado en Git, dependencias (`ref()`), **assertions** de calidad, tablas incrementales; gratis (pagas solo las consultas) | Solo SQL; solo BigQuery |
| **Scheduled queries** | Cero configuración | Sin dependencias, sin pruebas, sin versionado: se vuelve inmantenible |
| **Vistas materializadas** | Incrementales y automáticas, *smart tuning* | Restricciones de SQL (joins y agregaciones limitados) |
| **dbt** (fuera de GCP) | Estándar de la industria | Otra herramienta que operar |

**Orquestación:**
| | Ventaja | Desventaja |
|---|---|---|
| **Cloud Composer** (Airflow) | Estándar, cientos de operadores, DAGs complejos, *backfills* | 💸 Entorno siempre encendido; pesado para algo simple |
| **Workflows + Cloud Scheduler** | Serverless, casi gratis, YAML | Lógica limitada, menos operadores |
| **Dataform workflow configs** | Integrado con Dataform | Solo orquesta Dataform |

> **Decisión para Mis Gastos (si la analítica viviera en GCP):** Datastream sería la ruta "de libro" para replicar
> `gastos`, **pero** la instancia se apaga 7 h cada noche, `db-f1-micro` tiene pocos recursos para un slot de replicación y
> cada reconexión puede pedir backfill. Por eso la app usa **outbox (F)**: en GCP el equivalente directo sería
> outbox → **Pub/Sub → BigQuery subscription** → Dataform. Esa es la respuesta de criterio que espera PDE: *depende de las
> restricciones*.

---

## 3. Microsoft Fabric: las rutas de una base SQL a Gold

```
                       ┌── (1) Mirroring (réplica CDC gestionada, casi sin configuración) ──────┐
                       ├── (2) Copy job (copia simple: full o incremental) ─────────────────────┤
Base SQL ── red/gateway┼── (3) Data pipeline + Copy activity (orquestado, parametrizable) ─────┼─▶ OneLake (Delta) Bronze ─▶ Silver ─▶ Gold
                       ├── (4) Dataflow Gen2 (Power Query, low-code) ───────────────────────────┤        (Lakehouse / Warehouse)
                       ├── (5) Notebook Spark (JDBC, MERGE en Delta) ───────────────────────────┤
                       └── (6) Eventstream (fuente CDC o Custom Endpoint) → Eventhouse KQL ─────┘ (lo que usa la app)
Zero-copy: (7) Shortcuts de OneLake (GCS, S3, ADLS…) — enlazan sin copiar
```

| | (1) **Mirroring** | (2) **Copy job** | (3) **Pipeline + Copy activity** | (4) **Dataflow Gen2** | (5) **Notebook Spark** | (6) **Eventstream → Eventhouse** |
|---|---|---|---|---|---|---|
| Qué es | Réplica continua gestionada a Delta en OneLake | Asistente de movimiento de datos con modo incremental | Orquestador (estilo Azure Data Factory) | Power Query en la nube | Spark (PySpark, Scala, SQL) | Streaming de eventos a KQL |
| Latencia | Segundos a minutos | Programada (minutos a horas) | Programada o por evento | Programada | Programada; o continua con *Structured Streaming* | Segundos |
| Ve UPDATE/DELETE | ✅ (CDC del origen) | ⚠️ Incremental por *watermark*; CDC solo en algunos orígenes | ⚠️ *Watermark*, salvo que lo implementes | ⚠️ Igual | ✅ si implementas `MERGE` con la lógica | ✅ con eventos CDC (nuestro contrato `op_type`) |
| Orígenes | **Lista acotada** (Azure SQL, SQL Server, Azure Database for PostgreSQL, Snowflake, Cosmos DB, BigQuery…, y *open mirroring* para el resto). **Revisa si tu origen está** | Muchos conectores | 100+ conectores | 150+ conectores de Power Query | Cualquiera con driver JDBC/ODBC o API | Kafka, Event Hubs, **Google Pub/Sub**, CDC de BD de Azure, Custom Endpoint |
| Código | Ninguno | Ninguno | Bajo (expresiones, parámetros) | Ninguno (M opcional) | Alto | Bajo (KQL) |
| Costo en CU | Cómputo de réplica gratis; almacenamiento con cuota gratis por capacidad | Bajo | Bajo-medio | **Alto** en volúmenes grandes (motor mashup) | Medio (sesión Spark) | Medio (Eventhouse siempre activo, salvo que se suspenda) |
| Mejor para | "Quiero la tabla en OneLake sin pensar" | Copias simples sin orquestación | Muchas tablas, dependencias, reintentos, metadatos (*metadata-driven*) | Analistas, transformaciones visuales, limpieza de datos | Volumen, lógica compleja, SCD2, *ML*, formatos | Tiempo real, alertas (Activator), series de tiempo |
| Malo para | Orígenes no soportados; transformar | Lógica compleja | Transformación pesada (delégala a notebook o SQL) | Volumen grande, CI/CD fino | Equipos sin Python | Reportes históricos pesados de BI (mejor Lakehouse) |
| En el examen suena como… | "**replicar casi en tiempo real sin ETL**" | "copiar datos **con la menor configuración**" | "**orquestar**, parametrizar, ForEach, manejar errores" | "**sin código**, Power Query, analista de negocio" | "**MERGE**, SCD tipo 2, grandes volúmenes, PySpark" | "**latencia de segundos**, KQL, telemetría, alertas" |

**Silver → Gold en Fabric: ¿dónde vive la capa?**
| Almacén | Lenguaje | Ventaja | Desventaja |
|---|---|---|---|
| **Lakehouse** | Spark (y SQL de solo lectura por el *SQL analytics endpoint*) | Formato abierto, cualquier dato, ML | Escribir requiere Spark |
| **Warehouse** | T-SQL completo (DML, procedimientos, transacciones multi-tabla) | Familiar para gente de SQL Server; seguridad granular | Solo datos estructurados |
| **Eventhouse (KQL DB)** | KQL | Tiempo real, series de tiempo, update policies | No es para modelado dimensional clásico |

Las tres guardan en **OneLake (Delta Parquet)**: se cruzan entre sí con *shortcuts* sin copiar. Esa es la gran diferencia
con GCP, donde BigQuery usa su propio almacenamiento (salvo **BigLake/Iceberg**, la respuesta de GCP a los formatos abiertos).

> **Restricción real de esta app:** la BD está en **Cloud SQL (GCP)**. Mirroring no la lista como origen nativo, y las
> rutas (2)–(5) necesitan **llegar por red** a una IP sin redes autorizadas: haría falta un **on-premises data gateway** en
> una VM dentro de GCP (con el proxy de Cloud SQL al lado) o abrir temporalmente la IP de la capacidad. Por eso la app
> **empuja** los eventos (outbox → Custom Endpoint) en vez de que Fabric los **jale**. Laboratorio DP700-03 lo hace a
> propósito para que sientas el problema.

---

## 4. Equivalencias GCP ↔ Fabric

| Necesidad | GCP | Fabric |
|---|---|---|
| CDC gestionado desde una BD | Datastream | Mirroring / fuentes CDC de Eventstream |
| Consultar sin mover | Federated query, BigLake | Shortcuts, *SQL analytics endpoint* |
| Copia batch simple | BigQuery Data Transfer Service (orígenes SaaS/nube), Storage Transfer | Copy job |
| Orquestación | Composer (Airflow), Workflows | Data pipelines (y *Apache Airflow job*) |
| ETL low-code | Data Fusion, Dataprep | Dataflow Gen2 |
| Spark | Dataproc / Serverless for Apache Spark | Notebooks / Spark job definitions |
| Streaming con código | Dataflow (Beam) | Spark Structured Streaming, Eventstream (no-code) |
| Mensajería | Pub/Sub | Eventstream (Event Hubs por debajo) |
| Almacén analítico | BigQuery | Warehouse / Lakehouse |
| Tiempo real y series de tiempo | Bigtable + BigQuery, (Looker) | Eventhouse (KQL) + Real-Time Dashboard |
| Transformación SQL versionada | Dataform | Notebooks/SQL en Git, (dbt) |
| Alertas sobre datos | Cloud Monitoring, Eventarc | **Activator** |
| Gobierno y calidad | Dataplex, Sensitive Data Protection | Purview, etiquetas de sensibilidad, endorsement |
| BI | Looker / Looker Studio | Power BI (Direct Lake) |
| Formato abierto | Iceberg (BigLake) | Delta Lake (OneLake) |

---

## 5. Hoja de decisión rápida

```
¿Necesitas segundos?
├─ Sí → ¿Puedes cambiar la app?
│       ├─ Sí → Outbox/eventos → Pub/Sub (GCP) | Eventstream Custom Endpoint (Fabric)
│       └─ No → CDC por log → Datastream (GCP) | Mirroring o CDC de Eventstream (Fabric)
└─ No (minutos u horas) → ¿Hay DELETE físicos que importen?
        ├─ Sí → Full load periódico, soft delete en el origen o CDC igualmente
        └─ No → Incremental por watermark
                 ├─ Sin código  → Copy job / Dataflow Gen2 (Fabric) | Data Fusion (GCP)
                 ├─ SQL         → Federated + scheduled query + Dataform (GCP) | Pipeline + Warehouse (Fabric)
                 └─ Volumen/ML  → Dataproc Serverless (GCP) | Notebook Spark (Fabric)
```
