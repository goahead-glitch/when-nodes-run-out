resource "aws_security_group" "rds_sg" {
  name   = "rds-sg"
  vpc_id = aws_vpc.main.id
  tags   = { Name = "app-rds-sg" }
}

resource "aws_security_group_rule" "ingress_postgres_from_worker" {
  type                     = "ingress"
  security_group_id        = aws_security_group.rds_sg.id
  from_port                = 5432
  to_port                  = 5432
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.eks_worker_sg.id
}

resource "aws_security_group_rule" "ingress_postgres_from_rds_sg" {
  type                     = "ingress"
  security_group_id        = aws_security_group.rds_sg.id
  from_port                = 5432
  to_port                  = 5432
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.rds_sg.id

  description = "db migration fargate task"
}

resource "aws_security_group_rule" "rds_egress_all" {
  type              = "egress"
  security_group_id = aws_security_group.rds_sg.id
  from_port         = 0
  to_port           = 0
  protocol          = "-1"
  cidr_blocks       = ["0.0.0.0/0"]
}


resource "aws_security_group_rule" "ingress_from_monitoring" {
  type              = "ingress"
  security_group_id = aws_security_group.rds_sg.id
  from_port         = 9187
  to_port           = 9187
  protocol          = "tcp"
  cidr_blocks       = var.monitoring_server_cidr

  description = "postgresql_exporter"

}

resource "aws_security_group_rule" "rds_ingress_monitoring_os" {
  type              = "ingress"
  security_group_id = aws_security_group.rds_sg.id
  from_port         = 9100
  to_port           = 9100
  protocol          = "tcp"
  cidr_blocks       = var.monitoring_server_cidr

  description = "node_exporter"

}


resource "aws_security_group_rule" "allow_terraform_to_rds" {
  type              = "ingress"
  from_port         = 5432
  to_port           = 5432
  protocol          = "tcp"
  security_group_id = aws_security_group.rds_sg.id
  cidr_blocks       = ["0.0.0.0/0"]
}
