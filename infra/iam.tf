resource "aws_iam_group" "infra_group" {
  name = "infra_group"
}

resource "aws_iam_group" "k8s_group" {
  name = "k8s_group"
}

resource "aws_iam_group" "cicd_group" {
  name = "cicd_group"
}


resource "aws_iam_group_policy" "infra_policy" {
  name   = "infra_group"
  group  = aws_iam_group.infra_group.name
  policy = file("${path.module}/infra_group.json")
  depends_on = [aws_iam_group.infra_group]
}

resource "aws_iam_group_policy" "k8s_policy" {
  name   = "k8s_group"
  group  = aws_iam_group.k8s_group.name
  policy = file("${path.module}/k8s_group.json")
  depends_on = [aws_iam_group.k8s_group]
}

resource "aws_iam_group_policy" "cicd_policy" {
  name   = "cicd_group"
  group  = aws_iam_group.cicd_group.name
  policy = file("${path.module}/cicd_group.json")
  depends_on = [aws_iam_group.cicd_group]
}


resource "aws_iam_user_group_membership" "infra_membership" {
  user = "infra"
  groups = [aws_iam_group.infra_group.name]
  depends_on = [aws_iam_group_policy.infra_policy]
}

resource "aws_iam_user_group_membership" "k8s_membership" {
  user = "k8s"
  groups = [aws_iam_group.k8s_group.name]
  depends_on = [aws_iam_group_policy.k8s_policy]
}

resource "aws_iam_user_group_membership" "cicd_membership" {
  user = "cicd"
  groups = [aws_iam_group.cicd_group.name]
  depends_on = [aws_iam_group_policy.cicd_policy]
}



########## EKS Cluster IAM ##########

resource "aws_iam_role" "cluster_role" {
  name = "app-eks-cluster-role"
  depends_on = [aws_iam_user_group_membership.infra_membership]

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Service = "eks.amazonaws.com"
      }
      Action = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "eks_cluster_policy" {
  role       = aws_iam_role.cluster_role.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKSClusterPolicy"
}






########## EKS Worker IAM ##########
resource "aws_iam_role" "worker_role" {
  name = "app-eks-worker-role"
  depends_on = [aws_iam_user_group_membership.infra_membership]

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = ["ec2.amazonaws.com", "eks.amazonaws.com"]
        }
        Action = "sts:AssumeRole"
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "worker_policy" {
  role       = aws_iam_role.worker_role.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKSWorkerNodePolicy"
}

resource "aws_iam_role_policy_attachment" "worker_cni" {
  role       = aws_iam_role.worker_role.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKS_CNI_Policy"
}

resource "aws_iam_role_policy_attachment" "worker_ecr" {
  role       = aws_iam_role.worker_role.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly"
}

resource "aws_iam_instance_profile" "worker_profile" {
  name = "app-eks-worker-profile"
  role = aws_iam_role.worker_role.name
}






########## RDS IAM ##########
resource "aws_iam_role" "db_migration_execution" {
  name = "app-db-migration-execution-role"
  depends_on = [aws_iam_user_group_membership.infra_membership]

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Service = "ecs-tasks.amazonaws.com"
      }
      Action = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "db_migration_execution" {
  role       = aws_iam_role.db_migration_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}







########## Karpenter IAM ##########
data "tls_certificate" "eks_oidc" {
  url = aws_eks_cluster.eks.identity[0].oidc[0].issuer
  depends_on = [aws_eks_cluster.eks]
}

resource "aws_iam_openid_connect_provider" "eks" {
  url             = aws_eks_cluster.eks.identity[0].oidc[0].issuer
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = [data.tls_certificate.eks_oidc.certificates[0].sha1_fingerprint]
}

locals {
  eks_oidc_provider = replace(aws_eks_cluster.eks.identity[0].oidc[0].issuer, "https://", "")
}






########## Load Ballancer IAM ##########
locals {
  aws_load_balancer_controller_version = "v3.4.0"
  eks_oidc_provider_url                = replace(aws_eks_cluster.eks.identity[0].oidc[0].issuer, "https://", "")
}

