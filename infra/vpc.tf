data "aws_ami" "ubuntu_eks" {
  filter {
    name = "name"
    values = ["ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*"]
  }
  filter {
    name = "virtualization-type"
    values = ["hvm"]
  }
  most_recent = true
  owners = ["099720109477"]
}

resource "aws_vpc" "main" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = {
    Name = "app-vpc"
  }
}

resource "aws_internet_gateway" "igw" {
  vpc_id = aws_vpc.main.id

  tags = {
    Name = "app-igw"
  }
}

resource "aws_subnet" "public_2a" {
  vpc_id                  = aws_vpc.main.id
  availability_zone       = "ap-northeast-2a"
  cidr_block              = "10.0.1.0/24"
  map_public_ip_on_launch = true
  tags = {
    Name                     = "public-subnet-2a"
    "kubernetes.io/role/elb" = "1"
  }
}

resource "aws_subnet" "public_2c" {
  vpc_id                  = aws_vpc.main.id
  availability_zone       = "ap-northeast-2c"
  cidr_block              = "10.0.2.0/24"
  map_public_ip_on_launch = true
  tags = {
    Name                     = "public-subnet-2c"
    "kubernetes.io/role/elb" = "1"
  }
}
