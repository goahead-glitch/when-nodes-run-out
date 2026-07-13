# CI/CD

이 디렉토리는 Shoply 이미지 빌드, GHCR push, Kubernetes 배포 자동화 흐름을 관리한다.

## 현재 방향

- GitHub Actions 기반 CI/CD
- GitHub Container Registry(GHCR) 사용
- 온프레미스와 EKS가 동일한 이미지 태그를 pull
- 실험 배포는 `latest` 대신 커밋 SHA 또는 명시적 실험 태그 사용

Jenkins와 AWS ECR은 초기 검토 대상이었으나, 현재 프로젝트 기준은 GitHub Actions + GHCR이다.

## 이미지 규칙

| Service | Port | GHCR Image |
|---|---:|---|
| frontend | 3000 | `ghcr.io/ktk026/shoply-frontend` |
| gateway | 4000 | `ghcr.io/ktk026/shoply-gateway` |
| product | 4001 | `ghcr.io/ktk026/shoply-product` |
| inventory | 4002 | `ghcr.io/ktk026/shoply-inventory` |
| order | 4003 | `ghcr.io/ktk026/shoply-order` |
| payment | 4004 | `ghcr.io/ktk026/shoply-payment` |
| user | 4005 | `ghcr.io/ktk026/shoply-user` |

예시:

```text
ghcr.io/ktk026/shoply-gateway:<commit-sha>
```

## 브랜치 기준

| 브랜치 | 용도 |
|---|---|
| `main` | 최종 안정 버전 |
| `dev` | 통합 테스트 |
| `cicd` | CI/CD, GHCR, 배포 자동화 작업 |

작업 흐름:

```text
feature/cicd work
→ cicd
→ dev
→ main
```

## 현재 Workflow

현재 확인된 workflow:

```text
.github/workflows/docker-build-test.yml
```

서비스별 Docker build를 수행하고, gateway는 컨테이너 실행과 health check까지 검증한다. push 이벤트에서는 GHCR push까지 수행한다.

| 항목 | 값 |
|---|---|
| 대상 서비스 | frontend, gateway, user, product, inventory |
| GHCR 태그 | `dev` |
| gateway 포트 | 4000 |
| gateway Health Check | `/health` |

## GHCR 로그인

로컬에서 수동 push가 필요하면 GHCR에 로그인한다.

```bash
docker login ghcr.io -u <GITHUB_USERNAME>
```

PAT 권한:

- `write:packages`
- `read:packages`

이미지 pull만 하는 서버는 `read:packages`만 있으면 된다.

토큰은 Git에 올리지 않는다. 노출된 토큰은 즉시 폐기하고 재발급한다.

## 수동 이미지 push

```bash
cd msa_shoply
./scripts/push-ghcr.sh
```

## 향후 작업

- 서비스별 workflow 분리
- 커밋 SHA 태그 자동 적용
- Trivy 등 이미지 보안 스캔 추가
- manifest image tag update 방식 결정
- 배포 실패 시 rollback 기준 정리
