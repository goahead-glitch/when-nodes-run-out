#!/bin/bash
# ============================================================
# 클러스터 복원 — 새 EC2에서 KVM 설치 + VM 복원을 한 방에
#   (qcow2 백업 tar 하나만 있으면 됨 — doc 15에서 만든 것)
#   AMI(월 비용) 대신, PC에 보관한 무료 백업으로 복원.
#
# 사용법 (새 EC2에서):
#   1. 백업 tar 업로드:  scp shoply-cluster.tar.gz ubuntu@<새EC2>:~/
#   2. 이 스크립트 업로드 후:  ./restore-cluster.sh shoply-cluster.tar.gz
#
# 전제: 새 EC2가 중첩 가상화 켜진 인스턴스(doc 13 0단계)일 것.
# ============================================================
set -e
TAR="${1:?사용법: ./restore-cluster.sh <백업.tar.gz>}"
VMS="k8s-master k8s-worker1 k8s-worker2 k8s-worker3"

echo "▶ 1/5 디스크 확장 (있으면)"
DISK=$(lsblk -dno NAME | grep -E '^nvme0n1|^xvda|^vda' | head -1)
sudo growpart /dev/$DISK 1 2>/dev/null || echo "  (확장 불필요/이미 됨)"
sudo resize2fs /dev/${DISK}1 2>/dev/null || true

echo "▶ 2/5 KVM 설치"
sudo apt-get update -qq
sudo apt-get install -y -qq \
  qemu-kvm libvirt-daemon-system libvirt-clients bridge-utils virtinst cloud-image-utils
sudo systemctl enable --now libvirtd
# DNS (KVM 환경 불통 방지)
echo -e "nameserver 8.8.8.8\nnameserver 8.8.4.4" | sudo tee /etc/resolv.conf >/dev/null

echo "▶ 3/5 백업 풀기 + qcow2 배치"
mkdir -p ~/vm-backup && tar xzf "$TAR" -C ~/vm-backup
sudo cp ~/vm-backup/*.qcow2 /var/lib/libvirt/images/

echo "▶ 4/5 default 네트워크 + VM 정의/시작"
sudo virsh net-start default 2>/dev/null || true
sudo virsh net-autostart default 2>/dev/null || true
for vm in $VMS; do
  sudo virsh define ~/vm-backup/$vm.xml
  # cloud-init iso(cdrom) 참조 제거 — 복원 시 그 iso가 없어 start 실패하는 것 방지
  sudo virt-xml $vm --remove-device --disk device=cdrom 2>/dev/null || true
  sudo virsh autostart $vm
  sudo virsh start $vm
done

echo "▶ 5/6 VM 부팅 대기 (master IP 받을 때까지)"
MASTER=""
for i in $(seq 1 36); do
  MASTER=$(sudo virsh net-dhcp-leases default | grep k8s-master | awk '{print $5}' | cut -d/ -f1)
  [ -n "$MASTER" ] && break
  sleep 5
done
sudo virsh list --all
sudo virsh net-dhcp-leases default

echo "▶ 6/6 호스트 네트워크 자동 설정 (ip_forward + DNAT + FORWARD)"
HN="$(cd "$(dirname "$0")" && pwd)/host-network.sh"
if [ -f "$HN" ]; then
  bash "$HN" || echo "  ⚠️ host-network.sh 실패 — VM이 다 떴는지 확인 후 수동 실행"
else
  echo "  ⚠️ host-network.sh 없음 (같은 폴더에 두면 자동 실행). 수동으로 ip_forward+DNAT+FORWARD 필요."
fi

cat <<'DONE'

✅ 복원 + 호스트 네트워크 자동 완료.
── 자동으로 된 것: 디스크확장 · KVM설치 · VM복원/부팅 · ip_forward+DNAT+FORWARD ──

남은 수동 (클러스터/모니터링 측 — 조건부):
  1. master VM: kubectl get nodes (4개 Ready?)
       · 6443 refused면 → loopback 방화벽 flush + kubelet 재시작 (11_트러블슈팅 §13)  ← 부팅 후 자주 발생
       · NodePort(메트릭) 안 되면 → kube-proxy 재시작 (§19)
  2. 모니터링 EC2: prometheus.yml 의 호스트IP를 새 호스트 사설IP로 + curl -X POST .../-/reload
  3. DB/Redis EC2도 새로 떴으면 configmap IP 갱신 (kubectl patch cm + rollout restart)
  4. VM 내부 IP는 고정 → 클러스터 자체는 그대로 동작.
DONE
