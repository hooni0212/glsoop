// server.js

// --------------------------------------------------
// 1. 환경 변수 및 필수 모듈 로드
// --------------------------------------------------
require('dotenv').config();

const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const nodemailer = require('nodemailer');

console.log('GMAIL_USER =', process.env.GMAIL_USER);
console.log(
  'GMAIL_PASS length =',
  process.env.GMAIL_PASS ? process.env.GMAIL_PASS.length : 0
);

const app = express();
const PORT = 3000;

// --------------------------------------------------
// 2. 이메일 발송 설정 (Gmail SMTP 사용)
// --------------------------------------------------
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS,
  },
});

// JWT 서명에 사용할 비밀키 (배포 시에는 .env에서 관리)
const JWT_SECRET = process.env.JWT_SECRET || 'DEV_ONLY_FALLBACK_SECRET';

// --------------------------------------------------
// 3. 공통 미들웨어 설정
// --------------------------------------------------
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());

app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

// 3-1) 로그인 필요한 페이지용 미들웨어 (HTML 페이지용)
/*function requireLoginPage(req, res, next) {
  const token = req.cookies.token;

  // 토큰이 없으면 비로그인 상태 → 안내 페이지로
  if (!token) {
    return res.sendFile(
      path.join(__dirname, 'public', 'html', 'login-required.html')
    );
  }

  try {
    // 토큰 검증 시도
    jwt.verify(token, JWT_SECRET);
    // 검증 통과 → 로그인 상태
    next();
  } catch (err) {
    console.error('Invalid token in requireLoginPage:', err);
    return res.sendFile(
      path.join(__dirname, 'public', 'html', 'login-required.html')
    );
  }
}

// 3-2) 글쓰기(에디터) 페이지 - 로그인 필요
//      비로그인: login-required.html
//      로그인:   editor.html
app.get('/html/editor.html', requireLoginPage, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'html', 'editor.html'));
});
*/

// 정적 파일 제공 (public 폴더)
//  - HTML, CSS, JS, 이미지 등 클라이언트 파일
app.use(express.static(path.join(__dirname, 'public')));


// --------------------------------------------------
// 4. DB 연결 및 스키마 정의 (SQLite)
// --------------------------------------------------
const db = new sqlite3.Database('users.db');

// 4-1) 사용자 정보 테이블
db.run(`
  CREATE TABLE IF NOT EXISTS users (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    name      TEXT NOT NULL,
    nickname  TEXT,
    bio       TEXT,
    about     TEXT,
    email     TEXT NOT NULL UNIQUE,
    pw        TEXT NOT NULL,
    is_admin  INTEGER DEFAULT 0,
    is_verified INTEGER DEFAULT 0,
    verification_token   TEXT,
    verification_expires DATETIME,
    reset_token          TEXT,
    reset_expires        DATETIME
  )
`);

// 4-2) 글(포스트) 테이블
db.run(`
  CREATE TABLE IF NOT EXISTS posts (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL,
    title      TEXT NOT NULL,
    content    TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )
`);

// 4-3) 좋아요 테이블 (사용자-게시글 쌍당 1회만 허용)
db.run(`
  CREATE TABLE IF NOT EXISTS likes (
    user_id    INTEGER NOT NULL,
    post_id    INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, post_id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (post_id) REFERENCES posts(id)
  )
`);

// 4-4) 해시태그 목록
db.run(`
  CREATE TABLE IF NOT EXISTS hashtags (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE
  )
`);

// 4-5) 게시글-해시태그 매핑 테이블
db.run(`
  CREATE TABLE IF NOT EXISTS post_hashtags (
    post_id    INTEGER NOT NULL,
    hashtag_id INTEGER NOT NULL,
    FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
    FOREIGN KEY (hashtag_id) REFERENCES hashtags(id) ON DELETE CASCADE
  )
`);

// --------------------------------------------------
// 5. 인증/권한 관련 미들웨어
// --------------------------------------------------

// 5-1) 로그인 필수 라우트용 미들웨어
function authRequired(req, res, next) {
  const token = req.cookies.token;
  if (!token) {
    return res
      .status(401)
      .json({ ok: false, message: '로그인이 필요합니다.' });
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(401).json({
        ok: false,
        message: '토큰이 만료되었거나 유효하지 않습니다.',
      });
    }
    // req.user 안에는 토큰에 넣어둔 최소한의 정보가 들어 있음
    // { id, name, nickname, email, isAdmin, isVerified, ... }
    req.user = decoded;
    next();
  });
}

// 5-2) 관리자 전용 라우트용 미들웨어
function adminRequired(req, res, next) {
  if (!req.user || !req.user.isAdmin) {
    return res
      .status(403)
      .json({ ok: false, message: '관리자만 접근할 수 있습니다.' });
  }
  next();
}

// --------------------------------------------------
// 6. 인증 / 계정 관련 라우트 (회원가입·로그인·비번재설정 등)
// --------------------------------------------------

