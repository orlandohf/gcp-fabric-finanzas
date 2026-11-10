# ACE: Associate Cloud Engineer (laboratorios)

Dominios del examen (verifica los pesos en la guía vigente):
1. **Configurar un entorno de nube**: jerarquía de recursos, proyectos, facturación, APIs, CLI.
2. **Planificar e implementar**: cómputo (Compute Engine, GKE, Cloud Run, Functions), almacenamiento, bases de datos, redes, IaC.
3. **Garantizar la operación**: administrar recursos, monitoreo, logging, respaldos.
4. **Configurar acceso y seguridad**: IAM, service accounts, auditoría.

Formato de cada laboratorio: **objetivo → herramientas → pasos → criterio de éxito → preguntas de cierre → limpieza**.
Los pasos dicen *qué* hacer y qué grupo de comandos explorar (`gcloud compute …`). El script lo escribes tú.

| Lab | Tema | Dominio | Tiempo | Costo |
|---|---|---|---|---|
| ACE-01 | Proyecto propio, facturación, presupuesto y `gcloud` | 1 | 1 h | US$ 0 |
| ACE-02 | IAM a fondo: roles, SA, impersonación, condiciones | 4 | 2 h | US$ 0 |
| ACE-03 | VPC propia: subredes, firewall, NAT, Private Google Access | 2 | 2 h | céntimos 💸 NAT |
| ACE-04 | Compute Engine: VM sin IP pública, IAP, snapshots, imágenes | 2, 3 | 2 h | < US$ 1 |
| ACE-05 | MIG + autoscaling + balanceador HTTP | 2 | 2–3 h | ≈ US$ 1 💸 LB |
| ACE-06 | GKE Autopilot con la imagen de Mis Gastos | 2 | 3 h | ≈ US$ 1–2 💸 |
| ACE-07 | Cloud Storage: clases, ciclo de vida, versiones, URLs firmadas | 2 | 1,5 h | céntimos |
| ACE-08 | Cloud SQL: proxy, backups, clon, PITR, réplica, IAM auth | 2, 3 | 3 h | ≈ US$ 1 |
| ACE-09 | Funciones y eventos: Cloud Run functions + Eventarc + Pub/Sub | 2 | 2 h | céntimos |
| ACE-10 | Operación: Monitoring, uptime, alertas, log sinks, Ops Agent | 3 | 2–3 h | céntimos |

---

## ACE-01 · Proyecto propio, facturación y `gcloud` como profesional
**Objetivo:** dominar el "día cero" que el examen da por sabido.
**Herramientas:** Console, Cloud Shell, `gcloud config`, Billing, Budgets, Service Usage.

**Pasos**
1. Crea un proyecto de laboratorio y vincúlalo a una cuenta de facturación. Anota la diferencia entre **ID**, **nombre** y **número** del proyecto: ¿cuál es inmutable y cuál aparece en la URL determinista de Cloud Run?
2. Crea un **presupuesto** con umbrales de 50/90/100 % y alertas por correo. Investiga cómo conectarlo a **Pub/Sub** para automatizar una reacción, por ejemplo deshabilitar la facturación (solo léelo; no lo implementes en un proyecto con algo importante).
3. Crea **dos configuraciones** de `gcloud` (`gcloud config configurations …`): `lab` y `trabajo`. Cambia entre ellas y comprueba qué proyecto y qué cuenta quedan activos. Esto evita el clásico "lo creé en el proyecto equivocado".
4. Habilita solo las APIs que necesites (`gcloud services enable …`) y lista las habilitadas. ¿Qué pasa si llamas a una API deshabilitada?
5. Activa la **exportación de facturación a BigQuery** (*detailed usage cost*). La usarás en el proyecto integrador para medir el costo por laboratorio.
6. Etiqueta (`labels`) cada recurso que crees con `lab=ace-XX`. Luego filtra los costos por etiqueta.

**Criterio de éxito:** `gcloud config list` muestra el proyecto de laboratorio; el presupuesto envía la alerta de prueba; la exportación de facturación tiene su dataset creado.

**Preguntas de cierre**
- Un desarrollador debe crear proyectos pero **no** ver la facturación. ¿Qué rol(es) le das y en qué nivel de la jerarquía?
- ¿El presupuesto detiene el gasto al llegar al 100 %? ¿Qué harías si necesitaras un tope duro?
- ¿Diferencia entre *labels*, *tags* (Resource Manager) y *network tags*?

**Limpieza:** nada; el proyecto se queda para los demás laboratorios.
**En Mis Gastos:** `infra-gcp/apis.tf` (APIs con `for_each`), sección 5.2 de la guía técnica (costos).

