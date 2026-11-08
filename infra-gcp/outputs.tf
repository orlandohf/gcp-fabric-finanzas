output "cloud_run_url" {
  value = google_cloud_run_v2_service.app.uri
}

output "oauth_redirect_uri" {
  description = "Registrar este URI en el cliente OAuth de Google."
  value       = "${google_cloud_run_v2_service.app.uri}/auth/callback"
}

output "sql_connection_name" {
  value = google_sql_database_instance.pg.connection_name
}

output "image_base" {
  value = local.image_base
}

# --- Para las variables del repo en GitHub ---
output "wif_provider" {
  value = google_iam_workload_identity_pool_provider.github.name
}

output "deployer_sa" {
  value = google_service_account.deployer.email
}
