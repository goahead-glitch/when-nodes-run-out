// OpenTelemetry 자동 계측 부트스트랩 (앱보다 먼저 --require로 로드)
//   - 서비스명: OTEL_SERVICE_NAME 환경변수
//   - 전송 대상: OTEL_EXPORTER_OTLP_ENDPOINT (예: http://<모니터링IP>:4318)
//   - 끄기: OTEL_SDK_DISABLED=true
const { NodeSDK } = require('@opentelemetry/sdk-node');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');

const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter(),       // OTEL_EXPORTER_OTLP_ENDPOINT 사용 (/v1/traces 자동)
  instrumentations: [getNodeAutoInstrumentations({
    '@opentelemetry/instrumentation-fs': { enabled: false },  // 파일 스팬 과다 → 끔
  })],
});
sdk.start();

process.on('SIGTERM', () => { sdk.shutdown().finally(() => process.exit(0)); });
