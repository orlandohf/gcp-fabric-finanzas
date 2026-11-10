# PDE: Professional Data Engineer (laboratorios)

Dominios del examen (verifica los pesos en la guía vigente):
1. **Diseñar sistemas de procesamiento de datos**: seguridad, confiabilidad, flexibilidad, migraciones.
2. **Ingerir y procesar**: batch y streaming, pipelines, CDC.
3. **Almacenar**: elegir el almacén, modelar, data lake / warehouse / mesh.
4. **Preparar y usar los datos para análisis**: BigQuery, BI, compartir datos, ML.
5. **Mantener y automatizar**: orquestación, monitoreo, costos, calidad.

Requisito: haber hecho ACE-01, 02, 07 y 08 (proyecto, IAM, Storage y Cloud SQL) y leído [01-comparativa-sql-a-gold.md](01-comparativa-sql-a-gold.md).

**Escenario común:** una instancia Cloud SQL de laboratorio con el esquema de `gastos` (cópialo de `app/backend/db.py`) y
5.000 gastos sintéticos de 20 usuarios ficticios, generados con tu propio script.

| Lab | Tema | Dominio | Ruta SQL→Gold | Tiempo | Costo |
|---|---|---|---|---|---|
| PDE-01 | Datastream: CDC Cloud SQL → BigQuery | 2 | (A) | 3 h | ≈ US$ 1 |
| PDE-02 | Federated query + scheduled queries | 2, 4 | (B) | 1,5 h | céntimos |
| PDE-03 | Pub/Sub → BigQuery subscription (el outbox en GCP) | 2 | (F) | 2 h | céntimos |
| PDE-04 | Dataflow streaming: ventanas, watermarks, datos tardíos | 2 | (C) | 3–4 h | ≈ US$ 1–3 💸 |
| PDE-05 | Modelado en BigQuery: particiones, clustering, MV, seguridad por filas | 3, 4 | — | 3 h | céntimos |
| PDE-06 | Dataform: Bronze → Silver → Gold con assertions | 4, 5 | ELT | 3 h | céntimos |
| PDE-07 | Dataproc Serverless: Spark JDBC → Iceberg/BigLake | 2, 3 | (D) | 2–3 h | ≈ US$ 1 |
| PDE-08 | Orquestación: Composer vs Workflows | 5 | — | 3 h | 💸 Composer |
| PDE-09 | Gobierno: Dataplex, calidad, linaje, Sensitive Data Protection | 1, 5 | — | 3 h | céntimos |
| PDE-10 | BigQuery ML: pronóstico de gasto y anomalías | 4 | — | 2 h | céntimos |
| PDE-11 | Data Fusion: el mismo pipeline sin código | 2 | (E) | 2 h | 💸 por hora |

---

## PDE-01 · Datastream: CDC de Cloud SQL a BigQuery
**Objetivo:** replicar `gastos` casi en tiempo real **sin tocar la app**, y entender por qué la app eligió otro camino.
**Herramientas:** Datastream (connection profiles, private connectivity, streams), PostgreSQL logical decoding (`pgoutput`), BigQuery.

**Pasos**
1. En la instancia de laboratorio activa el flag **`cloudsql.logical_decoding=on`** (reinicia la instancia).
2. En PostgreSQL crea un usuario con `REPLICATION`, una **publicación** para `gastos` y un **replication slot** `pgoutput`. Lee qué pasa con el WAL si el slot no se consume.
3. **Conectividad** (la parte difícil): elige entre *IP allowlist* (agregar las IPs de Datastream de la región a las redes autorizadas), *forward SSH tunnel* o **private connectivity** (VPC peering). Haz la más simple primero y anota los riesgos de seguridad.
4. *Connection profiles* de origen (PostgreSQL) y de destino (BigQuery). Crea el **stream** con **backfill** y modo **merge**. Configura la **data freshness / max staleness**.
5. Inserta, actualiza y **borra** filas en Cloud SQL y míralas en BigQuery. Compara las tablas en modo *merge* y *append-only*.
6. **Experimento clave:** detén la instancia (como hace la app a las 23:00) 15 minutos y enciéndela. ¿El stream se recupera? ¿Qué pasó con el slot y con el WAL?

**Criterio de éxito:** un `DELETE` en Cloud SQL desaparece de BigQuery en menos de un minuto (según la *staleness*).

**Preguntas de cierre**
- ¿Qué tres requisitos tiene PostgreSQL como origen de Datastream?
- ¿Modo *merge* vs *append-only* en BigQuery: cuál necesitas para auditoría y cuál para reportes?
- ¿Por qué un slot de replicación abandonado puede **llenar el disco** de la instancia?
- Con las restricciones de Mis Gastos (BD apagada de noche, `db-f1-micro`), ¿Datastream u outbox? Justifica.

