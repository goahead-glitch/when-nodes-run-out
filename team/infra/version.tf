terraform {
  required_version = ">= 1.7.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }

    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 3.0"
    }

    helm = {
      source  = "hashicorp/helm"
      version = "~> 2.13"
    }

    http = {
      source  = "hashicorp/http"
      version = "~> 3.4"
    }

    tls = {
      source  = "hashicorp/tls"
      version = "~> 4.0"
    }

    kubectl = {
      source  = "gavinbunney/kubectl"
      version = "~> 1.14"
    }
  }
}


data "aws_ssm_parameter" "instance_ubuntu_ami" {
  name = "/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id"
}

data "aws_ssm_parameter" "eks_ubuntu_ami" {
  name = "/aws/service/canonical/ubuntu/eks/24.04/${var.k8s_version}/stable/current/amd64/hvm/ebs-gp3/ami-id"
}

resource "aws_ssm_parameter" "base_url" {
  name  = "/shoply/base_url"
  type  = "String"

  value = try(
    "http://${data.kubernetes_service.ingress_nginx.status[0].load_balancer[0].ingress[0].hostname}",
    "http://pending"
  )
}