// 6-1) 회원가입: 기본 정보 저장 후 이메일 인증 링크 전송
app.post('/api/signup', async (req, res) => {
  const { name, nickname, email, pw } = req.body;

  if (!name || !nickname || !email || !pw) {
    return res.status(400).json({
      ok: false,
      message: '이름, 닉네임, 이메일, 비밀번호를 모두 입력하세요.',
    });
  }

  try {
    const hashed = await bcrypt.hash(pw, 10);

    // 이메일은 항상 소문자 + trim 해서 저장
    const normalizedEmail = email.trim().toLowerCase();

    // 이메일 인증용 토큰 및 만료 시간 (1시간 후)
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60).toISOString();

    db.run(
      `
      INSERT INTO users (
        name,
        nickname,
        email,
        pw,
        is_admin,
        is_verified,
        verification_token,
        verification_expires
      )
      VALUES (?, ?, ?, ?, 0, 0, ?, ?)
      `,
      [name, nickname, normalizedEmail, hashed, token, expiresAt],
      function (err) {
        if (err) {
          if (err.message && err.message.includes('UNIQUE')) {
            return res
              .status(400)
              .json({ ok: false, message: '이미 사용 중인 이메일입니다.' });
          }
          console.error(err);
          return res
            .status(500)
            .json({ ok: false, message: 'DB 오류가 발생했습니다.' });
        }

        // 인증 링크 (예: http://localhost:3000/api/verify-email?token=...)
        const verifyUrl =
          `${req.protocol}://${req.get('host')}/api/verify-email?token=${token}`;

        // 먼저 클라이언트에 성공 응답
        res.json({
          ok: true,
          message:
            '입력하신 이메일로 인증 링크를 보냈어요. 메일에서 인증을 완료한 뒤 로그인해 주세요.',
        });

        // 응답 후 백그라운드에서 이메일 발송
        transporter.sendMail(
          {
            from: `"글숲" <${process.env.GMAIL_USER}>`,
            to: normalizedEmail,
            subject: '[글숲] 이메일 인증을 완료해주세요',
            html: `
              <div style="font-family: 'Noto Sans KR', sans-serif; line-height: 1.6;">
                <p><strong>${nickname || name}님, 안녕하세요.</strong></p>
                <p>글숲에 가입해 주셔서 감사합니다. 아래 버튼을 눌러 이메일 인증을 완료해주세요.</p>
                <p style="margin: 24px 0;">
                  <a href="${verifyUrl}"
                     style="display:inline-block;padding:10px 18px;background:#2e8b57;color:#fff;
                            text-decoration:none;border-radius:6px;">
                    이메일 인증하기
                  </a>
                </p>
                <p>만약 위 버튼이 동작하지 않는다면, 아래 링크를 브라우저 주소창에 복사해서 접속해 주세요.</p>
                <p style="font-size: 0.9rem; word-break: break-all;">${verifyUrl}</p>
                <p style="font-size: 0.9rem;color:#888;">이 링크는 1시간 동안만 유효합니다.</p>
              </div>
            `,
          },
          (mailErr) => {
            if (mailErr) {
              console.error('인증 메일 발송 오류:', mailErr);
              // 여기서는 이미 회원가입 자체는 성공했으므로
              // 추가적인 응답은 보내지 않고 서버 로그만 남김
            }
          }
        );
      }
    );
  } catch (e) {
    console.error(e);
    return res
      .status(500)
      .json({ ok: false, message: '서버 오류가 발생했습니다.' });
  }
});

// 6-2) 이메일 인증 링크 처리 (GET /api/verify-email?token=...)
//      - 이메일로 받은 링크를 사용자가 클릭하면 이 라우트로 온다.
//      - 토큰을 검증하고 is_verified = 1 로 업데이트
app.get('/api/verify-email', (req, res) => {
  const token = req.query.token;

  // 쿼리스트링에 token이 없으면 잘못된 접근
  if (!token) {
    return res.status(400).send(`
      <html>
        <head><meta charset="UTF-8"><title>이메일 인증 오류</title></head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Noto Sans KR', sans-serif;">
          <h2>이메일 인증에 실패했습니다.</h2>
          <p>유효하지 않은 인증 링크입니다.</p>
          <p><a href="/index.html">메인으로 돌아가기</a></p>
        </body>
      </html>
    `);
  }

  // 토큰으로 해당 유저 조회
  db.get(
    `
    SELECT id, verification_expires, is_verified
    FROM users
    WHERE verification_token = ?
    `,
    [token],
    (err, user) => {
      if (err) {
        console.error('이메일 인증 조회 중 DB 오류:', err);
        return res.status(500).send(`
          <html>
            <head><meta charset="UTF-8"><title>이메일 인증 오류</title></head>
            <body style="font-family: -apple-system, BlinkMacSystemFont, 'Noto Sans KR', sans-serif;">
              <h2>이메일 인증에 실패했습니다.</h2>
              <p>서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.</p>
              <p><a href="/index.html">메인으로 돌아가기</a></p>
            </body>
          </html>
        `);
      }

      // 해당 토큰의 사용자가 없거나, 만료 정보가 없는 경우
      if (!user || !user.verification_expires) {
        return res.status(400).send(`
          <html>
            <head><meta charset="UTF-8"><title>이메일 인증 오류</title></head>
            <body style="font-family: -apple-system, BlinkMacSystemFont, 'Noto Sans KR', sans-serif;">
              <h2>이메일 인증에 실패했습니다.</h2>
              <p>유효하지 않은 또는 이미 사용된 인증 링크입니다.</p>
              <p><a href="/html/login.html">로그인 페이지로 가기</a></p>
            </body>
          </html>
        `);
      }

      // 이미 인증된 계정이라면 안내만 보여주고 끝
      if (user.is_verified) {
        return res.send(`
          <html>
            <head><meta charset="UTF-8"><title>이미 이메일 인증 완료</title></head>
            <body style="font-family: -apple-system, BlinkMacSystemFont, 'Noto Sans KR', sans-serif; text-align:center; padding-top:60px;">
              <h2>이미 이메일 인증이 완료된 계정입니다.</h2>
              <p>바로 로그인을 진행하실 수 있습니다.</p>
              <p><a href="/html/login.html">로그인하러 가기</a></p>
            </body>
          </html>
        `);
      }

      // 만료 시간 체크
      const now = Date.now();
      const expiresTime = new Date(user.verification_expires).getTime();

      if (isNaN(expiresTime) || expiresTime < now) {
        return res.status(400).send(`
          <html>
            <head><meta charset="UTF-8"><title>이메일 인증 만료</title></head>
            <body style="font-family: -apple-system, BlinkMacSystemFont, 'Noto Sans KR', sans-serif;">
              <h2>이메일 인증 링크가 만료되었습니다.</h2>
              <p>회원가입을 다시 진행해 주세요.</p>
              <p><a href="/html/signup.html">회원가입 페이지로 가기</a></p>
            </body>
          </html>
        `);
      }

      // 정상 토큰 → is_verified = 1 로 업데이트, 토큰/만료시간 초기화
      db.run(
        `
        UPDATE users
        SET
          is_verified = 1,
          verification_token = NULL,
          verification_expires = NULL
        WHERE id = ?
        `,
        [user.id],
        function (updateErr) {
          if (updateErr) {
            console.error('이메일 인증 업데이트 오류:', updateErr);
            return res.status(500).send(`
              <html>
                <head><meta charset="UTF-8"><title>이메일 인증 오류</title></head>
                <body style="font-family: -apple-system, BlinkMacSystemFont, 'Noto Sans KR', sans-serif;">
                  <h2>이메일 인증에 실패했습니다.</h2>
                  <p>서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.</p>
                  <p><a href="/index.html">메인으로 돌아가기</a></p>
                </body>
              </html>
            `);
          }

          // 성공 페이지: 로그인으로 유도
          return res.send(`
            <html>
              <head><meta charset="UTF-8"><title>이메일 인증 완료</title></head>
              <body style="font-family: -apple-system, BlinkMacSystemFont, 'Noto Sans KR', sans-serif; text-align:center; padding-top:60px;">
                <h2>이메일 인증이 완료되었습니다.</h2>
                <p>이제 로그인하실 수 있습니다.</p>
                <p><a href="/html/login.html">로그인하러 가기</a></p>
              </body>
            </html>
          `);
        }
      );
    }
  );
});

