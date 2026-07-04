const bcrypt = require('bcryptjs');
const { randomUUID } = require('crypto');
const fs = require('fs');
const path = require('path');

const PASSWORD = 'Test1234!';
const START = 301;
const END = 2000;

async function main() {
  const hash = await bcrypt.hash(PASSWORD, 10);
  console.log(`비밀번호 해시 생성 완료: ${hash}`);

  const sqlLines = [];
  const txtLines = [];

  for (let i = START; i <= END; i++) {
    const id = randomUUID();
    const email = `test${i}@shoply.com`;
    const name = `테스트${i}`;
    const createdAt = '2024-01-01T00:00:00.000Z';

    sqlLines.push(`('${id}', '${email}', '${hash}', '${name}', '${createdAt}')`);
    txtLines.push(`${email} | ${PASSWORD}`);
  }

  // seed.sql에 INSERT 추가
  const seedPath = path.join(__dirname, 'seed.sql');
  const insertSQL = `\n-- test${START}~test${END} 계정 추가\nINSERT INTO users (id, email, password, name, created_at) VALUES\n${sqlLines.join(',\n')};\n`;
  fs.appendFileSync(seedPath, insertSQL);
  console.log(`seed.sql에 ${END - START + 1}개 계정 추가 완료`);

  // test_accounts.txt에 추가
  const txtPath = path.join(__dirname, 'test_accounts.txt');
  fs.appendFileSync(txtPath, '\n' + txtLines.join('\n') + '\n');
  console.log(`test_accounts.txt에 ${END - START + 1}개 계정 추가 완료`);
}

main().catch(console.error);