---

## ACE-02 · IAM a fondo: roles, service accounts, impersonación y condiciones
**Objetivo:** entender *quién* puede hacer *qué* sobre *cuál* recurso, y cómo demostrarlo.
**Herramientas:** IAM, Service Accounts, Policy Troubleshooter, Policy Analyzer, IAM Recommender, Cloud Audit Logs.

**Pasos**
1. Crea una SA `lector-lab` **sin llaves**. Dale `roles/storage.objectViewer` **solo sobre un bucket** (no sobre el proyecto).
2. Concédete `roles/iam.serviceAccountTokenCreator` sobre esa SA y ejecuta comandos **impersonándola** (`--impersonate-service-account`). Comprueba que puede leer ese bucket y no otro.
3. Crea un **rol personalizado** con 3 permisos (por ejemplo listar instancias de Compute sin poder detenerlas). Compáralo con el rol predefinido más cercano.
4. Agrega una **condición IAM** de tiempo (`request.time < …`) a un binding: acceso temporal que expira solo.
5. Usa el **Policy Troubleshooter** para explicar por qué la SA *no* puede borrar un objeto.
6. Busca en **Cloud Audit Logs** (Admin Activity) quién creó la SA y cuándo. Luego habilita los **Data Access logs** de Cloud Storage y observa la diferencia.
7. Opcional: crea una llave JSON para la SA, mira el riesgo (es un secreto que no caduca) y **bórrala**. Investiga la *org policy* `iam.disableServiceAccountKeyCreation`.

**Criterio de éxito:** puedes explicar con el Troubleshooter cada "permitido" y cada "denegado" de tu prueba.

**Preguntas de cierre**
- ¿Diferencia entre `iam.serviceAccountUser` y `iam.serviceAccountTokenCreator`?
- ¿Por qué los roles básicos (Owner/Editor/Viewer) se desaconsejan en producción?
- ¿Qué logs de auditoría están siempre activos y cuáles hay que habilitar (y por qué cuestan)?
- Una app en Cloud Run necesita leer un secreto. ¿Qué rol, sobre qué recurso y a qué identidad?

**Limpieza:** borra la SA, el rol personalizado y el bucket de prueba.
**En Mis Gastos:** `infra-gcp/cloudrun.tf` (SA `finanzas-run`, `cloudsql.client` con **condición IAM**), `infra-gcp/github_wif.tf` (WIF: sin llaves), guía técnica 4.1–4.3.

---

## ACE-03 · VPC propia: subredes, firewall, Cloud NAT y Private Google Access
**Objetivo:** construir la red que la app **no** tiene (hoy usa IP pública + proxy) para entender la alternativa privada.
**Herramientas:** VPC (modo *custom*), firewall rules / network firewall policies, Cloud NAT, Cloud Router, Private Google Access, Connectivity Tests.

**Pasos**
1. Crea una VPC en **modo custom** con dos subredes en regiones distintas (rangos que no se solapen). ¿Por qué *custom* y no *auto* en producción?
2. Reglas de firewall: permite SSH **solo desde el rango de IAP** (`35.235.240.0/20`) hacia instancias con la *network tag* `ssh`. Niega todo lo demás (recuerda las reglas implícitas).
3. Crea una VM **sin IP pública** y verifica que no puede salir a internet. Agrega **Cloud NAT** y vuelve a probar. 💸 el NAT cobra por hora.
4. Activa **Private Google Access** en la subred y demuestra que la VM sin IP pública llega a `storage.googleapis.com` **sin NAT** (apaga el NAT para probarlo).
5. Usa **Connectivity Tests** para diagnosticar una conexión bloqueada por firewall.
6. Lee (o haz, si tienes tiempo) **Private Service Access** (peering para servicios gestionados como Cloud SQL) y **Direct VPC egress** de Cloud Run. Es la recomendación pendiente de la app: Cloud SQL con IP privada.
7. Opcional: **VPC Network Peering** entre dos VPC y comprueba que el peering **no es transitivo**.

**Criterio de éxito:** VM privada que sale a Google APIs sin NAT y a internet solo con NAT; SSH solo vía IAP.

**Preguntas de cierre**
- ¿Prioridad y orden de evaluación de las reglas de firewall? ¿Qué reglas implícitas existen?
- ¿Shared VPC o VPC peering para que 5 proyectos compartan una red con control central?
- ¿Por qué una VM sin IP pública necesita NAT para `apt update` pero no para leer un bucket (con PGA)?

