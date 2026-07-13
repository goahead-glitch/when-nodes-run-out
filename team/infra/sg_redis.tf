resource "aws_security_group" "redis_sg" {
  name   = "redis-sg"
  vpc_id = aws_vpc.main.id
  tags   = { Name = "app-redis-sg" }
}

resource "aws_security_group_rule" "ingress_redis_from_worker" {
  type                     = "ingress"
  security_group_id        = aws_security_group.redis_sg.id
  from_port                = 6379
  to_port                  = 6379
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.eks_worker_sg.id
}

resource "aws_security_group_rule" "ingress_redis_monitoring" {
  type              = "ingress"
  security_group_id = aws_security_group.redis_sg.id
  from_port         = 9121
  to_port           = 9121
  protocol          = "tcp"
  cidr_blocks       = var.monitoring_server_cidr

  description = "redis_exporter"
}

resource "aws_security_group_rule" "redis_ingress_monitoring_os" {
  type              = "ingress"
  security_group_id = aws_security_group.redis_sg.id
  from_port         = 9100
  to_port           = 9100
  protocol          = "tcp"
  cidr_blocks       = var.monitoring_server_cidr

  description = "node_exporter"
}

resource "aws_security_group_rule" "ingress_redis_ssh" {
  type              = "ingress"
  security_group_id = aws_security_group.redis_sg.id
  from_port         = 22
  to_port           = 22
  protocol          = "tcp"
  cidr_blocks       = var.my_ips
}

resource "aws_security_group_rule" "egress_all_redis" {
  type              = "egress"
  security_group_id = aws_security_group.redis_sg.id
  from_port         = 0
  to_port           = 0
  protocol          = "-1"
  cidr_blocks       = ["0.0.0.0/0"]
}
