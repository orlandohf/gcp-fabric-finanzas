terraform {
  required_version = ">= 1.6"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # Estado local por ahora. Para migrar a GCS más adelante:
  # backend "gcs" {
  #   bucket = "<bucket-tfstate>"
  #   prefix = "finanzas"
  # }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

data "google_project" "this" {}