**Limpieza:** stream (pausar y borrar), connection profiles, private connectivity, **el slot** (`pg_drop_replication_slot`) y el flag.
**En Mis Gastos:** guía técnica 10.2 ("¿Por qué outbox y no CDC por replicación lógica?").

---

## PDE-02 · Federated query + scheduled queries (la ruta más simple)
**Objetivo:** llevar datos a BigQuery **sin pipeline** y conocer sus límites.
**Herramientas:** BigQuery Connection API (conexión a Cloud SQL), `EXTERNAL_QUERY`, scheduled queries, `MERGE`.

**Pasos**
1. Crea una **conexión** de BigQuery hacia la instancia de Cloud SQL. Dale a la SA de la conexión el rol que necesita.
2. Consulta en vivo: `SELECT … FROM EXTERNAL_QUERY('<conexión>', 'SELECT … FROM gastos WHERE …')`. Observa qué se ejecuta en PostgreSQL y qué en BigQuery (*pushdown*).
3. **Scheduled query** cada hora que hace `MERGE` incremental en `bronze.gastos` usando `actualizado_en` como *watermark*.
4. Borra un gasto en Cloud SQL. ¿Desaparece de BigQuery? (No.) Diseña la solución: *soft delete*, full load nocturno o comparación de llaves.
5. Mide el impacto: ¿qué pasa en la BD de origen si 50 analistas lanzan `EXTERNAL_QUERY` a la vez?

**Criterio de éxito:** la tabla Bronze se actualiza sola cada hora con los cambios (salvo los DELETE, y sabes explicar por qué).

**Preguntas de cierre**
- ¿Cuándo una federated query es la respuesta correcta en el examen? ("consultar datos operativos **sin moverlos**", "**una vez**", "pocos datos").
- ¿Qué limitaciones de tipos y de rendimiento tiene?
- ¿Por qué el *watermark* incremental no ve los DELETE físicos?

**Limpieza:** scheduled query, conexión y dataset.
**En Mis Gastos:** columna `actualizado_en` y `version` en `app/backend/db.py` (sirven de *watermark*).

---

## PDE-03 · El outbox en GCP: Pub/Sub → BigQuery subscription
**Objetivo:** construir en GCP el equivalente exacto de lo que la app hace con Fabric (eventos CDC empujados por la app).
**Herramientas:** Pub/Sub (schemas Avro/Protobuf, BigQuery subscriptions, dead-letter, ordering keys, *exactly-once delivery*), BigQuery.

**Pasos**
1. **Schema** de Pub/Sub (Avro o Protobuf) con los campos del contrato de evento de la app (guía técnica 10.3). Asócialo al topic.
2. Tabla `bronze.raw_gastos` en BigQuery y una **BigQuery subscription** (*use topic schema*, *write metadata*).
3. Escribe tu publicador (shell con `gcloud pubsub topics publish` o un script corto) que envíe `INSERT`, `UPDATE` y `DELETE` del mismo gasto, **desordenados** y **duplicados**.
4. Publica un mensaje que **no cumpla el schema**: ¿qué pasa? Configura un **dead-letter topic** en la suscripción.
5. En BigQuery escribe la vista Gold con la misma lógica que en KQL: la última versión por `id` gana (`QUALIFY ROW_NUMBER() OVER (PARTITION BY id ORDER BY version_timestamp DESC) = 1`) y se excluyen los `DELETE`.
6. Compara: KQL `arg_max(version_timestamp, *) by id` vs SQL `QUALIFY ROW_NUMBER()`.

**Criterio de éxito:** a pesar del desorden y de los duplicados, la vista Gold muestra el estado correcto de cada gasto.

**Preguntas de cierre**
- ¿BigQuery subscription vs Dataflow: cuándo basta la suscripción y cuándo necesitas Dataflow? (transformaciones, enriquecimiento, ventanas)
- ¿*Ordering keys* garantizan orden **entre** claves?
- ¿Por qué el consumidor debe deduplicar aunque actives *exactly-once delivery*?

**Limpieza:** suscripción, topic, schema y dataset.
**En Mis Gastos:** `app/backend/outbox.py`, `app/backend/db.py` (`evento()`), `fabric/kql/03_gold.kql`.

---

## PDE-04 · Dataflow streaming: ventanas, watermarks y datos tardíos
**Objetivo:** el tema más técnico (y más preguntado) del PDE.
**Herramientas:** Dataflow, Apache Beam (Python), Google-provided templates, Streaming Engine, autoscaling, *drain* vs *cancel*.

