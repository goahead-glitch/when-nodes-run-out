'use strict';

const fs = require('fs');
const bcrypt = require('bcryptjs');
const { randomUUID } = require('crypto');

const SURNAMES = ['김', '이', '박', '최', '정', '강', '조', '윤', '장', '임', '한', '오', '서', '신', '권', '황', '안', '송', '류', '전'];
const SURNAME_ROMAN = {
  '김': 'kim', '이': 'lee', '박': 'park', '최': 'choi', '정': 'jung', '강': 'kang', '조': 'jo',
  '윤': 'yoon', '장': 'jang', '임': 'lim', '한': 'han', '오': 'oh', '서': 'seo', '신': 'shin',
  '권': 'kwon', '황': 'hwang', '안': 'an', '송': 'song', '류': 'ryu', '전': 'jeon'
};

const GIVEN_NAMES = ['민준', '서준', '예준', '도윤', '시우', '주원', '하준', '지호', '지후', '준서', '서연', '서윤', '지우',
  '서현', '하은', '하린', '나은', '민서', '예린', '수아', '지아', '채원', '지유', '예은', '수빈', '민재', '현우', '건우',
  '우진', '정민', '태원', '혜연', '민석', '준혁', '수진', '유진', '지훈', '성민'];

const GIVEN_ROMAN = {
  '민준': 'minjun', '서준': 'seojun', '예준': 'yejun', '도윤': 'doyun', '시우': 'siwoo',
  '주원': 'juwon', '하준': 'hajun', '지호': 'jiho', '지후': 'jihu', '준서': 'junseo',
  '서연': 'seoyeon', '서윤': 'seoyun', '지우': 'jiwoo', '서현': 'seohyun', '하은': 'haeun',
  '하린': 'harin', '나은': 'naeun', '민서': 'minseo', '예린': 'yerin', '수아': 'sooa',
  '지아': 'jia', '채원': 'chaewon', '지유': 'jiyu', '예은': 'yeeun', '수빈': 'subin',
  '민재': 'minjae', '현우': 'hyunwoo', '건우': 'geonwoo', '우진': 'woojin', '정민': 'jungmin',
  '태원': 'taewon', '혜연': 'hyeyeon', '민석': 'minseok', '준혁': 'junhyuk', '수진': 'sujin',
  '유진': 'yujin', '지훈': 'jihun', '성민': 'sungmin'
};

const DOMAINS = ['naver.com', 'gmail.com', 'kakao.com', 'daum.net'];
const SEPARATORS = ['', '_', '.'];

const BRANDS = {
  '나이키': ['에어맥스 90', '에어맥스 270', '에어포스 1', '조던 1', '조던 4', '덩크 로우', '덩크 하이', '줌 페가수스 40'],
  '아디다스': ['울트라부스트 22', '스탠스미스', '삼바 OG', '가젤 볼드', 'NMD R1', '포럼 로우'],
  '뉴발란스': ['990v5', '992', '574', '530', '2002R', '1906R', '327'],
  '아식스': ['젤-카야노 29', '젤-님버스 25', 'GT-2000 11'],
  '살로몬': ['XT-6', 'ACS Pro', 'Speedcross 6'],
  '호카': ['클리프턴 9', '본다이 8', '아나카파 GTX'],
  '오니츠카타이거': ['멕시코 66', '타이거 코세이'],
  '리복': ['클래식 레더', '인스타펌프 퓨리'],
  '푸마': ['RS-X', '수에드 클래식'],
  '컨버스': ['척 테일러 70 하이', '런스타 하이크']
};

