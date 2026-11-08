"""Diagramas de arquitectura como código (https://diagrams.mingrammer.com).

Genera en este directorio:
  - arquitectura.png        Vista completa: cliente, Google Cloud, Microsoft Fabric y CI/CD
  - flujo-datos-cdc.png     Outbox → Kafka → Medallion (Bronze/Silver/Gold) y entornos TEST/PRD

Uso:  pip install diagrams  (requiere Graphviz)  →  python generar.py
En el repo lo ejecuta .github/workflows/diagramas.yml y commitea los PNG.
"""
import importlib

from diagrams import Cluster, Diagram, Edge
from diagrams.generic.blank import Blank

# ---------- Estilo ----------
DATOS, CICD, SEGURIDAD, FINOPS, IA = "#0F766E", "#7C3AED", "#64748B", "#D97706", "#DB2777"

GRAFO = {
    "fontsize": "26", "fontname": "Helvetica-Bold", "fontcolor": "#0F172A",
    "pad": "0.7", "nodesep": "0.75", "ranksep": "1.3", "splines": "spline",
    "bgcolor": "white", "labelloc": "t", "compound": "true", "newrank": "true",
}
NODO = {"fontsize": "12", "fontname": "Helvetica", "fontcolor": "#0F172A"}
ARISTA = {"fontsize": "11", "fontname": "Helvetica", "penwidth": "1.6"}


def caja(color: str, fondo: str) -> dict:
    return {"bgcolor": fondo, "pencolor": color, "fontcolor": color, "fontname": "Helvetica-Bold",
            "fontsize": "15", "style": "rounded,bold", "margin": "22", "penwidth": "1.6"}


C_USUARIO = caja("#334155", "#F8FAFC")
C_GCP = caja("#1A73E8", "#F2F7FE")
C_GCP_SUB = caja("#5F8FD8", "#FFFFFF")
C_FABRIC = caja("#0F766E", "#EFFAF7")
C_FABRIC_SUB = caja("#2A9D8F", "#FFFFFF")
C_GITHUB = caja("#6D28D9", "#F6F2FE")
C_DEV = caja("#B45309", "#FFF8EC")


def nodo(etiqueta: str, *candidatos: tuple):
    """Primer ícono disponible de la lista (los nombres cambian entre versiones de diagrams)."""
    for modulo, *clases in candidatos:
        try:
            mod = importlib.import_module(f"diagrams.{modulo}")
        except ImportError:
            continue
        for clase in clases:
            if hasattr(mod, clase):
                return getattr(mod, clase)(etiqueta, **NODO)
    return Blank(etiqueta, **NODO)


def flecha(color: str, etiqueta: str = "", estilo: str = "solid", **extra) -> Edge:
    return Edge(label=etiqueta, color=color, fontcolor=color, style=estilo, **ARISTA, **extra)