**Pasos**
1. Primero con un **template** (*Pub/Sub to BigQuery*): sin código, para ver el job graph, los workers y las métricas.
2. Luego tu pipeline Beam en Python, que lea del topic de PDE-03 y calcule el **gasto por usuario en ventanas**:
   - **fijas** (*tumbling*) de 1 minuto,
   - **deslizantes** (*hopping*) de 5 min cada 1 min,
   - de **sesión** (*gap* de 2 min: "ráfagas de compras").
3. Usa `version_timestamp` como **event time** (no el tiempo de llegada). Publica eventos **atrasados** a propósito y configura `allowed_lateness` y **triggers** (*early/on-time/late firings*).
4. Escribe a BigQuery con la **Storage Write API**.
5. Actualiza el pipeline en caliente (`--update`) y luego **drain** vs **cancel**: ¿qué pasa con los datos en vuelo?
6. Mira el **system lag** y el **data freshness** en la consola.

**Criterio de éxito:** un evento atrasado dentro del `allowed_lateness` corrige el total de su ventana; uno fuera de plazo se descarta (y lo puedes contar).

**Preguntas de cierre**
- ¿Event time vs processing time? ¿Qué es la **watermark**?
- ¿Drain vs cancel vs update?
- ¿Qué ventana usarías para "detectar sesiones de compra impulsiva"?
- ¿Cómo logra Dataflow *exactly-once* en el procesamiento?

**Limpieza:** 💸 **drain/cancel del job** (los workers de streaming cobran 24/7), bucket temporal y staging.
**En Mis Gastos:** `fabric/kql/03_gold.kql` (`fn_gasto_diario` con media móvil: la versión KQL de una ventana).

---

## PDE-05 · Modelado en BigQuery: particiones, clustering, MV y seguridad por filas
**Objetivo:** diseñar tablas baratas y seguras, como en la versión multiusuario de la app.
**Herramientas:** particionado por fecha, clustering, vistas materializadas, *authorized views*, **row-level security**, **policy tags** (column-level security), *dynamic data masking*, `INFORMATION_SCHEMA.JOBS`, *dry run*, *maximum bytes billed*.

**Pasos**
1. Tabla `silver.gastos` **particionada por `fecha_gasto`** y **clusterizada por `usuario_id, categoria`**. Exige filtro de partición.
2. Compara los bytes procesados de la misma consulta con y sin filtro de partición (*dry run*). Anota el ahorro.
3. **Vista materializada** de KPIs mensuales por usuario. Consulta la tabla base y observa si BigQuery la reescribe para usar la MV (*smart tuning*).
4. **Row-level security**: política `usuario_id = <id>` para un grupo o usuario de prueba. Es el mismo aislamiento que la app hace en el `WHERE`.
5. **Policy tag** sobre `concepto` (texto libre que podría tener datos personales) con **masking** (hash o null) para analistas.
6. *Authorized view* en otro dataset que expone solo agregados: compártela sin dar acceso a la tabla base.
7. Consulta `INFORMATION_SCHEMA.JOBS` para ver el costo por usuario y por consulta. Pon *maximum bytes billed* en tu sesión.

**Criterio de éxito:** un usuario de prueba solo ve sus filas, y ve `concepto` enmascarado.

**Preguntas de cierre**
- ¿Partición vs clustering: cuándo cada uno y cuándo ambos? ¿Límite de particiones?
- ¿On-demand vs capacity (*editions*, slots, *autoscaling*): cuándo conviene cada modelo?
- ¿Row-level security vs authorized view vs dataset separado por cliente?

**Limpieza:** datasets, políticas y taxonomía de policy tags.
**En Mis Gastos:** aislamiento por `usuario_id` en `app/backend/db.py`; guía técnica 4.5 (IDOR).

---

## PDE-06 · Dataform: Bronze → Silver → Gold con pruebas de calidad
**Objetivo:** ELT versionado dentro de BigQuery (la contraparte de los scripts KQL de la app).
**Herramientas:** Dataform (repositorio, workspace, SQLX, `ref()`, assertions, incremental tables, release y workflow configurations), Git.

