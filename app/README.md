# app — 애플리케이션 코드

쇼핑몰 MSA 앱 그 자체. 빌드·실행 단위가 모두 여기에 모여 있다.

| 경로 | 내용 |
|---|---|
| `gateway/` | API 게이트웨이 (Express/TS) |
| `services/{product,inventory,order,payment,user}/` | 마이크로서비스 6개 |
| `frontend/` | React 쇼핑몰 UI |
| `db/` | 스키마·시드·동시성/부하 준비 SQL (`schema.sql`, `seed.sql`, `load-test-prep.sql`, 시드 생성 스크립트) |
| `docker-compose.yml` / `docker-compose.hub.yml` | 로컬/허브 빌드·실행 |
| `.env`, `.env.example` | 환경변수 |

> 관련 문서 → `문서/app/` (앱_서비스_설명, 데이터베이스)
> `docker compose up`은 이 폴더에서 실행 (상대경로 빌드).
