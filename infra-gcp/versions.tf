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

  # Estado remoto (bucket creado por state_bucket.tf; versionado y privado)
  backend "gcs" {
    bucket = "mi-proyecto-gcp-finanzas-tfstate"
    prefix = "finanzas"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

data "google_project" "this" {}
