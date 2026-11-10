# Siguientes pasos: laboratorios para certificarte

Mis Gastos ya resolvió un problema real con GCP y Fabric, pero lo **construimos juntos**. Esta carpeta es para que tú
construyas **solo**, a mano en la consola o con tus propios scripts de `gcloud`, `bq`, `terraform` o PowerShell, cada pieza que
entra en tres exámenes:

| Certificación | Código | Archivo | Enfoque |
|---|---|---|---|
| Google **Associate Cloud Engineer** | ACE | [02-ace.md](02-ace.md) | Operar GCP: proyectos, IAM, redes, cómputo, almacenamiento, monitoreo |
| Google **Professional Data Engineer** | PDE | [03-pde.md](03-pde.md) | Diseñar pipelines: CDC, streaming, BigQuery, orquestación, gobierno |
| Microsoft **Fabric Data Engineer Associate** | DP-700 | [04-dp700.md](04-dp700.md) | Lakehouse, Warehouse, Eventhouse, pipelines, seguridad, CI/CD, monitoreo |
| Las tres | — | [01-comparativa-sql-a-gold.md](01-comparativa-sql-a-gold.md) | **Las distintas formas de llevar datos de SQL a Gold** en GCP y en Fabric: ventajas, desventajas y cuándo usar cada una |
| Las tres | — | [05-proyecto-integrador.md](05-proyecto-integrador.md) | El mismo dato por tres rutas y conciliación de resultados |

> Los temarios oficiales cambian. Antes de estudiar, abre la *exam guide* vigente de cada examen y marca qué dominios cubre
> cada laboratorio (la tabla de cada archivo trae la referencia al dominio).

---

## Reglas del laboratorio (léelas antes de crear nada)

1. **Un proyecto GCP propio solo para laboratorios**, por ejemplo `lab-<tu-alias>-2026`, con su propia cuenta de facturación
   o la de prueba gratuita. **No uses el proyecto compartido del trabajo** donde vive la app: ahí hay decenas de servicios ajenos
   y un error de IAM o de red afecta a otros.
2. **Presupuesto con alertas al crear el proyecto** (laboratorio ACE-01): por ejemplo US$ 20 con avisos al 50 %, 90 % y 100 %.
   Una alerta de presupuesto **avisa, no corta** el gasto.
3. **Fabric:** crea un workspace `lab-dp700` aparte. **Nunca** practiques en el workspace de PRD.
4. **Datos sintéticos.** La app ahora tiene datos de amigos y familia. Para practicar, genera gastos falsos (escribe tú un
   script que cree N filas con el mismo esquema de `gastos`) o usa solo tus propios gastos exportados.
5. **Todo laboratorio termina con limpieza.** Cada uno trae su lista de *cleanup*. Los recursos caros van marcados con 💸.
6. **Primero a mano y luego en código.** Haz cada laboratorio una vez en la consola para *ver* las opciones, y la segunda vez
   con tu propio script o con Terraform. El examen pregunta por opciones que solo se descubren en la consola, y el trabajo
   real exige automatizar.
7. **Bitácora.** Por cada laboratorio anota: qué hiciste, qué falló, cuánto costó y las respuestas a las *preguntas de cierre*.
   Esas preguntas imitan el estilo del examen.

### Recursos que cobran aunque no los uses 💸
| Recurso | Por qué cobra | Cómo evitarlo |
|---|---|---|
| Cloud Composer | El entorno (GKE + Cloud SQL internos) corre 24/7 | Crear, practicar y **borrar el mismo día** |
| Cloud Data Fusion | Se cobra por hora de instancia, incluso sin pipelines | Edición *Developer*, borrar al terminar |
| Cloud NAT, balanceadores, IP estáticas sin usar | Cargo por hora | Borrar al terminar |
| GKE Standard | Cargo de gestión del clúster + nodos | Usar **Autopilot** y borrar |
| Dataflow streaming | Workers encendidos mientras el job vive | **Drain/cancel** el job |
| Cloud SQL | Por hora mientras está encendido | `activation-policy NEVER` o borrar |
| Capacidad de Fabric (F SKU de pago) | Por hora mientras está activa | Usar la *trial* o **pausar** la capacidad |
| Datastream | Por GB procesado (backfill inicial incluido) | Pocas filas, pausar el stream |

---

## Ruta sugerida (12–14 semanas a ~6 h/semana)

```
Semanas 1–4   ACE-01 … ACE-10         base de GCP: sin esto, PDE cuesta el doble
Semanas 5–6   01-comparativa + PDE-01, PDE-02, PDE-06   las rutas SQL → BigQuery
Semanas 7–8   PDE-03 … PDE-05, PDE-07 … PDE-10          streaming, modelado, orquestación, gobierno
Semanas 9–12  DP700-01 … DP700-10                       Fabric de punta a punta
Semanas 13–14 05-proyecto-integrador + simulacros
```
Orden de exámenes recomendado: **ACE → DP-700 → PDE**. DP-700 es *Associate*, y PDE es el más amplio (y el más
"de criterio": casi todas sus preguntas son "¿qué servicio elegirías y por qué?").

## Cómo se conecta con Mis Gastos
Cada laboratorio indica **dónde aparece el concepto en este repositorio**, para que leas el código real después de hacerlo
tú. La guía técnica completa está en [`docs/ARQUITECTURA.md`](../docs/ARQUITECTURA.md), y sus preguntas de repaso
(sección 14) sirven de calentamiento.
