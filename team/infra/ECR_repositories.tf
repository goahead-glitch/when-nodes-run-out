removed {
  from = aws_ecr_repository.services

  lifecycle {
    destroy = false
  }
}


resource "kubernetes_secret" "db_secret" {
  metadata {
    name      = "db-secret"
    namespace = "shoply"
  }

  data = {
    username = var.db_username
    password = var.db_password
  }

  depends_on = [aws_eks_cluster.eks]
  
}

# resource "aws_ecr_repository" "app-repo" {
#   for_each = toset(var.ecr_repositories)
#   name     = each.value

#   image_tag_mutability = "MUTABLE"

#   image_scanning_configuration {
#     scan_on_push = true
#   }
# }