data "http" "load_balancer_controller_iam_policy" {
  url = "https://raw.githubusercontent.com/kubernetes-sigs/aws-load-balancer-controller/${local.aws_load_balancer_controller_version}/docs/install/iam_policy.json"
}

resource "aws_iam_policy" "load_balancer_controller" {
  name   = "AWSLoadBalancerControllerIAMPolicy"
  policy = data.http.load_balancer_controller_iam_policy.response_body
}

resource "aws_iam_role" "load_balancer_controller" {
  name = "AmazonEKSLoadBalancerControllerRole"
  depends_on = [aws_iam_user_group_membership.infra_membership]

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Federated = aws_iam_openid_connect_provider.eks.arn
        }
        Action = "sts:AssumeRoleWithWebIdentity"
        Condition = {
          StringEquals = {
            "${local.eks_oidc_provider_url}:aud" = "sts.amazonaws.com"
            "${local.eks_oidc_provider_url}:sub" = "system:serviceaccount:kube-system:load-balancer-controller"
          }
        }
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "load_balancer_controller" {
  role       = aws_iam_role.load_balancer_controller.name
  policy_arn = aws_iam_policy.load_balancer_controller.arn
}

resource "kubernetes_service_account_v1" "load_balancer_controller" {
  metadata {
    name      = "load-balancer-controller"
    namespace = "kube-system"

    annotations = {
      "eks.amazonaws.com/role-arn" = aws_iam_role.load_balancer_controller.arn
    }
  }

  depends_on = [
    aws_iam_role_policy_attachment.load_balancer_controller
  ]
}








########## Argo CD IAM ##########
resource "aws_iam_role" "argocd_role" {
  name = "argocd-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy" "argocd_policy" {
  name   = "argocd-policy"
  role   = aws_iam_role.argocd_role.id
  policy = file("${path.module}/cicd_group.json")
}

resource "aws_eks_access_entry" "argocd_entry" {
  cluster_name  = aws_eks_cluster.eks.name
  principal_arn = aws_iam_role.argocd_role.arn
}

resource "aws_eks_access_policy_association" "argocd_policy_assoc" {
  cluster_name  = aws_eks_cluster.eks.name
  policy_arn    = "arn:aws:eks::aws:cluster-access-policy/AmazonEKSClusterAdminPolicy"
  principal_arn = aws_iam_role.argocd_role.arn

  access_scope {
    type = "cluster"
  }
}








########## GitHub Actions IAM ##########
data "aws_region" "current" {}
data "aws_caller_identity" "current" {}

locals {
  ecr_repository_arns = [
    for name in var.ecr_repositories :
    "arn:aws:ecr:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:repository/${name}"
  ]
}

resource "aws_iam_openid_connect_provider" "github" {
  url = "https://token.actions.githubusercontent.com"

  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["1c5876686918614979d5e992b2d1b085d7348795"]
}

resource "aws_iam_role" "github_actions" {
  name = "app-github-actions-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Federated = aws_iam_openid_connect_provider.github.arn
        }
        Action = "sts:AssumeRoleWithWebIdentity"
        Condition = {
          StringEquals = { "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com" }
          StringLike   = { "token.actions.githubusercontent.com:sub" = "repo:ktk026/On_P_VS_AWS:*" }
        }
      }
    ]
  })
}

resource "aws_iam_policy" "github_actions_policy" {
  name = "app-github-actions-policy"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["ecr:GetAuthorizationToken"]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "ecr:BatchCheckLayerAvailability",
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchGetImage",
          "ecr:InitiateLayerUpload",
          "ecr:UploadLayerPart",
          "ecr:CompleteLayerUpload",
          "ecr:PutImage"
        ]
        Resource = local.ecr_repository_arns
      },
      {
        Effect   = "Allow"
        Action   = ["eks:DescribeCluster"]
        Resource = aws_eks_cluster.eks.arn
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "github_actions_attach" {
  role       = aws_iam_role.github_actions.name
  policy_arn = aws_iam_policy.github_actions_policy.arn
}
