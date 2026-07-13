import { runE2E } from './common-e2e.js';

export const options = {
  scenarios: {
    stable_flow: {
      // 평상시 기준선 확인용: 200 VUS가 안정적으로 유지되는지 본다.
      executor: 'ramping-vus',
      stages: [
        // 워밍업 구간.
        { duration: '1m', target: 100 },
        // 공식 안정 부하 도달.
        { duration: '1m', target: 200 },
        // 200 VUS 유지 구간. p95, 실패율, Pending Pod가 안정적인지 확인한다.
        { duration: '6m', target: 200 },
        // 회복 구간.
        { duration: '2m', target: 0 },
      ],
      gracefulRampDown: '30s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.05'],
    http_req_duration: ['p(95)<1000'],
  },
};

export default function () {
  // normal 모드는 상품 20개에 요청을 분산한다.
  runE2E('normal');
}
