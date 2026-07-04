import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool } from '../db';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';

router.post('/login', async (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string };

  if (!email || !password) {
    return res.status(400).json({ message: '이메일과 비밀번호를 입력해주세요.' });
  }

  try {
    const { rows } = await pool.query<{
      id: string; email: string; name: string; password: string;
    }>(
      'SELECT id, email, name, password FROM users WHERE email = $1',
      [email.trim().toLowerCase()],
    );

    const user = rows[0];
    if (!user) {
      return res.status(401).json({ message: '이메일 또는 비밀번호가 올바르지 않습니다.' });
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(401).json({ message: '이메일 또는 비밀번호가 올바르지 않습니다.' });
    }

    const token = jwt.sign(
      { sub: user.id, email: user.email, name: user.name },
      JWT_SECRET,
      { expiresIn: '24h' },
    );

    return res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
  } catch (err) {
    console.error('[auth/login]', err);
    return res.status(500).json({ message: '서버 오류가 발생했습니다.' });
  }
});

router.get('/me', (req, res) => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) {
    return res.status(401).json({ message: '인증이 필요합니다.' });
  }
  try {
    const payload = jwt.verify(auth.slice(7), JWT_SECRET) as {
      sub: string; email: string; name: string;
    };
    return res.json({ id: payload.sub, email: payload.email, name: payload.name });
  } catch {
    return res.status(401).json({ message: '유효하지 않은 토큰입니다.' });
  }
});

export default router;