const COLORS = ['화이트', '블랙', '그레이', '네이비', '베이지', '크림', '올리브', '버건디', '스카이블루', '머스타드', '민트', '카키'];
const SIZES = [240, 250, 260, 270, 280, 290, 300];

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomElement(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomDate(start, end) {
  return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
}

function generateKoreanName() {
  const surname = randomElement(SURNAMES);
  const givenName = randomElement(GIVEN_NAMES);
  return surname + givenName;
}

function generateEmail(koreanName) {
  const [surname, givenName] = [koreanName[0], koreanName.slice(1)];
  const surnameRoman = SURNAME_ROMAN[surname];
  const givenRoman = GIVEN_ROMAN[givenName];
  const separator = randomElement(SEPARATORS);
  const number = randomInt(1, 9999);
  const domain = randomElement(DOMAINS);
  return `${surnameRoman}${separator}${givenRoman}${number}@${domain}`;
}

function generatePassword() {
  const length = randomInt(8, 12);
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  return Array.from({ length }, () => randomElement(chars.split(''))).join('');
}

// Pre-generate password hashes
const passwordHashes = Array.from({ length: 100 }, () => {
  const password = generatePassword();
  const hash = bcrypt.hashSync(password, 10);
  return { password, hash };
});

let sql = 'SET client_encoding = \'UTF8\';\n\n';
sql += 'TRUNCATE TABLE payments, order_items, orders, inventory, products, users CASCADE;\n\n';

const users = [];
const testAccounts = [];

// Admin account
const adminId = randomUUID();
const adminHash = bcrypt.hashSync('Admin1234!', 10);
users.push({
  id: adminId,
  email: 'admin@shoply.com',
  password: adminHash,
  name: '관리자',
  created_at: '2024-01-01T00:00:00.000Z'
});
testAccounts.push('admin@shoply.com | Admin1234!');

// Test accounts
const testHash = bcrypt.hashSync('Test1234!', 10);
for (let i = 1; i <= 10; i++) {
  const id = randomUUID();
  users.push({
    id,
    email: `test${i}@shoply.com`,
    password: testHash,
    name: `테스트${i}`,
    created_at: '2024-01-01T00:00:00.000Z'
  });
  testAccounts.push(`test${i}@shoply.com | Test1234!`);
}

// Regular users
for (let i = 0; i < 1000; i++) {
  const name = generateKoreanName();
  const email = generateEmail(name);
  const { password, hash } = passwordHashes[i % 100];
  const id = randomUUID();
  const created_at = randomDate(new Date('2022-01-01'), new Date()).toISOString();
  
  users.push({ id, email, password: hash, name, created_at });
  testAccounts.push(`${email} | ${password}`);
}

// Write users
for (let i = 0; i < users.length; i += 500) {
  const batch = users.slice(i, i + 500);
  sql += `INSERT INTO users (id, email, password, name, created_at) VALUES\n`;
  sql += batch.map(u => 
    `('${u.id}', '${u.email}', '${u.password}', '${u.name}', '${u.created_at}')`
  ).join(',\n');
  sql += ';\n\n';
}

// Generate products
const products = [];
let index = 1;
for (const [brand, models] of Object.entries(BRANDS)) {
  for (const model of models) {
    for (const color of COLORS) {
      if (products.length >= 500) break;
      const id = randomUUID();
      const name = `${brand} ${model} ${color}`;
      const price = Math.round(randomInt(50000, 500000) / 1000) * 1000;
      const description = `편안한 착화감의 ${name} 스니커즈입니다.`;
      const image_url = `https://placeholder.shoply.kr/products/${index}.jpg`;
      const is_timesale = index <= 20;
      const sale_price = is_timesale ? Math.round(price * (randomInt(50, 70) / 100)) : null;
      const sale_ends_at = is_timesale ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() : null;
      const created_at = randomDate(new Date('2023-01-01'), new Date()).toISOString();
      
      products.push({
        id, name, price, description, image_url, is_timesale,
        sale_price, sale_ends_at, created_at
      });
      index++;
    }
  }
}

// Write products
for (let i = 0; i < products.length; i += 500) {
  const batch = products.slice(i, i + 500);
  sql += `INSERT INTO products (id, name, price, description, image_url, is_timesale, sale_price, sale_ends_at, created_at) VALUES\n`;
  sql += batch.map(p => 
    `('${p.id}', '${p.name}', ${p.price}, '${p.description}', '${p.image_url}', ${p.is_timesale}, ${p.sale_price || 'NULL'}, ${p.sale_ends_at ? `'${p.sale_ends_at}'` : 'NULL'}, '${p.created_at}')`
  ).join(',\n');
  sql += ';\n\n';
}

// Generate inventory
const inventory = [];
for (const product of products) {
  for (const size of SIZES) {
    const id = randomUUID();
    const quantity = product.is_timesale ? randomInt(10, 100) : randomInt(100, 500);
    inventory.push({
      id,
      product_id: product.id,
      size,
      quantity,
      reserved: 0,
      version: 0
    });
  }
}

// Write inventory
for (let i = 0; i < inventory.length; i += 500) {
  const batch = inventory.slice(i, i + 500);
  sql += `INSERT INTO inventory (id, product_id, size, quantity, reserved, version) VALUES\n`;
  sql += batch.map(inv => 
    `('${inv.id}', '${inv.product_id}', ${inv.size}, ${inv.quantity}, ${inv.reserved}, ${inv.version})`
  ).join(',\n');
  sql += ';\n\n';
}

// Generate orders and related data
const orders = [];
const orderItems = [];
const payments = [];
const regularUsers = users.slice(11); // Skip admin and test accounts

for (let i = 0; i < 10000; i++) {
  const id = randomUUID();
  const user_id = regularUsers[i % regularUsers.length].id;
  const status = Math.random() < 0.7 ? 'PAID' : (Math.random() < 0.67 ? 'FAILED' : 'PENDING');
  const created_at = randomDate(new Date('2023-07-01'), new Date()).toISOString();
  
  const itemCount = randomInt(1, 3);
  let total_price = 0;
  
  // Generate order items
  for (let j = 0; j < itemCount; j++) {
    const product = randomElement(products);
    const quantity = randomInt(1, 3);
    const size = randomElement(SIZES);
    const unit_price = product.is_timesale ? product.sale_price : product.price;
    
    orderItems.push({
      id: randomUUID(),
      order_id: id,
      product_id: product.id,
      product_name: product.name,
      size,
      quantity,
      unit_price
    });
    
    total_price += unit_price * quantity;
  }
  
  const delay = randomInt(1, 30);
  const paid_at = status === 'PAID' ? new Date(new Date(created_at).getTime() + delay * 1000).toISOString() : null;
  const failed_at = status === 'FAILED' ? new Date(new Date(created_at).getTime() + delay * 1000).toISOString() : null;
  
  orders.push({
    id, user_id, status, total_price, created_at, paid_at, failed_at,
    failed_reason: null
  });
  
  // Generate payment
  payments.push({
    id: randomUUID(),
    order_id: id,
    method: Math.random() < 0.7 ? 'card' : 'bank',
    status,
    amount: total_price,
    failed_reason: status === 'FAILED' ? 
      (Math.random() < 0.5 ? 'PAYMENT_GATEWAY_ERROR' : 'INSUFFICIENT_STOCK') : null,
    created_at
  });
}

// Write orders
for (let i = 0; i < orders.length; i += 500) {
  const batch = orders.slice(i, i + 500);
  sql += `INSERT INTO orders (id, user_id, status, total_price, created_at, paid_at, failed_at, failed_reason) VALUES\n`;
  sql += batch.map(o => 
    `('${o.id}', '${o.user_id}', '${o.status}', ${o.total_price}, '${o.created_at}', ${o.paid_at ? `'${o.paid_at}'` : 'NULL'}, ${o.failed_at ? `'${o.failed_at}'` : 'NULL'}, ${o.failed_reason ? `'${o.failed_reason}'` : 'NULL'})`
  ).join(',\n');
  sql += ';\n\n';
}

// Write order items
for (let i = 0; i < orderItems.length; i += 500) {
  const batch = orderItems.slice(i, i + 500);
  sql += `INSERT INTO order_items (id, order_id, product_id, product_name, size, quantity, unit_price) VALUES\n`;
  sql += batch.map(item => 
    `('${item.id}', '${item.order_id}', '${item.product_id}', '${item.product_name}', ${item.size}, ${item.quantity}, ${item.unit_price})`
  ).join(',\n');
  sql += ';\n\n';
}

// Write payments
for (let i = 0; i < payments.length; i += 500) {
  const batch = payments.slice(i, i + 500);
  sql += `INSERT INTO payments (id, order_id, method, status, amount, failed_reason, created_at) VALUES\n`;
  sql += batch.map(p => 
    `('${p.id}', '${p.order_id}', '${p.method}', '${p.status}', ${p.amount}, ${p.failed_reason ? `'${p.failed_reason}'` : 'NULL'}, '${p.created_at}')`
  ).join(',\n');
  sql += ';\n\n';
}

// Write files
fs.writeFileSync('seed.sql', sql, 'utf8');
fs.writeFileSync('test_accounts.txt', 'email | password\n' + testAccounts.join('\n'), 'utf8');