# onprem — 온프레미스 인프라·배포·운영

본인(팀원C)이 담당한 온프레미스 구축·배포·운영 자산.

| 경로 | 내용 |
|---|---|
| `k8s/common/` | 공통 매니페스트 (Deployment·Service·HPA·Ingress·ConfigMap·Secret 등) |
| `k8s/onprem/` | 온프레 전용 (MetalLB·cAdvisor·nodeport·event-exporter·promtail) |
| `scripts/host-network.sh` | 호스트 iptables/네트워크 설정 |
| `scripts/restore-cluster.sh` | 클러스터 복원 |

> 관련 문서 → `문서/onprem/`
> ※ `infra/`(postgres·redis·EC2가이드·서버 userdata)는 `team/infra/`로 이동함.
