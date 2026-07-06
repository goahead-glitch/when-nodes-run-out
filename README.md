# team — 팀원 담당 파트 모음 (참고용)

> ⚠️ **이 브랜치의 코드·문서는 본인이 작성한 것이 아니라 팀원들이 직접 작성한 제출물입니다.** 온프레미스 vs EKS 비교 실험에서 본인이 담당하지 않은 영역(EKS 인프라, EKS 서비스 배포, CI/CD·부하테스트 운영)을 팀원들이 어떻게 만들었는지 비교·참고하기 위해 원문 그대로 모아뒀습니다. 본인이 실제로 만들고 운영한 부분은 `app`/`onprem`/`공용`/`develop` 브랜치에 있고, 팀 전체 역할 분담은 [`docs/project-roles.md`](https://github.com/goahead-glitch/when-nodes-run-out/blob/develop/docs/project-roles.md)(develop 브랜치)를 참고하세요.

## 이 브랜치에 있는 것

| 폴더 | 담당 | 내용 |
|---|---|---|
| [`infra/`](infra/) | 팀원(EKS 인프라) | Terraform으로 구성한 EKS 인프라 전체 — VPC, 보안그룹, IAM, EKS 워커/Karpenter, RDS, Redis, ECR |
| [`eks-service/`](eks-service/) | 김민수 | EKS에 7개 서비스 배포, HPA 오토스케일링, Karpenter 노드 확장 연동, CloudWatch 모니터링 |
| [`cicd-k6/`](cicd-k6/) | 팀원(CI/CD·부하테스트) | GitHub Actions 기반 이미지 빌드/GHCR push, k6 E2E 부하테스트 시나리오(안정/스파이크/장애복구), 온프레-EKS 동시 실행 운영 런북 |

## 왜 이 브랜치를 따로 뒀나

`app`/`onprem`/`공용` 브랜치는 본인이 실제로 만들고 운영한 부분만 담아 포트폴리오로 쓰기 위한 것이라, 팀원이 만든 EKS 인프라·서비스 배포·CI/CD 코드를 거기 섞으면 "누가 무엇을 했는지"가 흐려집니다. 그래서 팀원 파트는 이 브랜치로 분리해, 원문(코드·이미지·문서) 그대로 보존하면서도 비교·참고는 할 수 있게 했습니다.

`eks-service/README.md`에는 원래 이미지가 들어갈 자리에 플레이스홀더만 있고 실제 스크린샷은 폴더에 따로 있던 상태였는데, 이번에 해당 스크린샷(Container Insights 서비스 맵, HPA 스케일링 터미널, Karpenter 노드 확장, CloudWatch 지표)을 제자리에 넣어 정리했습니다.

## 온프레미스 비교와의 연결

본인이 담당한 온프레미스 vs EKS 비교 실험 결과는 `develop`/`integration` 브랜치의 [`docs/experiments.md`](https://github.com/goahead-glitch/when-nodes-run-out/blob/develop/docs/experiments.md)에 있습니다. 이 브랜치의 `eks-service/README.md`가 보여주는 "HPA+Karpenter로 노드 9개까지 확장, CPU 최대 90.83%"라는 EKS 쪽 관찰과 함께 보면, 왜 EKS도 Pending이 완전히 0은 아니었는지(노드 프로비저닝 시간 동안의 지연) 양쪽 관점을 다 볼 수 있습니다.

## 참고 스크린샷

`images/awseks/`, `images/awsservice/`에 팀원이 작업 중 캡처한 추가 스크린샷(ECR, IAM, 보안그룹, 노드 목록, HPA, 서비스 배포 등)을 원본 그대로 보관해뒀습니다. 위 3개 README에서 다루지 않는 세부 화면들이라 개별 설명 없이 참고용으로만 남깁니다.