// 6-3) 비밀번호 재설정 메일 요청
app.post('/api/password-reset-request', (req, res) => {
  const { email } = req.body || {};

  if (!email) {
    return res
      .status(400)
      .json({ ok: false, message: '이메일을 입력해주세요.' });
  }

  const normalizedEmail = email.trim().toLowerCase();

  db.get(
    'SELECT id, name, is_verified FROM users WHERE email = ?',
    [normalizedEmail],
    (err, user) => {
      if (err) {
        console.error(err);
        return res
          .status(500)
          .json({ ok: false, message: '서버 오류가 발생했습니다.' });
      }

      // 존재 여부를 직접 알려주지 않고 항상 같은 응답
      if (!user) {
        return res.json({
          ok: true,
          message:
            '입력하신 이메일이 등록되어 있다면, 비밀번호 재설정 메일이 발송됩니다.',
        });
      }

      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 1000 * 60 * 60); // 1시간

      db.run(
        `
        UPDATE users
        SET reset_token = ?, reset_expires = ?
        WHERE id = ?
        `,
        [token, expiresAt.toISOString(), user.id],
        function (updateErr) {
          if (updateErr) {
            console.error(updateErr);
            return res
              .status(500)
              .json({ ok: false, message: '서버 오류가 발생했습니다.' });
          }

          const resetUrl = `${req.protocol}://${req.get(
            'host'
          )}/html/reset-password.html?token=${token}`;

          transporter.sendMail(
            {
              from: `"글숲" <${process.env.GMAIL_USER}>`,
              to: normalizedEmail,
              subject: '[글숲] 비밀번호 재설정 안내',
              html: `
                <div style="font-family: 'Noto Sans KR', sans-serif; line-height: 1.6;">
                  <p><strong>${user.name}님, 안녕하세요.</strong></p>
                  <p>아래 버튼을 눌러 비밀번호를 재설정해주세요.</p>
                  <p style="margin: 24px 0;">
                    <a href="${resetUrl}"
                       style="display:inline-block;padding:10px 18px;background:#2e8b57;color:#fff;
                              text-decoration:none;border-radius:6px;">
                      비밀번호 재설정하기
                    </a>
                  </p>
                  <p>만약 위 버튼이 동작하지 않으면 아래 링크를 복사해서 주소창에 붙여넣어 주세요.</p>
                  <p style="font-size:0.9rem;word-break:break-all;">${resetUrl}</p>
                  <p style="font-size:0.9rem;color:#888;">이 링크는 1시간 동안만 유효합니다.</p>
                </div>
              `,
            },
            (mailErr, info) => {
              if (mailErr) {
                console.error('비밀번호 재설정 메일 전송 오류:', mailErr);
                return res.status(500).json({
                  ok: false,
                  message:
                    '메일 전송 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
                });
              }

              console.log('reset mail sent:', info.messageId);
              return res.json({
                ok: true,
                message:
                  '입력하신 이메일이 등록되어 있다면, 비밀번호 재설정 메일이 발송되었습니다.',
              });
            }
          );
        }
      );
    }
  );
});

// 6-4) 비밀번호 실제 변경 처리
app.post('/api/password-reset', async (req, res) => {
  const { token, newPw } = req.body || {};

  if (!token || !newPw) {
    return res
      .status(400)
      .json({ ok: false, message: '토큰과 새 비밀번호를 모두 입력해주세요.' });
  }

  if (newPw.length < 8) {
    return res.status(400).json({
      ok: false,
      message: '비밀번호는 8자 이상으로 설정해주세요.',
    });
  }

  db.get(
    'SELECT id, reset_expires FROM users WHERE reset_token = ?',
    [token],
    async (err, user) => {
      if (err) {
        console.error(err);
        return res
          .status(500)
          .json({ ok: false, message: '서버 오류가 발생했습니다.' });
      }

      if (!user || !user.reset_expires) {
        return res
          .status(400)
          .json({ ok: false, message: '유효하지 않은 링크입니다.' });
      }

      const now = Date.now();
      const expiresTime = new Date(user.reset_expires).getTime();

      if (isNaN(expiresTime) || expiresTime < now) {
        return res.status(400).json({
          ok: false,
          message: '비밀번호 재설정 링크가 만료되었습니다. 다시 요청해주세요.',
        });
      }

      try {
        const hashedPw = await bcrypt.hash(newPw, 10);

        db.run(
          `
          UPDATE users
          SET pw = ?, reset_token = NULL, reset_expires = NULL
          WHERE id = ?
          `,
          [hashedPw, user.id],
          function (updateErr) {
            if (updateErr) {
              console.error(updateErr);
              return res.status(500).json({
                ok: false,
                message: '비밀번호 변경 중 오류가 발생했습니다.',
              });
            }

            return res.json({
              ok: true,
              message: '비밀번호가 변경되었습니다. 다시 로그인해주세요.',
            });
          }
        );
      } catch (hashErr) {
        console.error(hashErr);
        return res
          .status(500)
          .json({ ok: false, message: '서버 오류가 발생했습니다.' });
      }
    }
  );
});

