provider "aws" {
  region = "ap-northeast-2"

  default_tags {
    tags = {
      Project     = "app"
      ManagedBy   = "terraform"
      Environment = "dev"
    }
  }
}

provider "kubernetes" {
  host                   = aws_eks_cluster.eks.endpoint
  cluster_ca_certificate = base64decode(aws_eks_cluster.eks.certificate_authority[0].data)

  exec {
    api_version = "client.authentication.k8s.io/v1beta1"
    command     = "aws"
    args        = ["eks", "get-token", "--cluster-name", aws_eks_cluster.eks.name]
  }
}


provider "helm" {
  kubernetes {
    host                   = aws_eks_cluster.eks.endpoint
    cluster_ca_certificate = base64decode(aws_eks_cluster.eks.certificate_authority[0].data)

    exec {
      api_version = "client.authentication.k8s.io/v1beta1"
      command     = "aws"
      args        = ["eks", "get-token", "--cluster-name", aws_eks_cluster.eks.name]
    }
  }
}



provider "kubectl" {
  host                   = aws_eks_cluster.eks.endpoint
  cluster_ca_certificate = base64decode(
    aws_eks_cluster.eks.certificate_authority[0].data
  )
  load_config_file = false

  exec {
    api_version = "client.authentication.k8s.io/v1beta1"
    command     = "aws"
    args        = ["eks", "get-token", "--cluster-name", aws_eks_cluster.eks.name]
  }
}