# =====================================================================
# 1. Arquitectura completa
# =====================================================================
with Diagram("Mis Gastos — arquitectura", filename="arquitectura", outformat="png", show=False,
             direction="LR", graph_attr=GRAFO):

    with Cluster("Usuario", graph_attr=C_USUARIO):
        movil = nodo("Celular\nPWA instalable", ("generic.device", "Mobile"))
        cola = nodo("IndexedDB\ncola offline", ("generic.storage", "Storage"), ("onprem.database", "Postgresql"))

    with Cluster("Desarrollador", graph_attr=C_DEV):
        terraform = nodo("Terraform\nplan → apply\n(infra GCP)", ("onprem.iac", "Terraform"))

    with Cluster("GitHub", graph_attr=C_GITHUB):
        repo = nodo("Repositorio\nrama → PR → main", ("onprem.vcs", "Github"))
        actions = nodo("GitHub Actions\npytest + Postgres 16\nbuild · deploy", ("onprem.ci", "GithubActions"))

    with Cluster("Google Cloud · us-central1", graph_attr=C_GCP):
        with Cluster("Cómputo serverless", graph_attr=C_GCP_SUB):
            run = nodo("Cloud Run\nFastAPI + React\nescala 0–2", ("gcp.compute", "Run"))
        with Cluster("Datos (OLTP)", graph_attr=C_GCP_SUB):
            sql = nodo("Cloud SQL · PostgreSQL 16\ngastos + eventos_fabric\n(outbox)", ("gcp.database", "SQL"))
        with Cluster("IA generativa", graph_attr=C_GCP_SUB):
            gemini = nodo("Vertex AI · Gemini\nescaneo + consejos", ("gcp.ml", "VertexAI", "AIPlatform"))
        with Cluster("Identidad y secretos", graph_attr=C_GCP_SUB):
            secretos = nodo("Secret Manager\n5 secretos", ("gcp.security", "SecretManager", "KeyManagementService", "KMS"))
            wif = nodo("IAM\nWorkload Identity\nFederation", ("gcp.security", "Iam"))
        with Cluster("Operación y FinOps", graph_attr=C_GCP_SUB):
            registry = nodo("Artifact Registry\nimágenes Docker", ("gcp.devtools", "ArtifactRegistry", "GCR", "ContainerRegistry"))
            scheduler = nodo("Cloud Scheduler\n06:00 ON · 23:00 OFF", ("gcp.devtools", "Scheduler"))
            estado = nodo("Cloud Storage\nestado Terraform", ("gcp.storage", "GCS"))

    with Cluster("Microsoft Fabric · workspace PRD", graph_attr=C_FABRIC):
        eventstream = nodo("Eventstream\nCustom Endpoint\n(protocolo Kafka)", ("azure.analytics", "EventHubs"))
        with Cluster("Eventhouse · KQL Database", graph_attr=C_FABRIC_SUB):
            bronze = nodo("Bronze\nraw_gastos", ("azure.analytics", "DataExplorerClusters", "AzureDataExplorerClusters"))
            silver = nodo("Silver\ngastos_silver", ("azure.analytics", "DataExplorerClusters", "AzureDataExplorerClusters"))
            gold = nodo("Gold\nvista materializada", ("azure.analytics", "DataExplorerClusters", "AzureDataExplorerClusters"))
        onelake = nodo("OneLake\nDelta Parquet", ("azure.storage", "DataLakeStorage", "StorageAccounts"))
        powerbi = nodo("Power BI\nDirect Lake", ("azure.analytics", "PowerBiEmbedded"), ("saas.analytics", "Powerbi"),
                       ("onprem.analytics", "Powerbi"))

    # Flujo de datos (teal)
    movil >> flecha(DATOS, "HTTPS · login Google") >> run
    movil >> flecha(DATOS, "sin red / BD apagada", "dashed") >> cola
    run >> flecha(DATOS, "socket /cloudsql\nIAM + TLS") >> sql
    run >> flecha(DATOS, "outbox → Kafka\nSASL_SSL :9093", "bold") >> eventstream
    eventstream >> flecha(DATOS, "streaming") >> bronze
    bronze >> flecha(DATOS, "update policy") >> silver
    silver >> flecha(DATOS, "arg_max por id") >> gold
    silver >> flecha(DATOS, "OneLake availability", "dashed") >> onelake
    onelake >> flecha(DATOS) >> powerbi

    # Orden de lectura: Fabric siempre a la derecha de Google Cloud (aristas invisibles solo para el layout)
    sql >> Edge(style="invis") >> eventstream
    gemini >> Edge(style="invis") >> eventstream

    # IA (rosa)
    run >> flecha(IA, "ADC · JSON con esquema") >> gemini

    # Seguridad (gris)
    secretos >> flecha(SEGURIDAD, "variables de entorno", "dashed") >> run
    terraform >> flecha(SEGURIDAD, "tfstate", "dashed") >> estado

    # FinOps (ámbar)
    scheduler >> flecha(FINOPS, "PATCH activationPolicy\n(token OAuth)") >> sql

    # CI/CD (violeta)
    repo >> flecha(CICD, "push / PR") >> actions
    actions >> flecha(CICD, "OIDC → STS\n(sin llaves)", "dashed") >> wif
    actions >> flecha(CICD, "docker push") >> registry
    actions >> flecha(CICD, "gcloud run deploy\n+ smoke test") >> run


