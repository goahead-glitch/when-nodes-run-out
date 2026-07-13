data "aws_iam_openid_connect_provider" "eks" {
  url = "https://oidc.eks.ap-northeast-2.amazonaws.com/id/A2CD0076A1E8D3CEC3ECD36B1B9FD146"
}

data "aws_iam_policy_document" "cluster_autoscaler" {
  statement {
    actions = [
      "autoscaling:Describe*",
      "autoscaling:SetDesiredCapacity",
      "autoscaling:TerminateInstanceInAutoScalingGroup",
      "ec2:DescribeLaunchTemplateVersions",
      "eks:DescribeNodegroup"
    ]

    resources = ["*"]
  }
}



locals {
  oidc_issuer = replace(aws_eks_cluster.eks.identity[0].oidc[0].issuer, "https://", "")
}
resource "aws_iam_role" "cluster_autoscaler" {
  name = "cluster-autoscaler"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Federated = data.aws_iam_openid_connect_provider.eks.arn
        }
        Action = "sts:AssumeRoleWithWebIdentity"
        Condition = {
          StringEquals = {
            "${local.oidc_issuer}:sub" = "system:serviceaccount:kube-system:cluster-autoscaler"
          }
        }
      }
    ]
  })
}
resource "aws_iam_role_policy" "cluster_autoscaler" {
  role   = aws_iam_role.cluster_autoscaler.id
  policy = data.aws_iam_policy_document.cluster_autoscaler.json
}

resource "kubernetes_service_account" "cluster_autoscaler" {
  metadata {
    name      = "cluster-autoscaler"
    namespace = "kube-system"

    annotations = {
      "eks.amazonaws.com/role-arn" = aws_iam_role.cluster_autoscaler.arn
    }
  }
}