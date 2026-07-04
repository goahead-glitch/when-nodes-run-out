#!/bin/bash
# ============================================================
# 호스트 EC2 네트워크 설정 — k8s 트래픽/메트릭 포워딩 한 방에
#   ip_forward + DNAT(사이트[MetalLB 80/443]·앱메트릭·kube-state·node_exporter·cadvisor) + FORWARD
#
#   ★ 반드시 "호스트 EC2"(virsh 돌아가는 머신)에서 실행. master VM 아님!
#   ★ VM IP는 virsh로 자동 감지, 호스트 사설IP는 hostname -I로 감지 → 하드코딩·잘못된IP 실수 방지.
#
# 사용:  ./host-network.sh                 (재구축·복원 후 호스트에서 한 번)
#        VIP=192.168.122.241 ./host-network.sh   (MetalLB EXTERNAL-IP가 .240이 아니면 지정)
# ============================================================
set -e

# ── MetalLB VIP (ingress-nginx EXTERNAL-IP) — 보통 .240. 다르면 환경변수로 덮어쓰기 ──
VIP=${VIP:-192.168.122.240}
HOST_IP=$(hostname -I | awk '{print $1}')   # ★ 재구축마다 바뀜 — 자동 감지

# ── 호스트 맞는지 확인 ──────────────────────────────────────────
if ! command -v virsh >/dev/null 2>&1; then
  echo "❌ virsh 없음 — 여기는 호스트 EC2가 아닙니다 (master VM에서 돌린 듯)."
  echo "   .pem 키로 호스트 EC2에 접속해서 다시 실행하세요."
  exit 1
fi

# ── VM IP 자동 감지 ─────────────────────────────────────────────
ip_of() { sudo virsh net-dhcp-leases default | awk -v n="$1" '$0 ~ n {print $5}' | cut -d/ -f1 | head -1; }
MASTER=$(ip_of k8s-master)
W1=$(ip_of k8s-worker1)
W2=$(ip_of k8s-worker2)
W3=$(ip_of k8s-worker3)
echo "▶ 감지된 VM IP: master=$MASTER  worker1=$W1  worker2=$W2  worker3=$W3"
[ -z "$MASTER" ] || [ -z "$W1" ] || [ -z "$W2" ] && {
  echo "❌ VM IP 감지 실패 — VM이 다 떠 있나 확인 (sudo virsh list --all)"; exit 1; }

# ── ip_forward ──────────────────────────────────────────────────
sudo sysctl -w net.ipv4.ip_forward=1 >/dev/null
echo "net.ipv4.ip_forward=1" | sudo tee /etc/sysctl.d/99-k8s-forward.conf >/dev/null
echo "▶ ip_forward=1 (영구 적용)"

# ── DNAT (싹 정리 후 재적용) ─────────────────────────────────────
sudo iptables -t nat -F PREROUTING
# 사이트 진입: EIP 80/443 → MetalLB VIP. ★ -d $HOST_IP 필수 (안 붙이면 워커의 ghcr.io pull(443)까지
#   가로채서 ImagePullBackOff — 11_트러블슈팅 §20). HOST_IP는 위에서 hostname -I로 감지.
sudo iptables -t nat -A PREROUTING -d $HOST_IP -p tcp --dport 80  -j DNAT --to-destination $VIP:80
sudo iptables -t nat -A PREROUTING -d $HOST_IP -p tcp --dport 443 -j DNAT --to-destination $VIP:443
for p in 30400 30401 30402 30403 30404 30800; do                                                  # 앱메트릭+kube-state
  sudo iptables -t nat -A PREROUTING -p tcp --dport $p -j DNAT --to-destination $MASTER:$p
done
sudo iptables -t nat -A PREROUTING -p tcp --dport 39101 -j DNAT --to-destination $W1:9100          # node_exporter
sudo iptables -t nat -A PREROUTING -p tcp --dport 39102 -j DNAT --to-destination $W2:9100
[ -n "$W3" ] && sudo iptables -t nat -A PREROUTING -p tcp --dport 39103 -j DNAT --to-destination $W3:9100
sudo iptables -t nat -A PREROUTING -p tcp --dport 38080 -j DNAT --to-destination $W1:8080          # cadvisor
sudo iptables -t nat -A PREROUTING -p tcp --dport 38081 -j DNAT --to-destination $W2:8080
echo "▶ DNAT 적용 (호스트IP=$HOST_IP → 80/443→VIP $VIP, 30400-4/30800/3910x/3808x→VM)"

# ── FORWARD 허용 (libvirt 기본 REJECT 우회 — timeout 방지) ───────
sudo iptables -C FORWARD -d 192.168.122.0/24 -j ACCEPT 2>/dev/null || sudo iptables -I FORWARD -d 192.168.122.0/24 -j ACCEPT
sudo iptables -C FORWARD -s 192.168.122.0/24 -j ACCEPT 2>/dev/null || sudo iptables -I FORWARD -s 192.168.122.0/24 -j ACCEPT
echo "▶ FORWARD ACCEPT (192.168.122.0/24)"

cat <<DONE

✅ 호스트 네트워크 설정 완료.
확인:
  호스트→master:  curl -s -o /dev/null -w "%{http_code}\\n" http://$MASTER:30400/metrics   # 200
  모니터링EC2 →:   curl -s -o /dev/null -w "%{http_code}\\n" http://<호스트IP>:30400/metrics  # 200

  외부 사이트:    curl -H "Host: shoply.example.com" http://<EIP>/api/products   # 상품 JSON

⚠️ master NodePort(30400)만 timeout이면 → master VM에서 kube-proxy 재시작:
   kubectl delete pod -n kube-system -l k8s-app=kube-proxy
⚠️ MetalLB EXTERNAL-IP가 .240이 아니면: VIP=192.168.122.24x ./host-network.sh 로 재실행.
⚠️ SG: 호스트 인바운드 80/443(0.0.0.0/0) + 모니터링 SG로부터 30400-30404/30800/38080-38081/39101-39103/9100 허용.
DONE