// 6-5) 로그인: 이메일/비밀번호 확인 후 JWT 쿠키 발급
app.post('/api/login', (req, res) => {
  const { email, pw } = req.body;

  if (!email || !pw) {
    return res
      .status(400)
      .json({ ok: false, message: '이메일과 비밀번호를 입력하세요.' });
  }

  const normalizedEmail = email.trim().toLowerCase();

  db.get(
    'SELECT * FROM users WHERE email = ?',
    [normalizedEmail],
    async (err, user) => {
      if (err) {
        console.error(err);
        return res
          .status(500)
          .json({ ok: false, message: 'DB 오류가 발생했습니다.' });
      }

      if (!user) {
        return res
          .status(400)
          .json({ ok: false, message: '등록되지 않은 이메일입니다.' });
      }

      const match = await bcrypt.compare(pw, user.pw);
      if (!match) {
        return res
          .status(400)
          .json({ ok: false, message: '비밀번호가 틀렸습니다.' });
      }

      if (!user.is_verified) {
        return res.status(403).json({
          ok: false,
          message:
            '이메일 인증이 완료되지 않았습니다. 메일함에서 인증 링크를 확인해주세요.',
        });
      }

      const token = jwt.sign(
        {
          id: user.id,
          name: user.name,
          nickname: user.nickname,
          email: user.email,
          isAdmin: !!user.is_admin,
          isVerified: !!user.is_verified,
        },
        JWT_SECRET,
        { expiresIn: '2h' }
      );

      res.cookie('token', token, {
        httpOnly: true,
        sameSite: 'lax',
        // secure: true, // HTTPS 사용 시 활성화
        path: '/',
      });

      return res.json({
        ok: true,
        message: `환영합니다, ${user.name}님!`,
        name: user.name,
        nickname: user.nickname || null,
      });
    }
  );
});

// 6-6) 로그아웃: JWT 쿠키 삭제
app.post('/api/logout', (req, res) => {
  res.clearCookie('token', { path: '/' });
  res.json({ ok: true, message: '로그아웃되었습니다.' });
});

// --------------------------------------------------
// 7. 내 정보 조회/수정 (마이페이지용)
// --------------------------------------------------

// 7-1) 내 계정 정보 조회
app.get('/api/me', authRequired, (req, res) => {
  const userId = req.user.id;

  db.get(
    `
    SELECT
      id,
      name,
      nickname,
      bio,
      about,
      email,
      is_admin,
      is_verified
    FROM users
    WHERE id = ?
    `,
    [userId],
    (err, row) => {
      if (err) {
        console.error(err);
        return res
          .status(500)
          .json({ ok: false, message: 'DB 오류가 발생했습니다.' });
      }

      if (!row) {
        return res
          .status(404)
          .json({ ok: false, message: '사용자를 찾을 수 없습니다.' });
      }

      res.json({
        ok: true,
        id: row.id,
        name: row.name,
        nickname: row.nickname,
        bio: row.bio || null,
        about: row.about || null,
        email: row.email,
        isAdmin: !!row.is_admin,
        isVerified: !!row.is_verified,
      });
    }
  );
});

// 7-2) 내 계정 정보 수정 (닉네임/소개/비밀번호 등)
app.put('/api/me', authRequired, (req, res) => {
  const userId = req.user.id;
  const { nickname, currentPw, newPw, bio, about } = req.body || {};

  const fields = [];
  const params = [];

  if (nickname !== undefined && nickname !== null) {
    fields.push('nickname = ?');
    params.push(nickname);
  }

  if (bio !== undefined) {
    fields.push('bio = ?');
    params.push(bio);
  }

  if (about !== undefined) {
    fields.push('about = ?');
    params.push(about);
  }

  const wantsPwChange = !!newPw;

  // 비밀번호 변경 없이 기본 프로필만 수정하는 경우
  if (!wantsPwChange) {
    if (fields.length === 0) {
      return res.status(400).json({
        ok: false,
        message: '변경할 내용을 입력하세요.',
      });
    }

    params.push(userId);

    db.run(
      `
      UPDATE users
      SET ${fields.join(', ')}
      WHERE id = ?
      `,
      params,
      function (updateErr) {
        if (updateErr) {
          console.error(updateErr);
          return res.status(500).json({
            ok: false,
            message: '내 정보 수정 중 오류가 발생했습니다.',
          });
        }

        return res.json({
          ok: true,
          message: '정보가 성공적으로 수정되었습니다.',
        });
      }
    );
    return;
  }

  // 비밀번호 변경이 포함된 경우
  if (!currentPw) {
    return res.status(400).json({
      ok: false,
      message: '비밀번호를 변경하려면 현재 비밀번호를 입력해주세요.',
    });
  }

  db.get('SELECT pw FROM users WHERE id = ?', [userId], async (err, user) => {
    if (err) {
      console.error(err);
      return res
        .status(500)
        .json({ ok: false, message: 'DB 오류가 발생했습니다.' });
    }

    if (!user) {
      return res
        .status(404)
        .json({ ok: false, message: '사용자를 찾을 수 없습니다.' });
    }

    const okPw = await bcrypt.compare(currentPw, user.pw);
    if (!okPw) {
      return res
        .status(400)
        .json({ ok: false, message: '현재 비밀번호가 일치하지 않습니다.' });
    }

    if (!newPw || newPw.length < 6) {
      return res.status(400).json({
        ok: false,
        message: '새 비밀번호는 최소 6자 이상이어야 합니다.',
      });
    }

    const newHashedPw = await bcrypt.hash(newPw, 10);
    fields.push('pw = ?');
    params.push(newHashedPw);

    if (fields.length === 0) {
      return res.status(400).json({
        ok: false,
        message: '변경할 내용을 입력하세요.',
      });
    }

    params.push(userId);

    db.run(
      `
      UPDATE users
      SET ${fields.join(', ')}
      WHERE id = ?
      `,
      params,
      function (updateErr) {
        if (updateErr) {
          console.error(updateErr);
          return res.status(500).json({
            ok: false,
            message: '내 정보 수정 중 오류가 발생했습니다.',
          });
        }

        return res.json({
          ok: true,
          message: '정보가 성공적으로 수정되었습니다.',
        });
      }
    );
  });
});

// --------------------------------------------------
// 8. 작가 프로필 / 특정 작가 글 목록
// --------------------------------------------------

// 8-1) 작가 공개 프로필 조회
app.get('/api/users/:id/profile', (req, res) => {
  const authorId = req.params.id;

  db.get(
    `
    SELECT
      id,
      name,
      nickname,
      email,
      bio,
      about
    FROM users
    WHERE id = ?
    `,
    [authorId],
    (err, user) => {
      if (err) {
        console.error(err);
        return res
          .status(500)
          .json({ ok: false, message: '작가 정보 조회 중 DB 오류가 발생했습니다.' });
      }

      if (!user) {
        return res
          .status(404)
          .json({ ok: false, message: '해당 작가를 찾을 수 없습니다.' });
      }

      db.get(
        `
        SELECT
          COUNT(DISTINCT p.id) AS post_count,
          COUNT(l.post_id)     AS total_likes
        FROM posts p
        LEFT JOIN likes l ON l.post_id = p.id
        WHERE p.user_id = ?
        `,
        [authorId],
        (err2, stats) => {
          if (err2) {
            console.error(err2);
            return res.status(500).json({
              ok: false,
              message: '작가 통계 조회 중 DB 오류가 발생했습니다.',
            });
          }

          return res.json({
            ok: true,
            user: {
              id: user.id,
              name: user.name,
              nickname: user.nickname,
              email: user.email,
              bio: user.bio || null,
              about: user.about || null,
              postCount: stats?.post_count || 0,
              totalLikes: stats?.total_likes || 0,
            },
          });
        }
      );
    }
  );
});

