# k6 부하테스트 서버 트러블슈팅

## `docker: command not found`

### 증상

```text
Command 'docker' not found, but can be installed with:
sudo snap install docker
sudo apt install docker.io
```

### 원인

EC2 서버에 Docker가 설치되어 있지 않다.

### 해결

Docker 공식 apt 저장소를 사용해 Docker Engine과 Compose plugin을 설치한다.

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl git
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
```

```bash
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
```

```bash
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

설치 확인:

```bash
docker --version
docker compose version
```

## `permission denied while trying to connect to the Docker daemon`

### 증상

```text
permission denied while trying to connect to the Docker daemon socket
```

### 원인

현재 사용자가 `docker` 그룹에 포함되어 있지 않다.

### 해결

```bash
sudo usermod -aG docker "$USER"
newgrp docker
```

다시 확인:

```bash
docker ps
```

## `docker compose` 명령이 없다

### 증상

```text
docker: 'compose' is not a docker command
```

### 원인

Docker Compose plugin이 설치되어 있지 않다.

### 해결

```bash
sudo apt-get update
sudo apt-get install -y docker-compose-plugin
docker compose version
```

## 잘못된 폴더에서 실행

### 증상

```text
no configuration file provided: not found
```

또는 k6 이미지 빌드 시 `../k6` 경로를 찾지 못한다.

### 원인

`docker compose` 명령을 `load-test/server`가 아닌 다른 폴더에서 실행했거나, 서버에 `load-test/server`만 옮기고 `load-test/k6` 폴더를 옮기지 않았다.

### 해결

부하테스트 서버에는 `load-test` 폴더 전체를 옮긴다.

```text
load-test/
├── k6/
└── server/
```

실행 위치:

```bash
cd ~/load-test/server
docker compose build
docker compose up -d prometheus grafana node-exporter cadvisor
```

## Grafana 접속이 안 됨

### 확인할 것

컨테이너 상태:

```bash
cd ~/load-test/server
docker compose ps
```

서버 내부에서 확인:

```bash
curl -I http://localhost:3000
```

### 원인 후보

- Grafana 컨테이너가 실행되지 않았다.
- EC2 보안그룹에서 `3000` 포트가 열려 있지 않다.
- 접속 주소에 private IP를 사용했다.

### 해결

모니터링 스택 실행:

```bash
docker compose up -d grafana prometheus
```

EC2 보안그룹 인바운드에 `3000` 포트를 허용한다.

접속:

```text
http://<LOAD_TEST_SERVER_PUBLIC_IP>:3000
```

## Prometheus Targets가 DOWN

### 확인

Prometheus 접속:

```text
http://<LOAD_TEST_SERVER_PUBLIC_IP>:9090/targets
```

### 원인 후보

- `node-exporter` 또는 `cadvisor` 컨테이너가 실행되지 않았다.
- Prometheus 설정 파일이 잘못되었다.
- Shoply 타겟 서버의 `/metrics` 엔드포인트에 접근할 수 없다.

### 해결

컨테이너 상태:

```bash
docker compose ps
```

Prometheus 설정 확인:

```bash
docker compose exec prometheus promtool check config /etc/prometheus/prometheus.yml
```

Shoply 타겟 접근 확인:

```bash
curl -I http://54.180.167.159
curl -I http://54.180.167.159:4000/metrics
```

## k6 결과가 Grafana에 안 보임

### 원인 후보

- k6 실행 시 Prometheus remote write output을 사용하지 않았다.
- Prometheus remote write receiver 옵션이 꺼져 있다.
- Grafana 시간 범위가 테스트 실행 시간과 맞지 않는다.

### 확인

k6 실행 명령은 아래 형태여야 한다.

```bash
TEST_RUN_ID=server-100vus-5m VUS=100 DURATION=5m docker compose --profile run run --rm k6
```

Prometheus 컨테이너 실행 옵션에 아래 값이 있어야 한다.

```text
--web.enable-remote-write-receiver
```

현재 compose 확인:

```bash
docker compose config | grep remote-write
```

Grafana에서는 시간 범위를 `Last 15 minutes` 또는 테스트 실행 시간으로 맞춘다.

## k6 테스트 결과 파일이 안 생김

### 기대 위치

```text
load-test/k6/results/server/<TEST_RUN_ID>/
├── summary.json
└── summary.md
```

### 원인 후보

- `TEST_RUN_ID`를 다르게 지정했다.
- `load-test/k6/results/server` 경로 권한 문제가 있다.
- k6 컨테이너가 시작 전에 실패했다.

### 확인

```bash
find ~/load-test/k6/results -maxdepth 4 -type f
```

권한 확인:

```bash
ls -la ~/load-test/k6/results
```

## 부하 타겟 IP가 잘못됨

### 현재 기본값

```text
http://54.180.167.159
```

### 확인

```bash
cd ~/load-test/server
docker compose config | grep BASE_URL
```

### 임시 변경 실행

```bash
BASE_URL=http://<TARGET_IP> \
TEST_RUN_ID=server-custom-target \
docker compose --profile run run --rm k6
```

### 영구 변경

`load-test/server/.env`에서 수정한다.

```text
BASE_URL=http://<TARGET_IP>
```

## `cannot assign requested address`

### 증상

k6 로그에 아래 오류가 반복된다.

```text
connect: cannot assign requested address
```

### 의미

부하 대상 애플리케이션의 응답 지연이라기보다, 부하 발생 서버에서 짧은 시간에 너무 많은 TCP 연결을 만들면서 로컬 포트나 네트워크 자원이 먼저 부족해진 상황일 수 있다.

### 대응

- VU를 낮춰 다시 실행한다.
- 부하 발생 서버 사양을 높인다.
- k6 서버를 여러 대로 분산한다.
- 테스트 대상과 k6 서버를 같은 VPC/리전에 배치한다.
- OS 네트워크 튜닝은 별도 실험 기준을 정한 뒤 적용한다.

## Docker 이미지 다운로드 실패

### 증상

```text
pull access denied
temporary failure in name resolution
i/o timeout
```

### 원인 후보

- EC2 아웃바운드 인터넷이 막혀 있다.
- NAT Gateway 또는 Internet Gateway 라우팅이 없다.
- Docker Hub 또는 gcr.io 접근이 차단되어 있다.

### 해결

아웃바운드 접근을 확인한다.

```bash
curl -I https://registry-1.docker.io
curl -I https://gcr.io
```

VPC 라우팅, NAT Gateway, 보안그룹, NACL을 확인한다.
