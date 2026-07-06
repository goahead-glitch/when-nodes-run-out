resource "aws_security_group" "k6_sg" {
  name   = "k6-sg"
  vpc_id = aws_vpc.main.id
  tags   = { Name = "app-k6-sg" }
}


resource "aws_security_group_rule" "egress_all_k6" {
  type                     = "egress"
  security_group_id        = aws_security_group.k6_sg.id
  from_port                = 0
  to_port                  = 0
  protocol                 = "-1"
  cidr_blocks              = ["0.0.0.0/0"]
}


resource "aws_security_group_rule" "ingress_ssh_k6" {
  type              = "ingress"
  security_group_id = aws_security_group.k6_sg.id
  from_port         = 22
  to_port           = 22
  protocol          = "tcp"
  cidr_blocks       = var.my_ips
}