// 8-2) 특정 작가의 글 목록 (무한스크롤용)
app.get('/api/users/:id/posts', (req, res) => {
  const authorId = req.params.id;

  let userId = null;
  const token = req.cookies.token;
  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      userId = decoded.id;
    } catch (e) {
      userId = null;
    }
  }

  let limit = parseInt(req.query.limit, 10);
  let offset = parseInt(req.query.offset, 10);

  if (isNaN(limit) || limit <= 0 || limit > 50) {
    limit = 20;
  }
  if (isNaN(offset) || offset < 0) {
    offset = 0;
  }

  const baseSelect = `
    SELECT
      p.id,
      p.title,
      p.content,
      p.created_at,
      (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS like_count,
      GROUP_CONCAT(DISTINCT h.name) AS hashtags
  `;

  const baseFromJoin = `
    FROM posts p
    LEFT JOIN post_hashtags ph ON ph.post_id = p.id
    LEFT JOIN hashtags h ON h.id = ph.hashtag_id
  `;

  const baseWhere = `
    WHERE p.user_id = ?
  `;

  const baseGroupOrder = `
    GROUP BY p.id
    ORDER BY p.created_at DESC
    LIMIT ? OFFSET ?
  `;

  let sql;
  let params = [];

  if (userId) {
    sql = `
      ${baseSelect},
      CASE
        WHEN EXISTS (
          SELECT 1 FROM likes l2
          WHERE l2.post_id = p.id AND l2.user_id = ?
        ) THEN 1
        ELSE 0
      END AS user_liked
      ${baseFromJoin}
      ${baseWhere}
      ${baseGroupOrder}
    `;
    params = [userId, authorId, limit, offset];
  } else {
    sql = `
      ${baseSelect},
      0 AS user_liked
      ${baseFromJoin}
      ${baseWhere}
      ${baseGroupOrder}
    `;
    params = [authorId, limit, offset];
  }

  db.all(sql, params, (err, rows) => {
    if (err) {
      console.error(err);
      return res.status(500).json({
        ok: false,
        message: '작가 글 목록 조회 중 DB 오류가 발생했습니다.',
      });
    }

    return res.json({
      ok: true,
      posts: rows || [],
      hasMore: rows.length === limit,
    });
  });
});

// --------------------------------------------------
// 9. 글 작성/수정/삭제/피드/좋아요/추천 등 포스트 관련 API
// --------------------------------------------------

// 9-1) 글 작성
app.post('/api/posts', authRequired, (req, res) => {
  const { title, content, hashtags } = req.body;
  const userId = req.user.id;

  if (!title || !content) {
    return res
      .status(400)
      .json({ ok: false, message: '제목과 내용을 모두 입력하세요.' });
  }

  db.run(
    'INSERT INTO posts (user_id, title, content) VALUES (?, ?, ?)',
    [userId, title, content],
    function (err) {
      if (err) {
        console.error(err);
        return res
          .status(500)
          .json({ ok: false, message: '글 저장 중 DB 오류가 발생했습니다.' });
      }

      const newPostId = this.lastID;

      saveHashtagsForPostFromInput(newPostId, hashtags, (tagErr) => {
        if (tagErr) {
          console.error('해시태그 저장 중 오류:', tagErr);
          return res.json({
            ok: true,
            message:
              '글은 저장되었지만, 해시태그 저장 중 오류가 발생했습니다.',
            postId: newPostId,
          });
        }

        return res.json({
          ok: true,
          message: '글이 저장되었습니다.',
          postId: newPostId,
        });
      });
    }
  );
});

// 9-2) 글 수정 (작성자 또는 관리자)
app.put('/api/posts/:id', authRequired, (req, res) => {
  const postId = req.params.id;
  const { title, content, hashtags } = req.body;
  const userId = req.user.id;
  const isAdmin = !!req.user.isAdmin;

  if (!title || !content) {
    return res
      .status(400)
      .json({ ok: false, message: '제목과 내용을 모두 입력하세요.' });
  }

  db.get('SELECT user_id FROM posts WHERE id = ?', [postId], (err, row) => {
    if (err) {
      console.error(err);
      return res
        .status(500)
        .json({ ok: false, message: '글 조회 중 DB 오류가 발생했습니다.' });
    }

    if (!row) {
      return res
        .status(404)
        .json({ ok: false, message: '해당 글을 찾을 수 없습니다.' });
    }

    if (!isAdmin && row.user_id !== userId) {
      return res
        .status(403)
        .json({ ok: false, message: '이 글을 수정할 권한이 없습니다.' });
    }

    db.run(
      'UPDATE posts SET title = ?, content = ? WHERE id = ?',
      [title, content, postId],
      function (err2) {
        if (err2) {
          console.error(err2);
          return res
            .status(500)
            .json({ ok: false, message: '글 수정 중 DB 오류가 발생했습니다.' });
        }

        saveHashtagsForPostFromInput(postId, hashtags, (tagErr) => {
          if (tagErr) {
            console.error('해시태그 갱신 중 오류:', tagErr);
            return res.json({
              ok: true,
              message:
                '글은 수정되었지만, 해시태그 저장 중 오류가 발생했습니다.',
            });
          }

          return res.json({
            ok: true,
            message: '글이 수정되었습니다.',
          });
        });
      }
    );
  });
});

// 9-3) 내가 쓴 글 목록 (마이페이지)
app.get('/api/posts/my', authRequired, (req, res) => {
  const userId = req.user.id;

  db.all(
    `
    SELECT
      p.id,
      p.title,
      p.content,
      p.created_at,
      (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS like_count
    FROM posts p
    WHERE p.user_id = ?
    ORDER BY p.created_at DESC
    `,
    [userId],
    (err, rows) => {
      if (err) {
        console.error(err);
        return res
          .status(500)
          .json({ ok: false, message: '글 목록 조회 중 DB 오류가 발생했습니다.' });
      }

      return res.json({
        ok: true,
        posts: rows,
      });
    }
  );
});