**Limpieza:** NAT, router, VMs, reglas, subredes y VPC (en ese orden).
**En Mis Gastos:** `infra-gcp/cloudsql.tf` (`ipv4_enabled` sin `authorized_networks`), guía técnica 3.2.1 (IP pública vs privada).

---

## ACE-04 · Compute Engine: VM privada, IAP, discos, snapshots e imágenes
**Objetivo:** el ciclo de vida completo de una VM.
**Herramientas:** Compute Engine, IAP TCP forwarding, persistent disks, snapshots y *snapshot schedules*, custom images, machine images, startup scripts, metadata, Spot VMs.

**Pasos**
1. VM `e2-micro` **Spot** en la VPC de ACE-03, con un **startup script** (en metadata) que instale nginx y escriba el hostname en `index.html`.
2. Conéctate por SSH **a través de IAP** (sin IP pública). Luego haz *port forwarding* del puerto 80 a tu PC con IAP.
3. Agrega un **disco adicional**, formatéalo, móntalo y escribe un archivo. Redimensiónalo en caliente.
4. Crea una **snapshot schedule** diaria y un snapshot manual. Restaura el snapshot como disco nuevo en otra VM.
5. Crea una **custom image** desde el disco de arranque y una **machine image** de la VM. Anota en qué se diferencian.
6. Cambia el tipo de máquina (requiere detenerla). Simula la *preemption* de la Spot VM y observa qué pasa.

**Criterio de éxito:** VM nueva creada desde tu imagen que sirve la página sin correr el startup script.

**Preguntas de cierre**
- ¿Spot vs estándar vs *committed use discounts* vs *sustained use discounts*: cuándo conviene cada uno?
- ¿Snapshot vs custom image vs machine image vs *instance template*?
- ¿Qué pasa con los datos de un **disco local SSD** al detener la VM?

**Limpieza:** VMs, discos, snapshots, imágenes y schedule.
**En Mis Gastos:** nada (la app es serverless). Por eso hay que practicarlo aparte: el ACE pregunta mucho de Compute Engine.

---

## ACE-05 · Grupo de instancias administrado + autoscaling + balanceador HTTP(S)
**Objetivo:** alta disponibilidad "clásica" con VMs, para compararla con Cloud Run.
**Herramientas:** instance templates, MIG regional, autohealing, health checks, autoscaler, Application Load Balancer externo, Cloud CDN (opcional).

**Pasos**
1. **Instance template** con la imagen de ACE-04 (o el startup script).
2. **MIG regional** de 2 instancias con **health check** HTTP y **autohealing**. Borra una VM a mano y observa cómo se recrea.
3. **Autoscaling** por CPU (objetivo 60 %). Genera carga (por ejemplo con `hey` o `ab` desde Cloud Shell) y observa el escalado.
4. **Application Load Balancer** externo con el MIG como backend. Prueba la IP del balanceador.
5. **Rolling update**: crea una template v2 (cambia el HTML) y despliega con `max-surge`/`max-unavailable`. Luego haz un **canary** (10 % en v2).
6. Opcional: activa Cloud CDN y mira los *cache hits*.

**Criterio de éxito:** actualizas sin cortes mientras un `while true; do curl …; done` corre en otra terminal.

**Preguntas de cierre**
- ¿MIG zonal vs regional? ¿Qué protege cada uno?
- ¿Health check del balanceador vs del autohealing: pueden ser distintos? ¿Por qué querrías que lo fueran?
- Compara lo que hiciste con lo que Cloud Run da gratis (revisiones, escalado, TLS). ¿Cuándo elegirías igual VMs?

**Limpieza:** 💸 balanceador (forwarding rule, proxy, URL map, backend), MIG, template, health check e IP.
**En Mis Gastos:** guía técnica 3.1 (Cloud Run: revisiones, escala a cero) y 12.2 (rolling por revisiones).

---

## ACE-06 · GKE Autopilot con la imagen de Mis Gastos
**Objetivo:** desplegar **el mismo contenedor** que corre en Cloud Run, ahora en Kubernetes, y sentir la diferencia operativa.
**Herramientas:** GKE Autopilot, `kubectl`, Artifact Registry, Deployments, Services, Ingress/Gateway, HPA, ConfigMaps/Secrets, Workload Identity Federation for GKE.

