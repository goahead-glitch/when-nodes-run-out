variable "cluster_name" {
  default = "app-eks"
}

variable "db_username" {
  default = "postgres"
}

variable "db_password" {
  sensitive = true
  default   = "postgres"
}

variable "k8s_version" {
  default = "1.34"
}

variable "key_name" {
  default = "key"
}


variable "eks_allow_ips" {
  type    = list(string)
  default = ["3.38.190.237/32", "106.248.40.229/32", "0.0.0.0/0"]
}


variable "monitoring_server_cidr" {
  type    = list(string)
  default = ["121.134.211.97/32"]
}

variable "monitoring_server_ip" {
  type    = string
  default = "3.38.106.213"
}

variable "my_ips" {
  type    = list(string)
  default = ["121.134.211.97/32"]
}



variable "ecr_repositories" {
  type = list(string)
  default = [
    "app-frontend",
    "app-api",
    "app-product",
    "app-inventory",
    "app-order",
    "app-payment",
    "app-user"
  ]
}