**Pasos**
1. Repositorio de Dataform conectado a un repo Git **tuyo**.
2. `sources`: las tablas Bronze de PDE-01 o PDE-03.
3. `silver_gastos.sqlx` **incremental**, con la misma lógica que `fn_gastos_silver()` del KQL: normalizar `op_type`, calcular `monto_real` y `por_cobrar`.
4. `gold_gastos_actuales.sqlx` (última versión, sin DELETE) y `gold_kpis_mes.sqlx` por usuario.
5. **Assertions**: `uniqueKey` en Gold, `nonNull` en `id` y `usuario_id`, y una regla de negocio (`monto_propio <= monto_total`). Rompe una a propósito.
6. **Release configuration** + **workflow configuration** programada cada hora. Mira el grafo de dependencias.
7. Traduce una de tus funciones KQL a SQLX y anota las diferencias de lenguaje.

**Criterio de éxito:** el workflow programado corre solo, y una assertion rota detiene la publicación de Gold.

**Preguntas de cierre**
- ¿Dataform vs scheduled queries vs dbt?
- ¿Tabla incremental vs vista vs tabla completa en Dataform?
- ¿Dónde viven los resultados de las assertions y cómo alertarías sobre ellos?

**Limpieza:** workflow configs, release configs y datasets.
**En Mis Gastos:** `fabric/kql/02_silver.kql` y `03_gold.kql` (misma lógica, otro motor).

---

## PDE-07 · Dataproc Serverless: Spark JDBC → Iceberg en BigLake
**Objetivo:** la ruta "formato abierto" de GCP, para compararla con Delta en OneLake.
**Herramientas:** Dataproc Serverless (Google Cloud Serverless for Apache Spark), PySpark, conector JDBC de PostgreSQL, BigLake, Apache Iceberg, BigQuery metastore.

**Pasos**
1. Job batch PySpark que lea `gastos` por **JDBC** (con el proxy o con IP privada desde la VPC de ACE-03: ¡conectividad otra vez!).
2. Escribe en **Iceberg** sobre GCS registrado como **tabla BigLake**. Consúltala desde BigQuery.
3. Segunda ejecución **incremental** con `MERGE INTO` de Iceberg.
4. *Time travel*: consulta la tabla como estaba antes del `MERGE`.
5. Compara tiempo, costo y líneas de código con PDE-02 y PDE-06.

**Criterio de éxito:** la misma tabla Iceberg legible desde Spark y desde BigQuery.

**Preguntas de cierre**
- ¿Dataproc en clúster vs Serverless vs Dataflow? (pista: "migrar jobs Spark/Hadoop existentes" = Dataproc)
- ¿Qué gana una empresa con formatos abiertos (Iceberg o Delta) frente a tablas nativas?
- ¿Cómo ahorrar en Dataproc en clúster? (preemptibles/Spot en workers secundarios, autoscaling, clústeres efímeros)

**Limpieza:** batches, bucket y tabla BigLake.
**En Mis Gastos:** OneLake availability (Delta) en `fabric/kql/03_gold.kql`.

---

## PDE-08 · Orquestación: Cloud Composer vs Workflows
**Objetivo:** encadenar extracción → transformación → calidad → aviso, y elegir el orquestador correcto.
**Herramientas:** Cloud Composer 3 (Airflow: DAGs, operadores de Google, sensores, XCom, backfill), Workflows, Cloud Scheduler.

**Pasos**
1. 💸 Crea el entorno de **Composer** más pequeño. **Anota la hora: bórralo hoy.**
2. DAG: `MERGE` incremental (PDE-02) → ejecución de Dataform (PDE-06) → consulta de calidad → si falla, mensaje a Pub/Sub. Usa operadores de BigQuery y Dataform.
3. **Backfill** de 3 días con `catchup` y `{{ ds }}`.
4. El mismo flujo en **Workflows** (YAML) disparado por **Cloud Scheduler**. Compara líneas, costo y observabilidad.
5. Borra Composer.

**Criterio de éxito:** el mismo flujo corre en los dos orquestadores y sabes justificar cuál usarías aquí.

**Preguntas de cierre**
- ¿Cuándo Composer es imprescindible? (muchas dependencias, *backfills*, sensores, equipos que ya usan Airflow)
- ¿Por qué Composer cuesta aunque no corra nada?
- ¿Workflows vs Cloud Scheduler solo vs Eventarc?

**Limpieza:** 💸 **entorno de Composer** (y su bucket), workflow y job de Scheduler.
**En Mis Gastos:** `infra-gcp/scheduler.tf` (Scheduler llamando a una API con OAuth: orquestación mínima).

---

## PDE-09 · Gobierno: Dataplex, calidad, linaje y Sensitive Data Protection
**Objetivo:** los temas de "confianza en los datos" que el PDE mezcla en todos sus dominios.
**Herramientas:** Dataplex Universal Catalog (búsqueda, *aspects*, *glossary*), *data profiling* y *data quality scans*, **data lineage**, Sensitive Data Protection (DLP: inspección y de-identificación), *BigQuery sharing* (Analytics Hub).

