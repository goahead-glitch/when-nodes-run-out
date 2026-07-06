locals {
  eks_node_user_data = <<-EOT
    #!/bin/bash
    set -euxo pipefail
    /etc/eks/bootstrap.sh "${aws_eks_cluster.eks.name}" \
      --b64-cluster-ca "${aws_eks_cluster.eks.certificate_authority[0].data}" \
      --apiserver-endpoint "${aws_eks_cluster.eks.endpoint}"
  EOT

  eks_ops_user_data = <<-EOT
    #!/bin/bash
    set -euxo pipefail

    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install -y curl prometheus-node-exporter

    cat >/etc/default/prometheus-node-exporter <<'EOF'
    ARGS="--web.listen-address=:9106"
    EOF
    systemctl enable prometheus-node-exporter
    systemctl restart prometheus-node-exporter

    /etc/eks/bootstrap.sh "${aws_eks_cluster.eks.name}" \
      --b64-cluster-ca "${aws_eks_cluster.eks.certificate_authority[0].data}" \
      --apiserver-endpoint "${aws_eks_cluster.eks.endpoint}"
  EOT
}

resource "aws_launch_template" "eks_api_nodes_template" {
  name_prefix   = "eks-api-node-"
  image_id      = data.aws_ssm_parameter.eks_ubuntu_ami.value
  instance_type = "c8i-flex.large"
  key_name      = var.key_name

  vpc_security_group_ids = [
    aws_eks_cluster.eks.vpc_config[0].cluster_security_group_id,
    aws_security_group.eks_worker_sg.id
  ]

  user_data = base64encode(local.eks_node_user_data)

  tag_specifications {
    resource_type = "instance"
    tags          = { Name = "eks-api-node-instance" }
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_launch_template" "eks_service_nodes_template" {
  name_prefix   = "eks-service-node-"
  image_id      = data.aws_ssm_parameter.eks_ubuntu_ami.value
  instance_type = "c8i-flex.large"
  key_name      = var.key_name

  vpc_security_group_ids = [
    aws_eks_cluster.eks.vpc_config[0].cluster_security_group_id,
    aws_security_group.eks_worker_sg.id
  ]

  user_data = base64encode(local.eks_node_user_data)

  tag_specifications {
    resource_type = "instance"
    tags          = { Name = "eks-service-node-instance" }
  }

  lifecycle {
    create_before_destroy = true
  }
}


resource "aws_launch_template" "eks_ops_nodes_template" {
  name_prefix   = "eks-ops-node-"
  image_id      = data.aws_ssm_parameter.eks_ubuntu_ami.value
  instance_type = "t3.medium"
  key_name      = var.key_name

  vpc_security_group_ids = [
    aws_eks_cluster.eks.vpc_config[0].cluster_security_group_id,
    aws_security_group.eks_worker_sg.id
  ]

  user_data = base64encode(local.eks_ops_user_data)

  tag_specifications {
    resource_type = "instance"
    tags          = { Name = "eks-ops-node-instance", Role = "ops" }
  }

  lifecycle {
    create_before_destroy = true
  }
}