// 9-4) 내가 공감한 글 목록 (마이페이지)
app.get('/api/posts/liked', authRequired, (req, res) => {
  const userId = req.user.id;

  db.all(
    `
    SELECT
      p.id,
      p.title,
      p.content,
      p.created_at,
      (SELECT COUNT(*) FROM likes l2 WHERE l2.post_id = p.id) AS like_count
    FROM posts p
    INNER JOIN likes l ON l.post_id = p.id
    WHERE l.user_id = ?
    ORDER BY l.created_at DESC
    `,
    [userId],
    (err, rows) => {
      if (err) {
        console.error(err);
        return res
          .status(500)
          .json({ ok: false, message: '공감한 글 목록 조회 중 DB 오류가 발생했습니다.' });
      }

      return res.json({
        ok: true,
        posts: rows,
      });
    }
  );
});

// 9-5) 피드 조회 (전체 글 + 해시태그 필터 + 로그인 시 좋아요 여부 포함)
app.get('/api/posts/feed', (req, res) => {
  let userId = null;

  const token = req.cookies.token;
  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      userId = decoded.id;
    } catch (e) {
      userId = null;
    }
  }

  let limit = parseInt(req.query.limit, 10);
  let offset = parseInt(req.query.offset, 10);

  if (isNaN(limit) || limit <= 0 || limit > 50) {
    limit = 20;
  }
  if (isNaN(offset) || offset < 0) {
    offset = 0;
  }

  let tags = [];
  if (req.query.tags) {
    tags = String(req.query.tags)
      .split(',')
      .map((t) => t.trim().toLowerCase())
      .filter((t) => t.length > 0);
  } else if (req.query.tag) {
    const t = String(req.query.tag).trim().toLowerCase();
    if (t) tags = [t];
  }
  const tagCount = tags.length;

  const baseSelect = `
    SELECT
      p.id,
      p.title,
      p.content,
      p.created_at,
      u.id      AS author_id,
      u.name     AS author_name,
      u.nickname AS author_nickname,
      u.email    AS author_email,
      (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS like_count,
      GROUP_CONCAT(DISTINCT h.name) AS hashtags
  `;

  const baseFromJoin = `
    FROM posts p
    JOIN users u ON p.user_id = u.id
    LEFT JOIN post_hashtags ph ON ph.post_id = p.id
    LEFT JOIN hashtags h ON h.id = ph.hashtag_id
  `;

  const baseOrder = `
    GROUP BY p.id
    ORDER BY p.created_at DESC
    LIMIT ? OFFSET ?
  `;

  let sql;
  let params = [];

  if (userId) {
    if (tagCount > 0) {
      const placeholders = tags.map(() => '?').join(', ');
      sql = `
        ${baseSelect},
        CASE
          WHEN EXISTS (
            SELECT 1 FROM likes l2
            WHERE l2.post_id = p.id AND l2.user_id = ?
          ) THEN 1
          ELSE 0
        END AS user_liked
        ${baseFromJoin}
        WHERE p.id IN (
          SELECT ph2.post_id
          FROM post_hashtags ph2
          JOIN hashtags h2 ON h2.id = ph2.hashtag_id
          WHERE h2.name IN (${placeholders})
          GROUP BY ph2.post_id
          HAVING COUNT(DISTINCT h2.name) = ?
        )
        ${baseOrder}
      `;
      params = [userId, ...tags, tagCount, limit, offset];
    } else {
      sql = `
        ${baseSelect},
        CASE
          WHEN EXISTS (
            SELECT 1 FROM likes l2
            WHERE l2.post_id = p.id AND l2.user_id = ?
          ) THEN 1
          ELSE 0
        END AS user_liked
        ${baseFromJoin}
        ${baseOrder}
      `;
      params = [userId, limit, offset];
    }
  } else {
    if (tagCount > 0) {
      const placeholders = tags.map(() => '?').join(', ');
      sql = `
        ${baseSelect},
        0 AS user_liked
        ${baseFromJoin}
        WHERE p.id IN (
          SELECT ph2.post_id
          FROM post_hashtags ph2
          JOIN hashtags h2 ON h2.id = ph2.hashtag_id
          WHERE h2.name IN (${placeholders})
          GROUP BY ph2.post_id
          HAVING COUNT(DISTINCT h2.name) = ?
        )
        ${baseOrder}
      `;
      params = [...tags, tagCount, limit, offset];
    } else {
      sql = `
        ${baseSelect},
        0 AS user_liked
        ${baseFromJoin}
        ${baseOrder}
      `;
      params = [limit, offset];
    }
  }

  db.all(sql, params, (err, rows) => {
    if (err) {
      console.error(err);
      return res
        .status(500)
        .json({ ok: false, message: '피드 조회 중 DB 오류가 발생했습니다.' });
    }

    return res.json({
      ok: true,
      posts: rows,
      hasMore: rows.length === limit,
    });
  });
});

