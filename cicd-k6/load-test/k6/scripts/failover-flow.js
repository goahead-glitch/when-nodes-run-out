import { runE2E } from './common-e2e.js';

export const options = {
  scenarios: {
    failover_flow: {
      // 노드 장애 복구 확인용: 안정 부하 200 VUS를 유지한 상태에서 워커 노드 1대를 종료한다.
      executor: 'ramping-vus',
      stages: [
        // 워밍업 구간.
        { duration: '1m', target: 100 },
        // 안정 부하 도달.
        { duration: '1m', target: 200 },
        // 장애 전 안정 상태 관찰 구간.
        { duration: '3m', target: 200 },
        // 5분 시점에 워커 노드 1대 종료 후 복구 과정을 관찰하는 구간.
        { duration: '5m', target: 200 },
        // 회복 구간.
        { duration: '2m', target: 0 },
      ],
      gracefulRampDown: '30s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.10'],
    http_req_duration: ['p(95)<2000'],
  },
};

export default function () {
  // 장애 테스트는 특정 상품 쏠림이 아니라 일반 사용자 흐름으로 진행한다.
  runE2E('normal');
}
