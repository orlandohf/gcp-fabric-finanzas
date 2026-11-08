resource "google_sql_database_instance" "pg" {
  name             = "finanzas-pg"
  region           = var.region
  database_version = "POSTGRES_16"

  deletion_protection = true

  settings {
    tier              = var.db_tier
    edition           = "ENTERPRISE" # db-f1-micro solo existe en ENTERPRISE
    availability_type = "ZONAL"
    disk_type         = "PD_HDD"
    disk_size         = 10
    disk_autoresize   = false
    activation_policy = "ALWAYS"

    ip_configuration {
      ipv4_enabled = true # sin authorized_networks: solo acceso vía Cloud SQL Auth Proxy
      ssl_mode     = "ENCRYPTED_ONLY"
    }

    backup_configuration {
      enabled                        = true
      start_time                     = "18:00" # UTC = 13:00 Lima (dentro del horario encendido)
      point_in_time_recovery_enabled = false
      backup_retention_settings {
        retained_backups = 7
      }
    }

    maintenance_window {
      day  = 7  # domingo
      hour = 14 # UTC = 09:00 Lima (instancia encendida)
    }

    insights_config {
      query_insights_enabled = false
    }
  }

  lifecycle {
    # Cloud Scheduler enciende/apaga la instancia; Terraform no debe revertirlo.
    ignore_changes = [settings[0].activation_policy]
  }

  depends_on = [google_project_service.apis]
}

locals {
  # Condición IAM para acotar roles de Cloud SQL a esta instancia (el proyecto es compartido)
  sql_instance_condition = join(" && ", [
    "resource.type == \"sqladmin.googleapis.com/Instance\"",
    "resource.name == \"projects/${var.project_id}/instances/finanzas-pg\"",
  ])
}

resource "google_sql_database" "finanzas" {
  name     = var.db_name
  instance = google_sql_database_instance.pg.name
}

resource "random_password" "db" {
  length  = 32
  special = false # evita problemas de escape en la URL de conexión
}

resource "google_sql_user" "app" {
  name     = var.db_user
  instance = google_sql_database_instance.pg.name
  password = random_password.db.result
}
