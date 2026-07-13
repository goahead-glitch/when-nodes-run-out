# 문서 안내

이 프로젝트의 "읽는 문서"는 전부 여기 모여 있습니다. 목적에 따라 골라 읽으세요.

## 무엇이 궁금한가요?

| 궁금한 것 | 읽을 문서 |
|---|---|
| 프로젝트가 뭔지 3분 안에 알고 싶다 | [루트 README](../README.md) |
| 팀이 몇 명이고 누가 뭘 했는지 | [project-roles.md](project-roles.md) |
| 실험을 어떻게 설계했고 결과가 뭔지 | [experiments.md](experiments.md) |
| 온프레미스와 EKS를 어떻게 "공정하게" 비교했는지 (통제변수) | [homogenization.md](homogenization.md) |
| 트래픽이 어떤 경로로 흐르고 포트는 어떻게 쓰는지 | [architecture.md](architecture.md) |
| 장애를 어떻게 진단하고 해결했는지 (깊은 회고) | [incidents/](incidents/) ↓ |

## 장애 회고 (incidents/)

실제로 겪은 장애 중 진단 과정에 이야기가 있는 4건을 골라, `증상 → 로그 → 원인 분석 → 왜 그렇게 판단했는가 → 해결 → 결과 → 재발 방지` 형식으로 깊게 정리했습니다. 나머지를 포함한 전체 20건의 시간순 로그는 [`../onprem/TROUBLESHOOTING.md`](../onprem/TROUBLESHOOTING.md)에 있습니다.

| # | 문서 | 한 줄 요약 |
|---|---|---|
| 01 | [kube-apiserver loopback 방화벽](incidents/01-kube-apiserver-loopback-firewall.md) | 클러스터 전체 먹통 — `refused`가 아닌 `timeout`이라는 단서로 방화벽 DROP을 역추적 |
| 02 | [flannel br_netfilter](incidents/02-flannel-br-netfilter.md) | 파드 네트워크 전멸 — 에러 메시지 두 개의 인과관계로 커널 모듈 미로드를 특정 |
| 03 | [외부 접속 불가 (DNAT)](incidents/03-dnat-external-access.md) | curl 실패 "방식"으로 원인을 3갈래 분류하는 진단 트리 + 광역 DNAT가 만든 2차 장애 |
| 04 | [모니터링 타겟 다운](incidents/04-monitoring-targets-down.md) | "일부만 살아있다"는 단서로 고장난 계층을 특정 — 조용한 실패는 체크리스트로 잡는다 |

## 미디어

- `images/` — 실험·구축 스크린샷, 아키텍처 다이어그램
- `videos/` — [온프레 vs EKS 300VU 부하 테스트 실황](videos/onprem-vs-eks-300vu-load-test.mp4) (68초)