**Pasos**
1. **Profiling scan** de `silver.gastos`: distribución de montos, nulos y valores únicos.
2. **Data quality scan** con reglas: `monto_total >= 0`, `moneda IN ('PEN','USD')`, unicidad de `id` en Gold, frescura < 2 h. Prográmalo.
3. Revisa el **linaje** automático entre Bronze, Silver y Gold (generado por las consultas de Dataform).
4. Mete correos y números de tarjeta falsos en algunos `concepto` y haz una **inspección con Sensitive Data Protection**. Luego una **de-identificación** (enmascarar o tokenizar) hacia una tabla limpia.
5. Comparte un dataset de agregados con otro proyecto vía **BigQuery sharing** (listing).

**Criterio de éxito:** un reporte de calidad programado y una tabla sin datos sensibles generada automáticamente.

**Preguntas de cierre**
- ¿Tokenización determinista vs enmascaramiento vs *format-preserving encryption*?
- ¿Cómo demuestras a un auditor de dónde salió un número de un dashboard? (linaje)
- ¿Seudonimización vs anonimización? (la app envía `usuario_id` seudónimo a Fabric: ¿sigue siendo dato personal?)

**Limpieza:** scans, plantillas de DLP, listing y datasets.
**En Mis Gastos:** contrato de evento con `usuario_id` (guía técnica 10.3, seudonimización); `fabric/kql/99_verificacion.kql` (calidad en KQL).

---

## PDE-10 · BigQuery ML: pronóstico del gasto y anomalías
**Objetivo:** ML dentro del almacén, sin mover datos (el PDE pregunta *cuándo* usar BQML, AutoML o Vertex AI custom).
**Herramientas:** BigQuery ML (`ARIMA_PLUS`, `ML.FORECAST`, `ML.DETECT_ANOMALIES`, `ML.EVALUATE`), modelos remotos de Gemini en BigQuery (`ML.GENERATE_TEXT` / `AI.GENERATE`).

**Pasos**
1. Serie diaria de gasto por usuario (Gold de PDE-06).
2. `CREATE MODEL … OPTIONS(model_type='ARIMA_PLUS', time_series_id_col='usuario_id' …)`: un modelo por usuario en una sola sentencia.
3. Pronóstico de los próximos 30 días con intervalo de confianza; compáralo con el mes real.
4. `ML.DETECT_ANOMALIES` para los días atípicos. Compáralo con la regla simple de KQL (`> 2 × promedio_30d`).
5. Opcional: clasifica el `concepto` en categorías con un **modelo remoto de Gemini** desde SQL y compara contra la categoría elegida por el usuario.

**Criterio de éxito:** una tabla con pronóstico y anomalías por usuario, producida solo con SQL.

**Preguntas de cierre**
- ¿BQML vs AutoML vs entrenamiento custom en Vertex AI: criterios?
- ¿Qué es la estacionalidad y cómo la maneja ARIMA_PLUS?
- ¿Riesgos de enviar texto libre de usuarios a un LLM? (relaciónalo con la minimización de datos de `app/backend/ia.py`)

**Limpieza:** modelos y conexión remota.
**En Mis Gastos:** `app/backend/ia.py` (consejos con agregados), `fabric/kql/03_gold.kql` (`fn_gasto_diario`, anomalías).

---

## PDE-11 · Cloud Data Fusion: el mismo pipeline sin código
**Objetivo:** conocer la opción visual para responder bien "equipo sin programadores".
**Herramientas:** Cloud Data Fusion (edición Developer), Wrangler, plugins de PostgreSQL y BigQuery, *replication* (CDC).

**Pasos**
1. 💸 Instancia **Developer** (la más barata). **Anota la hora.**
2. Con **Wrangler**, limpia el CSV de gastos sintéticos (tipos, nulos, estandarizar `metodo_pago`).
3. Pipeline batch: PostgreSQL → transformaciones → BigQuery. Ejecútalo y mira en qué corre (Dataproc efímero).
4. Mira (sin necesidad de ejecutarlo) el **job de replicación** CDC y compáralo con Datastream.
5. Borra la instancia.

**Criterio de éxito:** sabes explicar qué hay debajo de Data Fusion (CDAP sobre Dataproc) y por qué tarda en arrancar.

**Preguntas de cierre:** ¿Data Fusion vs Dataflow vs Dataprep? ¿Por qué no se justifica para un volumen como el de Mis Gastos?
**Limpieza:** 💸 **instancia de Data Fusion**.
