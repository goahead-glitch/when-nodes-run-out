#!/usr/bin/env node
'use strict';

/**
 * Bedrock으로 시드 데이터 생성 스크립트를 요청하고,
 * 받은 코드를 실행해서 seed.sql + test_accounts.txt를 생성합니다.
 *
 * 사전 조건:
 *   1. npm install  (in this db/ directory)
 *   2. AWS 자격증명 설정 (aws configure 또는 환경변수)
 *   3. Bedrock 모델 액세스 활성화 (AWS 콘솔 → Bedrock → Model access)
 *
 * 실행:
 *   node generate-seed.js
 */

const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// ── 설정 ────────────────────────────────────────────────────────────────────
const REGION = process.env.AWS_REGION || 'ap-northeast-2';
const MODEL_ID = process.env.BEDROCK_MODEL_ID || 'apac.anthropic.claude-3-5-sonnet-20241022-v2:0';
const OUT_DIR = __dirname;

// ── Bedrock 프롬프트 ─────────────────────────────────────────────────────────
const PROMPT = `
You are a seed data generator for a Korean sneakers shopping mall.

Write a COMPLETE, RUNNABLE Node.js script (CommonJS, no TypeScript) that:
1. Generates realistic Korean e-commerce seed data
2. Uses only "bcryptjs" as an external dependency
3. Outputs exactly two files: seed.sql and test_accounts.txt

=== OUTPUT FILE SPECS ===

seed.sql:
- Pure SQL INSERT statements, no markdown, no explanations
- Start with: SET client_encoding = 'UTF8';
- Then: TRUNCATE TABLE payments, order_items, orders, inventory, products, users CASCADE;
- Then bulk INSERTs (up to 500 rows per statement) for each table in order:
  users → products → inventory → orders → order_items → payments

test_accounts.txt:
- Header line: email | password
- One line per user: email | password (plain text)
- Include all 1000 regular users + admin + 10 test accounts

=== CRITICAL EMAIL RULES ===

EMAILS MUST CONTAIN ONLY ASCII CHARACTERS. NO KOREAN CHARACTERS IN EMAIL.
Build emails using romanized Korean names only:

Surname romanization map (use exactly these):
김→kim, 이→lee, 박→park, 최→choi, 정→jung, 강→kang, 조→jo, 윤→yoon, 장→jang, 임→lim,
한→han, 오→oh, 서→seo, 신→shin, 권→kwon, 황→hwang, 안→an, 송→song, 류→ryu, 전→jeon

Given name romanization map (use exactly these):
민준→minjun, 서준→seojun, 예준→yejun, 도윤→doyun, 시우→siwoo, 주원→juwon, 하준→hajun,
지호→jiho, 지후→jihu, 준서→junseo, 서연→seoyeon, 서윤→seoyun, 지우→jiwoo, 서현→seohyun,
하은→haeun, 하린→harin, 나은→naeun, 민서→minseo, 예린→yerin, 수아→sooa, 지아→jia,
채원→chaewon, 지유→jiyu, 예은→yeeun, 수빈→subin, 민재→minjae, 현우→hyunwoo, 건우→geonwoo,
우진→woojin, 정민→jungmin, 태원→taewon, 혜연→hyeyeon, 민석→minseok, 준혁→junhyuk,
수진→sujin, 유진→yujin, 지훈→jihun, 성민→sungmin

Email format: {surname_roman}{separator}{given_roman}{number}@{domain}
- separator: one of '' (empty), '_', '.'
- number: random 1~9999
- domain: one of naver.com, gmail.com, kakao.com, daum.net

WRONG: 최민진915@hotmail.com  ← Korean in email, FORBIDDEN
RIGHT: choi_minjin915@naver.com  ← ASCII only, CORRECT

=== CRITICAL DATE FORMAT RULES ===

ALL timestamps must be in ISO 8601 format: new Date(...).toISOString()
Example: '2025-08-17T03:28:12.000Z'

WRONG: 'Sun Aug 17 2025 12:28:12 GMT+0900 (Korean Standard Time)'
RIGHT: '2025-08-17T03:28:12.000Z'

Always call .toISOString() on every Date object before writing to SQL.

=== SCHEMA ===

users (1000 regular + 1 admin + 10 test = 1011 total):

  Regular users (1000 rows):
    id UUID
    email VARCHAR UNIQUE — ASCII-only romanized Korean email (see rules above)
    password VARCHAR — bcrypt hash (cost 10) of randomly generated 8~12 char alphanumeric password
    name VARCHAR — Korean name (ex: 김민준, 이서연)
    created_at TIMESTAMPTZ — ISO format, random within last 2 years

  Admin account (1 row, insert FIRST):
    id: use crypto.randomUUID()
    email: 'admin@shoply.com'
    password: bcrypt hash of 'Admin1234!'
    name: '관리자'
    created_at: '2024-01-01T00:00:00.000Z'

  Test accounts (10 rows, insert after admin):
    email: 'test1@shoply.com' through 'test10@shoply.com'
    password: bcrypt hash of 'Test1234!'  ← same password for all 10
    name: '테스트1' through '테스트10'
    created_at: '2024-01-01T00:00:00.000Z'

products (500 rows):
  id UUID
  name VARCHAR — Korean sneaker name (Brand + Model + Color)
  price INTEGER — 50000~500000, rounded to nearest 1000
  description TEXT — one short Korean sentence
  image_url VARCHAR — 'https://placeholder.shoply.kr/products/{1-based-index}.jpg'
  is_timesale BOOLEAN — exactly 20 products TRUE (first 20)
  sale_price INTEGER — 30~50% off if timesale, NULL otherwise
  sale_ends_at TIMESTAMPTZ — ISO format, NOW()+24h if timesale, NULL otherwise
  created_at TIMESTAMPTZ — ISO format, random within last year

inventory (3500 rows = 500 products × 7 sizes):
  id UUID
  product_id UUID — references products
  size INTEGER — one of: 240, 250, 260, 270, 280, 290, 300
  quantity INTEGER — timesale: 10~100, others: 100~500
  reserved INTEGER — 0
  version INTEGER — 0

orders (10000 rows):
  id UUID
  user_id UUID — cycle through regular users (not admin/test)
  status VARCHAR — 70% 'PAID', 20% 'FAILED', 10% 'PENDING'
  total_price INTEGER — sum of item prices
  created_at TIMESTAMPTZ — ISO format, random within last 6 months
  paid_at TIMESTAMPTZ — ISO format, created_at + 1~30s if PAID, NULL otherwise
  failed_at TIMESTAMPTZ — ISO format, created_at + 1~30s if FAILED, NULL otherwise
  failed_reason TEXT — NULL

order_items (1~3 per order):
  id UUID
  order_id UUID — references orders
  product_id UUID — references products
  product_name VARCHAR — copy of product name
  size INTEGER — one of the 7 sizes
  quantity INTEGER — 1~3
  unit_price INTEGER — sale_price if timesale, price otherwise

payments (10000 rows, one per order):
  id UUID
  order_id UUID — references orders
  method VARCHAR — 'card' or 'bank'
  status VARCHAR — matches order status
  amount INTEGER — matches order total_price
  failed_reason TEXT — 'PAYMENT_GATEWAY_ERROR' or 'INSUFFICIENT_STOCK' if FAILED, NULL otherwise
  created_at TIMESTAMPTZ — ISO format, same as order created_at

=== SCRIPT REQUIREMENTS ===

- const { randomUUID } = require('crypto');  ← use this for UUIDs
- Pre-generate 100 (password, bcryptHash) pairs at cost 10
  Assign round-robin to regular users. Admin/test use dedicated hashes.
- Batch INSERT: max 500 rows per INSERT statement
- SQL value formatting:
    string  → wrap in single quotes, escape internal ' as ''
    null    → NULL  (no quotes)
    number  → no quotes
    boolean → TRUE or FALSE  (no quotes)
    date    → use toISOString(), wrap in single quotes
- Write seed.sql and test_accounts.txt using fs.writeFileSync with 'utf8' encoding

=== SNEAKER DATA ===
나이키: 에어맥스 90, 에어맥스 270, 에어포스 1, 조던 1, 조던 4, 덩크 로우, 덩크 하이, 줌 페가수스 40
아디다스: 울트라부스트 22, 스탠스미스, 삼바 OG, 가젤 볼드, NMD R1, 포럼 로우
뉴발란스: 990v5, 992, 574, 530, 2002R, 1906R, 327
아식스: 젤-카야노 29, 젤-님버스 25, GT-2000 11
살로몬: XT-6, ACS Pro, Speedcross 6
호카: 클리프턴 9, 본다이 8, 아나카파 GTX
오니츠카타이거: 멕시코 66, 타이거 코세이
리복: 클래식 레더, 인스타펌프 퓨리
푸마: RS-X, 수에드 클래식
컨버스: 척 테일러 70 하이, 런스타 하이크
Colors: 화이트, 블랙, 그레이, 네이비, 베이지, 크림, 올리브, 버건디, 스카이블루, 머스타드, 민트, 카키

Output ONLY the complete JavaScript code. No markdown fences, no backticks, no explanation text.
The very first line of output must be exactly: 'use strict';
`;

