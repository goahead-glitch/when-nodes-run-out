import { runE2E } from './common-e2e.js';

export const options = {
  scenarios: {
    spike_flow: {
      // 타임세일 상황: 안정 기준선 200 VUS에서 순간적으로 400 VUS까지 증가시킨다.
      executor: 'ramping-vus',
      stages: [
        // 워밍업 구간.
        { duration: '1m', target: 100 },
        // 평상시 안정 부하.
        { duration: '1m', target: 200 },
        // 스파이크 진입. 안정 부하의 약 2배로 올린다.
        { duration: '1m', target: 400 },
        // 400 VUS 유지 구간. 병목과 Pending Pod 발생 여부를 본다.
        { duration: '3m', target: 400 },
        // 회복 구간.
        { duration: '2m', target: 0 },
      ],
      gracefulRampDown: '30s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.10'],
    http_req_duration: ['p(95)<1500'],
  },
};

export default function () {
  // timesale 모드는 상위 3개 상품에 요청을 집중시킨다.
  runE2E('timesale');
}
