resource "aws_security_group" "eks_worker_sg" {
  name   = "eks-worker-sg"
  vpc_id = aws_vpc.main.id

  tags = {
    Name                     = "app-eks-worker-sg"
  }
}


resource "aws_security_group_rule" "ingress_worker_to_worker" {
  type              = "ingress"
  security_group_id = aws_security_group.eks_worker_sg.id
  from_port         = 0
  to_port           = 0
  protocol          = "-1"
  self              = true
}

resource "aws_security_group_rule" "ingress_kubelet" {
  type              = "ingress"
  security_group_id = aws_security_group.eks_worker_sg.id
  from_port         = 10250
  to_port           = 10250
  protocol          = "tcp"
  self              = true
}

resource "aws_security_group_rule" "ingress_worker_to_cluster" {
  type                     = "ingress"
  security_group_id        = aws_eks_cluster.eks.vpc_config[0].cluster_security_group_id
  from_port                = 443
  to_port                  = 443
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.eks_worker_sg.id
}

resource "aws_security_group_rule" "worker_ingress_ssh" {
  type              = "ingress"
  security_group_id = aws_security_group.eks_worker_sg.id
  from_port         = 22
  to_port           = 22
  protocol          = "tcp"
  cidr_blocks       = var.my_ips
}




resource "aws_security_group_rule" "ingress_public_to_worker" {
  type              = "ingress"
  security_group_id = aws_security_group.eks_worker_sg.id
  from_port         = 30000
  to_port           = 32767
  protocol          = "tcp"
  cidr_blocks       = ["0.0.0.0/0"]
}







resource "aws_security_group_rule" "ingress_monitoring_api" {
  type              = "ingress"
  security_group_id = aws_security_group.eks_worker_sg.id
  from_port         = 8080
  to_port           = 8080
  protocol          = "tcp"
  cidr_blocks       = var.monitoring_server_cidr
}
resource "aws_security_group_rule" "ingress_monitoring_services" {
  type              = "ingress"
  security_group_id = aws_security_group.eks_worker_sg.id
  from_port         = 4001
  to_port           = 4005
  protocol          = "tcp"
  cidr_blocks       = var.monitoring_server_cidr
}
resource "aws_security_group_rule" "ingress_k6" {
  type                     = "ingress"
  security_group_id        = aws_security_group.eks_worker_sg.id
  from_port                = 80
  to_port                  = 80
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.k6_sg.id
}

resource "aws_security_group_rule" "ingress_monitoring" {
  type              = "ingress"
  security_group_id = aws_security_group.eks_worker_sg.id
  from_port         = 9106
  to_port           = 9106
  protocol          = "tcp"
  cidr_blocks       = var.monitoring_server_cidr
}



resource "aws_security_group_rule" "cadivisor_ingress"{
  type              = "ingress"
  security_group_id = aws_security_group.eks_worker_sg.id
  from_port         = 38080
  to_port           = 38081
  protocol          = "tcp"
  cidr_blocks       = var.monitoring_server_cidr
}







resource "aws_security_group_rule" "egress_all_worker_nodes" {
  type              = "egress"
  security_group_id = aws_security_group.eks_worker_sg.id
  from_port         = 0
  to_port           = 0
  protocol          = "-1"
  cidr_blocks       = ["0.0.0.0/0"]
}