**Pasos**
1. Copia la imagen de la app a un Artifact Registry de tu proyecto de laboratorio (o compílala desde `app/Dockerfile`).
2. Crea un clúster **Autopilot**. Anota qué cosas ya no gestionas (nodos, *node pools*) y qué pagas (pods).
3. `Deployment` con 2 réplicas, *readiness probe* en `/api/health` y límites de CPU y memoria.
4. Variables: `COOKIE_SECURE=false`, un `SESSION_SECRET` en un **Secret** de Kubernetes. La app arrancará sin BD (responde 503 en `/api/gastos`, lo cual es correcto).
5. `Service` tipo LoadBalancer o **Ingress**. Abre `/api/health` y la pantalla de login.
6. **HPA** por CPU. Genera carga y mira cómo escala.
7. **Workload Identity Federation for GKE**: asocia el *Kubernetes Service Account* a una SA de Google y lee un secreto de Secret Manager desde el pod (sin llaves).
8. `kubectl rollout` de una nueva versión y `rollout undo`.

**Criterio de éxito:** la pantalla de login de Mis Gastos servida desde GKE; rollback funcionando.

**Preguntas de cierre**
- ¿Autopilot vs Standard: quién gestiona los nodos, cómo se cobra y qué no puedes hacer en Autopilot?
- ¿Cuándo GKE en lugar de Cloud Run? (servicios con estado, protocolos no HTTP, *sidecars* complejos, control de red fino…)
- ¿Qué comando muestra por qué un pod está en `Pending`?

**Limpieza:** 💸 borra el clúster (la gestión del clúster cobra por hora) y el balanceador que creó el Service.
**En Mis Gastos:** `app/Dockerfile`, `infra-gcp/cloudrun.tf`; tabla "Mapa de herramientas" de la guía técnica (Cloud Run vs GKE).

---

## ACE-07 · Cloud Storage: clases, ciclo de vida, versiones y URLs firmadas
**Objetivo:** el almacenamiento de objetos que todos los exámenes de GCP dan por sabido.
**Herramientas:** `gcloud storage`, clases (Standard/Nearline/Coldline/Archive), Autoclass, lifecycle, object versioning, soft delete, retention policy y bucket lock, signed URLs, uniform bucket-level access, public access prevention.

**Pasos**
1. Bucket regional con **uniform bucket-level access** y **public access prevention** (como el bucket del tfstate de la app).
2. Activa el **versionado**: sube, sobrescribe y borra un archivo; luego recupera la versión anterior.
3. Regla de **lifecycle**: pasar a Nearline a los 30 días, borrar versiones no actuales después de 3 versiones nuevas. Compara con **Autoclass**.
4. Genera una **signed URL** de 10 minutos para descargar un objeto sin cuenta de Google (necesitarás impersonar una SA).
5. **Retention policy** de 1 día: intenta borrar un objeto antes de tiempo. Lee qué significa "bloquear" la política (es irreversible).
6. Exporta 100 gastos sintéticos a CSV y súbelos: los usarás en PDE y DP-700.

**Criterio de éxito:** recuperas un archivo "borrado" y compartes otro con una URL que expira.

**Preguntas de cierre**
- Datos que se leen una vez al año y deben guardarse 7 años, al menor costo: ¿qué clase y qué política?
- ¿Por qué *uniform bucket-level access* en lugar de ACLs?
- ¿Costo de recuperación y duración mínima de almacenamiento de Coldline/Archive?

**Limpieza:** objetos y bucket. Ojo: la retención impide borrar hasta que venza.
**En Mis Gastos:** `infra-gcp/state_bucket.tf` (versionado, `public_access_prevention`, `prevent_destroy`).

---

## ACE-08 · Cloud SQL: proxy, backups, clon, PITR, réplica e IAM auth
**Objetivo:** responder con práctica la duda "¿puedo entrar a la BD como en SSMS?" y operar Cloud SQL como DBA.
**Herramientas:** Cloud SQL for PostgreSQL, Cloud SQL Auth Proxy, Cloud SQL Studio, backups on-demand y automáticos, clones, PITR, read replicas, IAM database authentication, *database flags*.

**Pasos**
1. Instancia `db-f1-micro` **sin redes autorizadas** (igual que la app). Intenta conectarte por IP con `psql`: debe fallar.
2. Conéctate con el **Cloud SQL Auth Proxy** desde tu PC y con **DBeaver/pgAdmin** a `127.0.0.1`. Luego por **Cloud SQL Studio**. Por último con `gcloud sql connect` y mira en la consola cómo **agrega tu IP a las redes autorizadas temporalmente**.
3. Carga los gastos sintéticos. Haz un **backup on-demand**, borra una tabla y **restaura** el backup sobre un **clon** (no sobre la original).
4. Activa **PITR** y restaura a "hace 5 minutos" en una instancia nueva. ¿Qué se necesita (logs de transacciones) y cuánto cuesta?
5. Crea una **read replica**, verifica el *replication lag* e intenta escribir en ella.
6. Activa **IAM database authentication** (flag `cloudsql.iam_authentication`) y entra con tu cuenta de Google **sin contraseña** (proxy con `--auto-iam-authn`).
7. Programa el apagado y encendido con Cloud Scheduler, como en la app (`activationPolicy`).

