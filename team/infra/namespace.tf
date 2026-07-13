resource "kubernetes_namespace" "shoply" {
  metadata {
    name = "shoply"
  }
}

resource "kubernetes_namespace" "ops" {
  metadata {
    name = "ops"
  }
}

resource "kubernetes_namespace" "ingress_nginx" {
  metadata {
    name = "ingress-nginx"
  }
}