# =====================================================================
# 2. Flujo de datos CDC (Transactional Outbox) y entornos de Fabric
# =====================================================================
with Diagram("Mis Gastos — flujo de datos CDC y entornos de Fabric", filename="flujo-datos-cdc", outformat="png",
             show=False, direction="LR", graph_attr={**GRAFO, "ranksep": "1.1"}):

    api = nodo("FastAPI\nPOST · PUT · DELETE\n/api/gastos", ("programming.framework", "Fastapi", "FastAPI"),
               ("gcp.compute", "Run"))

    with Cluster("PostgreSQL · una sola transacción", graph_attr=C_GCP):
        tabla_gastos = nodo("gastos\nversion · actualizado_en", ("onprem.database", "Postgresql"), ("gcp.database", "SQL"))
        tabla_outbox = nodo("eventos_fabric (outbox)\nop_type · version · payload", ("onprem.database", "Postgresql"),
                            ("gcp.database", "SQL"))

    publisher = nodo("Publisher\nFOR UPDATE SKIP LOCKED\nauto-retry", ("programming.language", "Python"))
    kafka = nodo("Protocolo Kafka\nclave = id del gasto\nat-least-once", ("onprem.queue", "Kafka"))

    with Cluster("Fabric · PRD (finanzas-prd)", graph_attr=C_FABRIC):
        es_prd = nodo("Eventstream PRD", ("azure.analytics", "EventHubs"))
        with Cluster("Eventhouse PRD · Medallion", graph_attr=C_FABRIC_SUB):
            b_prd = nodo("BRONZE · raw_gastos\nappend-only · fechas string\n+ columnas de sistema",
                         ("azure.analytics", "DataExplorerClusters", "AzureDataExplorerClusters"))
            s_prd = nodo("SILVER · gastos_silver\ntipado · v1→v2 · monto real\n(update policy transaccional)",
                         ("azure.analytics", "DataExplorerClusters", "AzureDataExplorerClusters"))
            g_prd = nodo("GOLD · gastos_ultima_version\narg_max(version_timestamp) by id\nsin DELETE · USD→PEN",
                         ("azure.analytics", "DataExplorerClusters", "AzureDataExplorerClusters"))
        bi = nodo("OneLake → Power BI\nDirect Lake", ("azure.storage", "DataLakeStorage", "StorageAccounts"))

    with Cluster("Fabric · TEST (test_wt)", graph_attr=C_FABRIC_SUB):
        es_test = nodo("Eventstream TEST\neventos de prueba", ("azure.analytics", "EventHubs"))
        eh_test = nodo("Eventhouse TEST\nBronze → Silver → Gold",
                       ("azure.analytics", "DataExplorerClusters", "AzureDataExplorerClusters"))

    with Cluster("Despliegue (sin service principal)", graph_attr=C_DEV):
        kql = nodo("desplegar_kql.ps1\n01_bronze · 02_silver · 03_gold", ("programming.language", "Powershell", "Bash"),
                   ("onprem.client", "User"))
        pipeline = nodo("Deployment pipeline\nimplementación selectiva", ("azure.devops", "Pipelines"),
                        ("onprem.ci", "Jenkins"))

    api >> flecha(DATOS, "1 · INSERT / UPDATE / DELETE") >> tabla_gastos
    api >> flecha(DATOS, "2 · evento en la\nmisma transacción") >> tabla_outbox
    tabla_outbox >> flecha(DATOS, "3 · pendientes\n(enviado_en IS NULL)") >> publisher
    publisher >> flecha(DATOS, "4 · produce + flush\n(acks = all)", "bold") >> kafka
    kafka >> flecha(DATOS, "FABRIC_ENTORNO = prd", "bold") >> es_prd
    es_prd >> flecha(DATOS, "streaming") >> b_prd
    b_prd >> flecha(DATOS, "update policy") >> s_prd
    s_prd >> flecha(DATOS, "vista materializada") >> g_prd
    g_prd >> flecha(DATOS, "consumo") >> bi

    es_test >> flecha(DATOS, "streaming") >> eh_test

    kql >> flecha(CICD, "1 · TEST", "dashed") >> eh_test
    kql >> flecha(CICD, "2 · PRD (confirmación)", "dashed") >> b_prd
    eh_test >> flecha(CICD, "promover", "dotted") >> pipeline
    pipeline >> flecha(CICD, "solo Eventhouse", "dotted") >> s_prd