**Criterio de éxito:** restauras datos borrados por dos caminos (backup y PITR) y entras sin contraseña con IAM.

**Preguntas de cierre**
- ¿HA (standby regional) vs read replica vs réplica *cross-region*: qué protege cada una?
- ¿Por qué `db-f1-micro` no tiene SLA?
- ¿Qué hace exactamente el Auth Proxy que no hace una conexión directa con TLS?
- ¿Qué rol necesita un usuario para usar el proxy? ¿Y para entrar con IAM DB auth?

**Limpieza:** réplica, clones, instancia y job de Scheduler.
**En Mis Gastos:** `infra-gcp/cloudsql.tf`, `infra-gcp/scheduler.tf`, guía técnica **3.2.1 (comparación con SSMS)**.

---

## ACE-09 · Funciones y eventos: Cloud Run functions + Eventarc + Pub/Sub
**Objetivo:** cómputo orientado a eventos.
**Herramientas:** Cloud Run functions (2.ª gen.), Eventarc, Pub/Sub (topics, suscripciones push/pull, dead-letter), Cloud Storage triggers.

**Pasos**
1. Función que se dispara al **subir un CSV a un bucket** (Eventarc) y escribe en los logs cuántas filas tiene.
2. Topic de Pub/Sub `gastos-eventos` con una suscripción **pull** y otra **push** hacia una función.
3. Publica 10 mensajes con un atributo `op_type`. Crea una suscripción con **filtro** que solo reciba `DELETE`.
4. Haz que la función falle a propósito y configura un **dead-letter topic** con 5 intentos. Observa los mensajes en la DLQ.
5. Activa **ordering keys** (con el id del gasto como clave), igual que la clave de Kafka en la app.

**Criterio de éxito:** mensajes inválidos terminan en la DLQ; los válidos se procesan en orden por clave.

**Preguntas de cierre**
- ¿Push vs pull: cuándo usar cada una? ¿Qué autentica una suscripción push hacia Cloud Run (OIDC)?
- ¿Qué garantiza Pub/Sub por defecto (*at-least-once*) y qué cambia con *exactly-once delivery*?
- ¿Cloud Run functions vs Cloud Run service vs App Engine?

**Limpieza:** funciones, triggers, topics y suscripciones.
**En Mis Gastos:** `app/backend/fabric.py` (clave = id → orden), guía técnica 10 (outbox, *at-least-once*).

---

## ACE-10 · Operación: Monitoring, uptime checks, alertas, log sinks y Ops Agent
**Objetivo:** saber cuándo algo falla **antes** que los usuarios. Es la recomendación pendiente de la app.
**Herramientas:** Cloud Monitoring (uptime checks, alerting policies, dashboards), Cloud Logging (Logs Explorer, log-based metrics, sinks, buckets, retención), Error Reporting, Ops Agent.

**Pasos**
1. **Uptime check** contra `/api/health` de un servicio de laboratorio (o de la app, si tienes permisos), cada 5 minutos desde 3 regiones.
2. **Alerta** si el uptime check falla 2 veces seguidas → notificación por correo.
3. **Log-based metric** que cuente las líneas `Acceso denegado` o las respuestas 429 (cuota de IA). Haz un gráfico y una alerta si superan un umbral.
4. **Sink** de logs de Cloud Run a **BigQuery** y consulta los 5xx por hora con SQL. Compáralo con un sink a Cloud Storage (archivo barato).
5. Instala **Ops Agent** en una VM de ACE-04 y mira métricas de memoria y disco (que sin el agente no existen).
6. Crea un **dashboard** con latencia p95, requests por código de respuesta e instancias activas.
7. Configura la **retención** de un bucket de logs y lee la diferencia entre `_Default` y `_Required`.

**Criterio de éxito:** recibes el correo de alerta al apagar el servicio y lo ves resolverse al encenderlo.

**Preguntas de cierre**
- ¿Por qué la memoria de una VM no aparece sin Ops Agent?
- ¿Log sink vs log-based metric vs log bucket con *Log Analytics*?
- ¿Qué logs no se pueden excluir ni borrar?

**Limpieza:** uptime checks, políticas, sinks (y su dataset o bucket) y la VM.
**En Mis Gastos:** `app/backend/main.py` (logs `Acceso denegado`, 429), `.github/workflows/deploy.yml` (smoke test `/api/health`).
