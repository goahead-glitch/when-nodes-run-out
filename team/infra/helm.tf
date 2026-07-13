resource "null_resource" "helm_repo_update" {
  triggers = {
    always_run = "${timestamp()}"
  }

  provisioner "local-exec" {
    command = <<EOT
      helm repo add aws-load-balancer-controller https://aws.github.io/eks-charts || true
      helm repo add prometheus-community https://prometheus-community.github.io/helm-charts || true
      helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx || true
      helm repo add grafana https://grafana.github.io/helm-charts || true
      helm repo add deliveryhero https://charts.deliveryhero.io/ || true
      helm repo add autoscaler https://kubernetes.github.io/autoscaler || true
      helm repo update
    EOT
  }
}

resource "helm_release" "ingress_nginx" {
  name       = "ingress-nginx"
  repository = "https://kubernetes.github.io/ingress-nginx"
  chart      = "ingress-nginx"
  namespace  = "ingress-nginx"
  version    = "4.15.1"

  values = [
    <<EOF
    controller:
      image:
        tag: "v1.11.3"
      service:
        type: LoadBalancer
        annotations:
          service.beta.kubernetes.io/aws-load-balancer-type: "nlb"
          service.beta.kubernetes.io/aws-load-balancer-scheme: "internet-facing"
          service.beta.kubernetes.io/aws-load-balancer-cross-zone-load-balancing-enabled: "true"
          service.beta.kubernetes.io/aws-load-balancer-nlb-target-type: "ip"

      nodeSelector:
        role: ops

      tolerations:
        - key: "role"
          operator: "Equal"
          value: "ops"
          effect: "NoSchedule"
    EOF
  ]

  depends_on = [aws_eks_addon.vpc_cni, kubernetes_namespace.ingress_nginx]
}




resource "helm_release" "monitoring_exporters" {
  name       = "monitoring-exporters"
  repository = "https://prometheus-community.github.io/helm-charts"
  chart      = "kube-prometheus-stack"
  namespace  = "ops"

  values = ["${file("${path.module}/values/values.yaml")}"]

  depends_on = [aws_eks_node_group.ops, aws_eks_addon.vpc_cni, kubernetes_namespace.ops]
  
}



resource "kubectl_manifest" "cadvisor" {
  yaml_body = file("${path.module}/values/cadvisor.yaml")

  depends_on = [kubernetes_namespace.ops, aws_eks_node_group.ops]
}


resource "helm_release" "promtail" {
  name       = "promtail"
  repository = "https://grafana.github.io/helm-charts"
  chart      = "promtail"
  namespace  = "kube-system"
  values     = [file("${path.module}/values/promtail.yaml")]

  depends_on = [kubernetes_namespace.ops, aws_eks_node_group.ops]
}





resource "helm_release" "event_exporter" {
  name       = "event-exporter"
  repository = "https://charts.deliveryhero.io"
  chart      = "k8s-event-logger"
  version    = "1.1.8"
  namespace  = "ops"

  force_update  = true
  recreate_pods = true

  values = [
    yamlencode({

      image = {
        repository = "maxrocketinternet/k8s-event-logger"
        pullPolicy = "IfNotPresent"
      }


      resources = {
        requests = {
          cpu    = "10m"
          memory = "128Mi"
        }

        limits = {
          cpu    = "100m"
          memory = "128Mi"
        }
      }


      nodeSelector = {
        role = "ops"
      }


      tolerations = [
        {
          key      = "role"
          operator = "Equal"
          value    = "ops"
          effect   = "NoSchedule"
        }
      ]


      podSecurityContext = {
        readOnlyRootFilesystem = true
        runAsNonRoot           = true
        runAsUser              = 10001
        runAsGroup             = 10001
        allowPrivilegeEscalation = false

        capabilities = {
          drop = [
            "ALL"
          ]
        }

        seccompProfile = {
          type = "RuntimeDefault"
        }
      }


      rbac = {
        create                 = true
        clusterRoleName        = "event-exporter"
        clusterRoleBindingName = "event-exporter"
      }


      serviceAccount = {
        create = true
        name   = "event-exporter"
      }

    })
  ]

  depends_on = [
    aws_eks_node_group.ops
  ]
}

resource "helm_release" "cluster_autoscaler" {
  name       = "cluster-autoscaler"
  repository = "https://kubernetes.github.io/autoscaler"
  chart      = "cluster-autoscaler"
  namespace  = "kube-system"

  set {
    name  = "cloudProvider"
    value = "aws"
  }

  set {
    name  = "autoDiscovery.clusterName"
    value = aws_eks_cluster.eks.name
  }

  set {
    name  = "awsRegion"
    value = "ap-northeast-2"
  }

  set {
    name  = "rbac.serviceAccount.create"
    value = "false"
  }

  set {
    name  = "rbac.serviceAccount.name"
    value = kubernetes_service_account.cluster_autoscaler.metadata[0].name
  }

  depends_on = [aws_eks_node_group.ops, kubernetes_service_account.cluster_autoscaler]
}