// ── Bedrock 호출 ─────────────────────────────────────────────────────────────
async function callBedrock(prompt) {
  const client = new BedrockRuntimeClient({ region: REGION });

  const body = JSON.stringify({
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: 16000,
    messages: [{ role: 'user', content: prompt }],
  });

  const cmd = new InvokeModelCommand({
    modelId: MODEL_ID,
    contentType: 'application/json',
    accept: 'application/json',
    body,
  });

  console.log(`Calling Bedrock (${MODEL_ID})...`);
  const res = await client.send(cmd);
  const parsed = JSON.parse(Buffer.from(res.body).toString('utf8'));
  return parsed.content[0].text;
}

// ── 코드 추출 ────────────────────────────────────────────────────────────────
function extractCode(text) {
  // 마크다운 코드블록 제거 (Bedrock이 감싸는 경우 대비)
  const blockMatch = text.match(/```(?:javascript|js)?\n([\s\S]*?)```/);
  if (blockMatch) return blockMatch[1].trim();
  return text.trim();
}

// ── 메인 ─────────────────────────────────────────────────────────────────────
async function main() {
  // 1. Bedrock에서 생성기 스크립트 받기
  const response = await callBedrock(PROMPT);
  const code = extractCode(response);

  // 2. 생성된 스크립트 저장
  const generatorPath = path.join(OUT_DIR, '_generated-generator.js');
  fs.writeFileSync(generatorPath, code, 'utf8');
  console.log(`Generator script saved → ${generatorPath}`);

  // 3. 생성기 실행 (bcryptjs가 db/node_modules에 있어야 함)
  console.log('Running generator...');
  try {
    execSync(`node "${generatorPath}"`, {
      cwd: OUT_DIR,
      stdio: 'inherit',
      timeout: 300_000, // 5분
    });
  } catch (e) {
    console.error('\nGenerator failed. Check _generated-generator.js for issues.');
    process.exit(1);
  }

  // 4. 결과 확인
  const seedExists = fs.existsSync(path.join(OUT_DIR, 'seed.sql'));
  const accountsExists = fs.existsSync(path.join(OUT_DIR, 'test_accounts.txt'));

  console.log('\n──────────────────────────────────');
  console.log(seedExists ? '✓ seed.sql 생성 완료' : '✗ seed.sql 없음 — 오류 확인 필요');
  console.log(accountsExists ? '✓ test_accounts.txt 생성 완료' : '✗ test_accounts.txt 없음');
  console.log('──────────────────────────────────');

  if (seedExists && accountsExists) {
    const seedSize = (fs.statSync(path.join(OUT_DIR, 'seed.sql')).size / 1024).toFixed(1);
    console.log(`seed.sql 크기: ${seedSize} KB`);
    console.log('\n다음 단계:');
    console.log('  cd .. && docker compose up -d');
    console.log('  docker exec -i msa_postgres psql -U shoply -d shoply < db/seed.sql');
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
