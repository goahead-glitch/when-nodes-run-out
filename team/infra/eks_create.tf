resource "aws_eks_cluster" "eks" {
  name                          = var.cluster_name
  role_arn                      = aws_iam_role.cluster_role.arn
  version                       = var.k8s_version
  bootstrap_self_managed_addons = false

  vpc_config {
    subnet_ids = [
      aws_subnet.public_2a.id,
      aws_subnet.public_2c.id
    ]
    
    public_access_cidrs           = var.eks_allow_ips
    endpoint_public_access        = true
  }

  access_config {
    authentication_mode                         = "API"
    bootstrap_cluster_creator_admin_permissions = true
  }

  depends_on = [aws_iam_role_policy_attachment.eks_cluster_policy]
}



resource "aws_eks_node_group" "api_node_group" {
  cluster_name    = aws_eks_cluster.eks.name
  node_group_name = "api-node-group"
  node_role_arn   = aws_iam_role.worker_role.arn
  subnet_ids      = [aws_subnet.public_2a.id]

  capacity_type = "ON_DEMAND"

  scaling_config {
    desired_size = 1
    max_size     = 10
    min_size     = 1
  }

  labels = {
    role = "api"
  }

  tags = {
    "k8s.io/cluster-autoscaler/enabled"   = "true"
    "k8s.io/cluster-autoscaler/app-eks"   = "owned"
    "kubernetes.io/cluster/app-eks"       = "owned"
  }

  launch_template {
    id      = aws_launch_template.eks_api_nodes_template.id
    version = aws_launch_template.eks_api_nodes_template.latest_version
  }

  depends_on = [
    aws_iam_role_policy_attachment.worker_policy,
    aws_iam_role_policy_attachment.worker_cni,
    aws_iam_role_policy_attachment.worker_ecr
  ]
}



resource "aws_eks_node_group" "service_node_group" {
  cluster_name    = aws_eks_cluster.eks.name
  node_group_name = "service-node-group"
  node_role_arn   = aws_iam_role.worker_role.arn
  subnet_ids      = [aws_subnet.public_2a.id]

  scaling_config {
    desired_size = 1
    max_size     = 10
    min_size     = 1
  }

  capacity_type = "ON_DEMAND"

  labels = {
    role = "service"
  }

  tags = {
    "k8s.io/cluster-autoscaler/enabled"   = "true"
    "k8s.io/cluster-autoscaler/app-eks"   = "owned"
    "kubernetes.io/cluster/app-eks"       = "owned"
  }

  launch_template {
    id      = aws_launch_template.eks_service_nodes_template.id
    version = aws_launch_template.eks_service_nodes_template.latest_version
  }

  depends_on = [
    aws_iam_role_policy_attachment.worker_policy,
    aws_iam_role_policy_attachment.worker_cni,
    aws_iam_role_policy_attachment.worker_ecr
  ]
}




resource "aws_eks_node_group" "ops" {
  cluster_name    = aws_eks_cluster.eks.name
  node_group_name = "ops-node-group"
  node_role_arn   = aws_iam_role.worker_role.arn
  subnet_ids = [aws_subnet.public_2a.id]

  scaling_config {
    desired_size = 1
    max_size     = 1
    min_size     = 1
  }

  labels = {
    role = "ops"
  }
  
  taint {
    key    = "role"
    value  = "ops"
    effect = "NO_SCHEDULE"
  }

  launch_template {
    id      = aws_launch_template.eks_ops_nodes_template.id
    version = aws_launch_template.eks_ops_nodes_template.latest_version
  }

  depends_on = [aws_eks_cluster.eks, aws_iam_role_policy_attachment.worker_policy, aws_iam_role_policy_attachment.worker_cni, aws_iam_role_policy_attachment.worker_ecr]

}




resource "aws_eks_access_entry" "k8s_user" {
  cluster_name  = aws_eks_cluster.eks.name
  principal_arn = "arn:aws:iam::090960193690:user/k8s"
  type          = "STANDARD"
}

resource "aws_eks_access_policy_association" "k8s_admin_binding" {
  cluster_name  = aws_eks_cluster.eks.name
  policy_arn    = "arn:aws:eks::aws:cluster-access-policy/AmazonEKSClusterAdminPolicy"
  principal_arn = "arn:aws:iam::090960193690:user/k8s"

  access_scope {
    type = "cluster"
  }

  depends_on = [aws_eks_access_entry.k8s_user]
}

resource "aws_eks_access_entry" "cicd_user" {
  cluster_name  = aws_eks_cluster.eks.name
  principal_arn = "arn:aws:iam::090960193690:user/cicd"
  type          = "STANDARD"
}

resource "aws_eks_access_policy_association" "cicd_shoply_binding" {
  cluster_name  = aws_eks_cluster.eks.name
  policy_arn    = "arn:aws:eks::aws:cluster-access-policy/AmazonEKSClusterAdminPolicy"
  principal_arn = aws_eks_access_entry.cicd_user.principal_arn

  access_scope {
    type       = "cluster"
  }

  depends_on = [aws_eks_access_entry.cicd_user, kubernetes_namespace.shoply]
}



resource "terraform_data" "update_kubeconfig" {
  input = {
    cluster_name = aws_eks_cluster.eks.name
    region       = "ap-northeast-2"
  }

  provisioner "local-exec" {
    command = "aws eks update-kubeconfig --region ${self.input.region} --name ${self.input.cluster_name}"
  }

  depends_on = [aws_eks_cluster.eks]
}
