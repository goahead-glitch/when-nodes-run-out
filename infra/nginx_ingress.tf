resource "kubernetes_service_v1" "nginx_service" {
  metadata {
    name      = "nginx-service"
    namespace = kubernetes_namespace.shoply.metadata[0].name
  }

  spec {
    selector = {
      app = "frontend"
    }

    type = "ClusterIP"

    port {
      port        = 80
      target_port = 80
    }
  }

  depends_on = [helm_release.ingress_nginx]
}


data "kubernetes_service" "ingress_nginx" {
  metadata {
    name      = "ingress-nginx-controller"
    namespace = "ingress-nginx"
  }

  depends_on = [helm_release.ingress_nginx]
}

locals {
  ingress_host = try(
    data.kubernetes_service.ingress_nginx.status[0].load_balancer[0].ingress[0].hostname,
    ""
  )

  base_url = local.ingress_host != "" ? "http://${local.ingress_host}" : ""
}