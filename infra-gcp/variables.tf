variable "project_id" {
  description = "ID del proyecto de GCP."
  type        = string
}

variable "region" {
  description = "Región principal."
  type        = string
  default     = "us-central1"
}

variable "allowed_email" {
  description = "Correo del dueño/administrador (ALLOWED_EMAIL). Sus gastos previos al multiusuario se le asignan."
  type        = string
}

variable "allowed_emails" {
  description = "Invitados (amigos y familia) que pueden entrar. Se guarda en Secret Manager (ALLOWED_EMAILS), no en una variable de entorno visible."
  type        = list(string)
  default     = []
  sensitive   = true
}

variable "github_repo" {
  description = "Repositorio GitHub autorizado para desplegar, formato 'owner/repo'."
  type        = string
}

# --- Cloud SQL ---
variable "db_tier" {
  description = "Tier de la instancia Cloud SQL."
  type        = string
  default     = "db-f1-micro"
}

variable "db_name" {
  type    = string
  default = "finanzas_db"
}

variable "db_user" {
  type    = string
  default = "finanzas_app"
}

# --- FinOps scheduler ---
variable "schedule_timezone" {
  type    = string
  default = "America/Lima"
}

variable "sql_start_cron" {
  description = "Cron para encender Cloud SQL."
  type        = string
  default     = "0 6 * * *"
}

variable "sql_stop_cron" {
  description = "Cron para apagar Cloud SQL."
  type        = string
  default     = "0 23 * * *"
}

# --- IA (Gemini en Vertex AI) ---
variable "gemini_model" {
  type    = string
  default = "gemini-3-flash-preview"
}

variable "gemini_location" {
  type    = string
  default = "global"
}

# --- Secretos externos (opcionales en el primer apply; se guarda "PENDIENTE") ---
variable "fabric_entorno" {
  description = "Workspace de Fabric que recibe los eventos de producción (prd = finanzas-prd, test = test_wt)."
  type        = string
  default     = "prd"
  validation {
    condition     = contains(["prd", "test"], var.fabric_entorno)
    error_message = "fabric_entorno debe ser prd o test."
  }
}

variable "fabric_eventstream_connection_string" {
  description = "Cadena de conexión del Custom Endpoint de Fabric Eventstream (Event Hubs)."
  type        = string
  default     = ""
  sensitive   = true
}

variable "google_oauth_client_id" {
  type      = string
  default   = ""
  sensitive = true
}

variable "google_oauth_client_secret" {
  type      = string
  default   = ""
  sensitive = true
}

# --- Cloud Run ---
variable "bootstrap_image" {
  description = "Imagen placeholder para crear el servicio; el CI/CD despliega la real."
  type        = string
  default     = "us-docker.pkg.dev/cloudrun/container/hello"
}
