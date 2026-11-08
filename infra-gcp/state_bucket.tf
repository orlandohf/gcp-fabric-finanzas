# Bucket del estado remoto de Terraform (backend "gcs").
# Bootstrap: se crea con estado local y luego se migra con `terraform init -migrate-state`.
resource "google_storage_bucket" "tfstate" {
  name     = "${var.project_id}-finanzas-tfstate"
  location = var.region

  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false

  versioning {
    enabled = true # permite recuperar un estado anterior si algo sale mal
  }

  # FinOps: conservar solo las últimas 10 versiones antiguas del estado
  lifecycle_rule {
    condition {
      num_newer_versions = 10
      with_state         = "ARCHIVED"
    }
    action {
      type = "Delete"
    }
  }

  labels = {
    app = "finanzas"
  }

  lifecycle {
    prevent_destroy = true
  }
}

output "tfstate_bucket" {
  value = google_storage_bucket.tfstate.name
}
