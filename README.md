# when-nodes-run-out

온프레미스 Kubernetes vs AWS EKS — 동일한 쇼핑몰 MSA 앱을 양쪽에 배포하고, **노드 자동확장 유무** 하나만 다르게 두어 트래픽 폭증·노드 장애 상황에서 두 인프라가 어떻게 다르게 버티는지 비교하는 실험 프로젝트입니다.

이 레포는 팀 프로젝트 중 제가 담당한 부분(앱 개발, 온프레미스 인프라, 공용 인프라 일부)을 정리한 것입니다.

## 브랜치 구조

작업은 컴포넌트별 브랜치에서 진행 후 `develop`에서 통합 테스트, 이상 없으면 `main`으로 병합합니다.

| 브랜치 | 내용 |
|---|---|
| `app` | 쇼핑몰 MSA 서비스 코드 (gateway/product/inventory/order/payment/user/frontend) |
| `onprem` | 온프레미스 k8s 매니페스트, 배포/복원 스크립트 |
| `공용` | monitoring(Prometheus/Grafana/Loki), k6 부하테스트, PostgreSQL, Redis |
| `develop` | 위 브랜치들을 통합해 테스트하는 브랜치 |
| `main` | 안정화된 결과물 |

## 문서

- [프로젝트 역할](docs/project-roles.md)
- [환경 동일화 기준](docs/homogenization.md)
- [실험 설계 및 결과](docs/experiments.md)

각 컴포넌트의 상세 설명은 해당 브랜치의 README.md를 참고하세요.
