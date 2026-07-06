# userdata — EC2 부트스트랩 스크립트

각 역할별 EC2를 **User Data**로 띄우면, 인스턴스가 부팅되자마자 이 스크립트들이 실행되어 Docker 설치부터 서비스 기동까지 자동으로 끝납니다. 콘솔에서 EC2 생성 시 "고급 세부 정보 → User data"에 해당 스크립트 내용을 붙여넣는 방식으로 사용합니다.

| 스크립트 | 대상 EC2 | 내용 |
|---|---|---|
| `postgresql.sh` | DB EC2 | Docker 설치 + `postgres/` 작업 디렉토리 준비 |
| `redis.sh` | 캐시 EC2 | Docker 설치 + `redis/` 작업 디렉토리 준비 |
| `k6.sh` | 부하테스트 EC2 | Docker 설치 + `k6/scripts` 작업 디렉토리 준비 |
| `monitoring.sh` | 모니터링 EC2(1호기) | Docker 설치 + Prometheus/Grafana 스택 기동 |
| `monitoring2.sh` | 모니터링 EC2(2호기) | 1호기는 그대로 두고 비교용으로 띄운 두 번째 모니터링 인스턴스 — 풀스택(Prometheus 온프레+EKS / Loki / Grafana / Tempo)을 부팅만으로 전부 기동 |
| `rancher.sh` | Rancher EC2 | Docker 설치 + Rancher 단일 컨테이너 실행(클러스터 관리 UI) |

## 공통 패턴

모든 스크립트는 동일한 뼈대를 가집니다:
```bash
#!/bin/bash
exec > /var/log/user-data.log 2>&1   # 실행 로그를 파일로 남김 (문제 생기면 여기부터 확인)
set -e                               # 실패 시 즉시 중단

apt-get update -y
# Docker 공식 저장소 등록 + docker-ce/docker-compose-plugin 설치
# ...
systemctl enable docker && systemctl start docker
usermod -aG docker ubuntu
```

## 실행 확인

인스턴스가 뜬 뒤:
```bash
ssh ubuntu@<EC2-IP>
cat /var/log/user-data.log   # 부트스트랩이 끝까지 실행됐는지, 에러는 없었는지 확인
docker compose ps            # 해당 역할의 compose 스택이 떠 있는지
```

## 관련 문서

- EC2 보안그룹·전체 설정 절차 → [`EC2_설정_가이드.md`](EC2_설정_가이드.md)
- 각 스택의 상세 구성 → [`../monitoring/README.md`](../monitoring/README.md), [`../postgres/README.md`](../postgres/README.md), [`../redis/README.md`](../redis/README.md), [`../k6/README.md`](../k6/README.md)