// 9-6) 관련 글 추천 (단일 글 기준 유사 글 목록)
app.get('/api/posts/:id/related', (req, res) => {
  const postId = parseInt(req.params.id, 10);
  if (!postId) {
    return res
      .status(400)
      .json({ ok: false, message: '잘못된 글 ID입니다.' });
  }

  const limit = parseInt(req.query.limit, 10) || 6;

  db.get(
    `
    SELECT
      p.id,
      p.user_id AS author_id,
      p.created_at,
      GROUP_CONCAT(DISTINCT h.name) AS hashtags
    FROM posts p
    LEFT JOIN post_hashtags ph ON ph.post_id = p.id
    LEFT JOIN hashtags h ON h.id = ph.hashtag_id
    WHERE p.id = ?
    GROUP BY p.id
    `,
    [postId],
    (err, current) => {
      if (err) {
        console.error(err);
        return res
          .status(500)
          .json({ ok: false, message: '기준 글 조회 중 DB 오류가 발생했습니다.' });
      }

      if (!current) {
        return res
          .status(404)
          .json({ ok: false, message: '해당 글을 찾을 수 없습니다.' });
      }

      const currentTags = current.hashtags
        ? current.hashtags
            .split(',')
            .map((t) => t.trim().toLowerCase())
            .filter(Boolean)
        : [];

      const CANDIDATE_LIMIT = 100;

      db.all(
        `
        SELECT
          p.id,
          p.title,
          p.content,
          p.created_at,
          u.id      AS author_id,
          u.name     AS author_name,
          u.nickname AS author_nickname,
          u.email    AS author_email,
          IFNULL(l.like_count, 0) AS like_count,
          GROUP_CONCAT(DISTINCT h.name) AS hashtags
        FROM posts p
        JOIN users u ON p.user_id = u.id
        LEFT JOIN (
          SELECT post_id, COUNT(*) AS like_count
          FROM likes
          GROUP BY post_id
        ) l ON l.post_id = p.id
        LEFT JOIN post_hashtags ph ON ph.post_id = p.id
        LEFT JOIN hashtags h ON h.id = ph.hashtag_id
        WHERE p.id != ?
        GROUP BY p.id
        ORDER BY p.created_at DESC
        LIMIT ?
        `,
        [postId, CANDIDATE_LIMIT],
        (err2, rows) => {
          if (err2) {
            console.error(err2);
            return res.status(500).json({
              ok: false,
              message: '관련 글을 불러오는 중 DB 오류가 발생했습니다.',
            });
          }

          if (!rows || rows.length === 0) {
            return res.json({ ok: true, posts: [] });
          }

          const now = Date.now();
          const ONE_DAY = 1000 * 60 * 60 * 24;

          const scored = rows.map((p) => {
            const postTags = (p.hashtags || '')
              .split(',')
              .map((t) => t.trim().toLowerCase())
              .filter(Boolean);

            const overlapCount = postTags.filter((t) =>
              currentTags.includes(t)
            ).length;

            const sameAuthor = p.author_id === current.author_id ? 1 : 0;

            const createdTime = new Date(p.created_at).getTime();
            let recencyScore = 0;
            if (!isNaN(createdTime)) {
              const daysAgo = (now - createdTime) / ONE_DAY;
              recencyScore = Math.max(0, 7 - daysAgo);
            }

            const likeCount = p.like_count || 0;

            const score =
              overlapCount * 3 +
              sameAuthor * 2 +
              likeCount * 1 +
              recencyScore * 1;

            return { ...p, _score: score };
          });

          scored.sort((a, b) => b._score - a._score);

          const finalPosts = scored.slice(0, limit).map((p) => {
            const copy = { ...p };
            delete copy._score;
            return copy;
          });

          return res.json({ ok: true, posts: finalPosts });
        }
      );
    }
  );
});

// 9-7) 글 상세 조회 (편집을 위한 본인 글 조회)
app.get('/api/posts/:id', authRequired, (req, res) => {
  const postId = req.params.id;
  const userId = req.user.id;

  db.get(
    `
    SELECT
      p.id,
      p.title,
      p.content,
      p.created_at,
      GROUP_CONCAT(DISTINCT h.name) AS hashtags
    FROM posts p
    LEFT JOIN post_hashtags ph ON ph.post_id = p.id
    LEFT JOIN hashtags h ON h.id = ph.hashtag_id
    WHERE p.id = ? AND p.user_id = ?
    GROUP BY p.id
    `,
    [postId, userId],
    (err, row) => {
      if (err) {
        console.error(err);
        return res
          .status(500)
          .json({ ok: false, message: '글 조회 중 DB 오류가 발생했습니다.' });
      }

      if (!row) {
        return res
          .status(404)
          .json({ ok: false, message: '해당 글을 찾을 수 없습니다.' });
      }

      const tags = row.hashtags
        ? row.hashtags.split(',').filter((t) => t && t.length > 0)
        : [];

      return res.json({
        ok: true,
        post: {
          id: row.id,
          title: row.title,
          content: row.content,
          created_at: row.created_at,
          hashtags: tags,
        },
      });
    }
  );
});

// 9-8) 글 삭제 (작성자 또는 관리자)
app.delete('/api/posts/:id', authRequired, (req, res) => {
  const postId = req.params.id;
  const userId = req.user.id;
  const isAdmin = !!req.user.isAdmin;

  db.get('SELECT user_id FROM posts WHERE id = ?', [postId], (err, row) => {
    if (err) {
      console.error(err);
      return res
        .status(500)
        .json({ ok: false, message: '글 조회 중 DB 오류가 발생했습니다.' });
    }

    if (!row) {
      return res
        .status(404)
        .json({ ok: false, message: '해당 글을 찾을 수 없습니다.' });
    }

    if (!isAdmin && row.user_id !== userId) {
      return res
        .status(403)
        .json({ ok: false, message: '이 글을 삭제할 권한이 없습니다.' });
    }

    db.run('DELETE FROM posts WHERE id = ?', [postId], function (err2) {
      if (err2) {
        console.error(err2);
        return res
          .status(500)
          .json({ ok: false, message: '글 삭제 중 DB 오류가 발생했습니다.' });
      }

      if (this.changes === 0) {
        return res
          .status(404)
          .json({ ok: false, message: '해당 글을 찾을 수 없습니다.' });
      }

      return res.json({ ok: true, message: '글이 삭제되었습니다.' });
    });
  });
});

// 9-9) 좋아요 토글 (추가/취소)
app.post('/api/posts/:id/toggle-like', authRequired, (req, res) => {
  const postId = req.params.id;
  const userId = req.user.id;

  db.get(
    'SELECT 1 FROM likes WHERE user_id = ? AND post_id = ?',
    [userId, postId],
    (err, row) => {
      if (err) {
        console.error(err);
        return res.status(500).json({
          ok: false,
          message: '좋아요 상태 확인 중 DB 오류가 발생했습니다.',
        });
      }

      if (row) {
        db.run(
          'DELETE FROM likes WHERE user_id = ? AND post_id = ?',
          [userId, postId],
          function (err2) {
            if (err2) {
              console.error(err2);
              return res.status(500).json({
                ok: false,
                message: '좋아요 취소 중 DB 오류가 발생했습니다.',
              });
            }

            db.get(
              'SELECT COUNT(*) AS cnt FROM likes WHERE post_id = ?',
              [postId],
              (err3, row2) => {
                if (err3) {
                  console.error(err3);
                  return res.status(500).json({
                    ok: false,
                    message: '좋아요 수 조회 중 DB 오류가 발생했습니다.',
                  });
                }

                return res.json({
                  ok: true,
                  liked: false,
                  likeCount: row2.cnt || 0,
                });
              }
            );
          }
        );
      } else {
        db.run(
          'INSERT INTO likes (user_id, post_id) VALUES (?, ?)',
          [userId, postId],
          function (err2) {
            if (err2) {
              console.error(err2);
              return res.status(500).json({
                ok: false,
                message: '좋아요 추가 중 DB 오류가 발생했습니다.',
              });
            }

            db.get(
              'SELECT COUNT(*) AS cnt FROM likes WHERE post_id = ?',
              [postId],
              (err3, row2) => {
                if (err3) {
                  console.error(err3);
                  return res.status(500).json({
                    ok: false,
                    message: '좋아요 수 조회 중 DB 오류가 발생했습니다.',
                  });
                }

                return res.json({
                  ok: true,
                  liked: true,
                  likeCount: row2.cnt || 0,
                });
              }
            );
          }
        );
      }
    }
  );
});

