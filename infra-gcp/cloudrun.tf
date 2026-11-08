resource "google_service_account" "run" {
  account_id   = "finanzas-run"
  display_name = "Cloud Run - finanzas-app"
  depends_on   = [google_project_service.apis]
}

resource "google_project_iam_member" "run_sql_client" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.run.email}"

  condition {
    title       = "solo-finanzas-pg"
    description = "Restringe el rol a la instancia finanzas-pg"
    expression  = local.sql_instance_condition
  }
}

resource "google_cloud_run_v2_service" "app" {
  name                = "finanzas-app"
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_ALL"
  deletion_protection = false

  template {
    service_account = google_service_account.run.email

    scaling {
      min_instance_count = 0
      max_instance_count = 2
    }

    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        instances = [google_sql_database_instance.pg.connection_name]
      }
    }

    containers {
      image = var.bootstrap_image

      ports {
        container_port = 8080
      }

      resources {
        limits   = { cpu = "1", memory = "512Mi" }
        cpu_idle = true
      }

      env {
        name  = "ALLOWED_EMAIL"
        value = var.allowed_email
      }
      env {
        name  = "APP_TIMEZONE"
        value = var.schedule_timezone
      }

      dynamic "env" {
        for_each = google_secret_manager_secret.app
        content {
          name = env.key
          value_source {
            secret_key_ref {
              secret  = env.value.secret_id
              version = "latest"
            }
          }
        }
      }

      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }
    }
  }

  lifecycle {
    # La imagen la despliega GitHub Actions
    ignore_changes = [
      template[0].containers[0].image,
      scaling, # el API devuelve ceros en el scaling a nivel servicio (drift sin efecto)
      client,
      client_version,
    ]
  }

  depends_on = [
    google_project_service.apis,
    google_secret_manager_secret_version.app,
    google_secret_manager_secret_iam_member.run_access,
    google_project_iam_member.run_sql_client,
  ]
}

# Acceso público: la autorización la hace la app con Google OAuth + ALLOWED_EMAIL
resource "google_cloud_run_v2_service_iam_member" "public" {
  name     = google_cloud_run_v2_service.app.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "allUsers"
}
