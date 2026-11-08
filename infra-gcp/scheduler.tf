# FinOps: enciende Cloud SQL a las 08:00 y lo apaga a las 22:00 (America/Lima)
resource "google_service_account" "sql_scheduler" {
  account_id   = "sql-scheduler"
  display_name = "Cloud Scheduler - encendido/apagado de Cloud SQL"
  depends_on   = [google_project_service.apis]
}

resource "google_project_iam_member" "sql_scheduler_editor" {
  project = var.project_id
  role    = "roles/cloudsql.editor" # incluye cloudsql.instances.update
  member  = "serviceAccount:${google_service_account.sql_scheduler.email}"

  # Proyecto compartido: el permiso solo aplica a la instancia de finanzas
  condition {
    title       = "solo-finanzas-pg"
    description = "Restringe el rol a la instancia finanzas-pg"
    expression  = local.sql_instance_condition
  }
}

locals {
  sql_instance_api = "https://sqladmin.googleapis.com/v1/projects/${var.project_id}/instances/${google_sql_database_instance.pg.name}"

  sql_jobs = {
    start = { cron = var.sql_start_cron, policy = "ALWAYS", desc = "Encender Cloud SQL" }
    stop  = { cron = var.sql_stop_cron, policy = "NEVER", desc = "Apagar Cloud SQL" }
  }
}

resource "google_cloud_scheduler_job" "sql" {
  for_each    = local.sql_jobs
  name        = "cloudsql-${each.key}"
  description = each.value.desc
  region      = var.region
  schedule    = each.value.cron
  time_zone   = var.schedule_timezone

  attempt_deadline = "60s"
  retry_config {
    retry_count = 3
  }

  http_target {
    http_method = "PATCH"
    uri         = local.sql_instance_api
    headers     = { "Content-Type" = "application/json" }
    body = base64encode(jsonencode({
      settings = { activationPolicy = each.value.policy }
    }))

    oauth_token {
      service_account_email = google_service_account.sql_scheduler.email
      scope                 = "https://www.googleapis.com/auth/cloud-platform"
    }
  }

  depends_on = [google_project_service.apis, google_project_iam_member.sql_scheduler_editor]
}
