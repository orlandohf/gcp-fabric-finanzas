resource "random_password" "session" {
  length  = 48
  special = false
}

locals {
  database_url = "postgresql://${var.db_user}:${random_password.db.result}@/${var.db_name}?host=/cloudsql/${google_sql_database_instance.pg.connection_name}"

  # Secretos que consume Cloud Run. Los externos usan "PENDIENTE" hasta tener el valor real.
  secrets = {
    DATABASE_URL                         = local.database_url
    SESSION_SECRET                       = random_password.session.result
    FABRIC_EVENTSTREAM_CONNECTION_STRING = coalesce(var.fabric_eventstream_connection_string, "PENDIENTE")
    GOOGLE_OAUTH_CLIENT_ID               = coalesce(var.google_oauth_client_id, "PENDIENTE")
    GOOGLE_OAUTH_CLIENT_SECRET           = coalesce(var.google_oauth_client_secret, "PENDIENTE")
  }
}

resource "google_secret_manager_secret" "app" {
  for_each  = nonsensitive(toset(keys(local.secrets)))
  secret_id = lower(replace(each.key, "_", "-"))

  replication {
    auto {}
  }

  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_version" "app" {
  for_each    = google_secret_manager_secret.app
  secret      = each.value.id
  secret_data = local.secrets[each.key]
}

resource "google_secret_manager_secret_iam_member" "run_access" {
  for_each  = google_secret_manager_secret.app
  secret_id = each.value.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.run.email}"
}
