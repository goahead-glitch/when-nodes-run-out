resource "aws_security_group" "load_balancer_sg" {
    name   = "load-balancer-sg"
    vpc_id = aws_vpc.main.id

    tags = {
        Name = "app-load-balancer-sg"
    }
}

resource "aws_security_group_rule" "ingress_http" {
  type                     = "ingress"
  security_group_id        = aws_security_group.load_balancer_sg.id
  from_port                = 80
  to_port                  = 80
  protocol                 = "tcp"
  cidr_blocks              = ["0.0.0.0/0"]
}


resource "aws_security_group_rule" "load_balancer_egress_all" {
  type              = "egress"
  security_group_id = aws_security_group.load_balancer_sg.id
  from_port         = 0
  to_port           = 0
  protocol          = "-1"
  source_security_group_id = aws_security_group.eks_worker_sg.id
}