// --------------------------------------------------
// 10. 관리자 기능 (회원 조회/삭제)
// --------------------------------------------------

// 10-1) 관리자: 전체 회원 목록
app.get('/api/admin/users', authRequired, adminRequired, (req, res) => {
  db.all(
    `
    SELECT
      id,
      name,
      email,
      nickname,
      is_admin,
      COALESCE(is_verified, 0) AS is_verified
    FROM users
    ORDER BY id ASC
    `,
    [],
    (err, rows) => {
      if (err) {
        console.error(err);
        return res
          .status(500)
          .json({ ok: false, message: '유저 목록 조회 중 DB 오류가 발생했습니다.' });
      }

      return res.json({
        ok: true,
        users: rows,
      });
    }
  );
});

// 10-2) 관리자: 특정 회원과 관련 데이터 모두 삭제
app.delete(
  '/api/admin/users/:id',
  authRequired,
  adminRequired,
  (req, res) => {
    const targetUserId = req.params.id;

    db.serialize(() => {
      db.run(
        'DELETE FROM likes WHERE user_id = ?',
        [targetUserId],
        function (err1) {
          if (err1) {
            console.error(err1);
            return res.status(500).json({
              ok: false,
              message: '회원 좋아요 삭제 중 오류가 발생했습니다.',
            });
          }

          db.run(
            `
            DELETE FROM likes
            WHERE post_id IN (SELECT id FROM posts WHERE user_id = ?)
            `,
            [targetUserId],
            function (err2) {
              if (err2) {
                console.error(err2);
                return res.status(500).json({
                  ok: false,
                  message:
                    '회원 게시글의 좋아요 삭제 중 오류가 발생했습니다.',
                });
              }

              db.run(
                'DELETE FROM posts WHERE user_id = ?',
                [targetUserId],
                function (err3) {
                  if (err3) {
                    console.error(err3);
                    return res.status(500).json({
                      ok: false,
                      message: '회원 게시글 삭제 중 오류가 발생했습니다.',
                    });
                  }

                  db.run(
                    'DELETE FROM users WHERE id = ?',
                    [targetUserId],
                    function (err4) {
                      if (err4) {
                        console.error(err4);
                        return res.status(500).json({
                          ok: false,
                          message: '회원 삭제 중 DB 오류가 발생했습니다.',
                        });
                      }

                      if (this.changes === 0) {
                        return res.status(404).json({
                          ok: false,
                          message: '해당 회원을 찾을 수 없습니다.',
                        });
                      }

                      return res.json({
                        ok: true,
                        message: '회원 및 관련 데이터가 모두 삭제되었습니다.',
                      });
                    }
                  );
                }
              );
            }
          );
        }
      );
    });
  }
);

// --------------------------------------------------
// 11. 해시태그 유틸 함수 (공통 사용)
// --------------------------------------------------

// 해시태그 문자열 정리: 공백/앞의 # 제거, 길이 제한, 영어 소문자 통일
function normalizeHashtagName(raw) {
  if (!raw) return null;
  let t = String(raw).trim();
  if (!t) return null;

  if (t[0] === '#') t = t.slice(1);
  t = t.trim();
  if (!t) return null;

  if (t.length > 50) t = t.slice(0, 50);

  return t.toLowerCase();
}

// 에디터에서 들어온 해시태그 입력을 기반으로
// 해당 게시글의 해시태그 매핑을 모두 재저장
function saveHashtagsForPostFromInput(postId, hashtagsInput, callback) {
  let rawList = [];

  if (Array.isArray(hashtagsInput)) {
    rawList = hashtagsInput;
  } else if (typeof hashtagsInput === 'string') {
    rawList = hashtagsInput.split(/[\s,]+/);
  } else {
    rawList = [];
  }

  const set = new Set();
  rawList.forEach((raw) => {
    const n = normalizeHashtagName(raw);
    if (n) set.add(n);
  });

  const tags = Array.from(set);

  if (tags.length === 0) {
    db.run(
      'DELETE FROM post_hashtags WHERE post_id = ?',
      [postId],
      (err) => {
        if (err) console.error('delete post_hashtags error:', err);
        if (callback) callback(err);
      }
    );
    return;
  }

  db.serialize(() => {
    db.run('DELETE FROM post_hashtags WHERE post_id = ?', [postId], (err) => {
      if (err) {
        console.error('delete post_hashtags error:', err);
        if (callback) callback(err);
        return;
      }

      const insertTagStmt = db.prepare(
        'INSERT OR IGNORE INTO hashtags (name) VALUES (?)'
      );
      const selectTagStmt = db.prepare(
        'SELECT id FROM hashtags WHERE name = ?'
      );
      const insertMapStmt = db.prepare(
        'INSERT INTO post_hashtags (post_id, hashtag_id) VALUES (?, ?)'
      );

      let index = 0;

      function processNext() {
        if (index >= tags.length) {
          insertTagStmt.finalize();
          selectTagStmt.finalize();
          insertMapStmt.finalize();
          if (callback) callback(null);
          return;
        }

        const tag = tags[index++];
        insertTagStmt.run(tag, (err2) => {
          if (err2) {
            console.error('insert hashtag error:', err2);
            processNext();
            return;
          }

          selectTagStmt.get(tag, (err3, row) => {
            if (err3 || !row) {
              console.error('select hashtag error:', err3);
              processNext();
              return;
            }

            insertMapStmt.run(postId, row.id, (err4) => {
              if (err4) {
                console.error('insert post_hashtags error:', err4);
              }
              processNext();
            });
          });
        });
      }

      processNext();
    });
  });
}

// --------------------------------------------------
// 12. 기본 라우트 및 서버 시작
// --------------------------------------------------

// 루트 요청은 index.html 반환
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 서버 실행
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
