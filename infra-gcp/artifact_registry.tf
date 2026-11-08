resource "google_artifact_registry_repository" "docker" {
  location      = var.region
  repository_id = "finanzas"
  format        = "DOCKER"
  description   = "Imágenes de la app de finanzas"

  # FinOps: conservar solo las 5 imágenes más recientes
  cleanup_policy_dry_run = false
  cleanup_policies {
    id     = "keep-latest-5"
    action = "KEEP"
    most_recent_versions {
      keep_count = 5
    }
  }
  cleanup_policies {
    id     = "delete-old"
    action = "DELETE"
    condition {
      older_than = "604800s" # 7 días (solo aplica a lo que no cubre KEEP)
    }
  }

  depends_on = [google_project_service.apis]
}

locals {
  image_base = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.docker.repository_id}/finanzas-app"
}
