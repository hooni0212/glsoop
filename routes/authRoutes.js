// routes/authRoutes.js

// ================== 1. 회원가입 & 이메일 인증 ==================
// POST /api/signup
// GET  /api/verify-email

// ================== 2. 비밀번호 재설정 ==================
// POST /api/password-reset-request
// POST /api/password-reset

// ================== 3. 로그인 / 로그아웃 ==================
// POST /api/login
// POST /api/logout

// ================== 4. 내 정보(me) 조회/수정 ==================
// GET  /api/me
// PUT  /api/me


const express = require('express');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const db = require('../db');
const { transporter, JWT_SECRET } = require('../config');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

// 6-1) 회원가입 + 이메일 인증 메일 발송
router.post('/signup', async (req, res) => {
  const { name, nickname, email, pw } = req.body;

  if (!name || !nickname || !email || !pw) {
    return res.status(400).json({
      ok: false,
      message: '이름, 닉네임, 이메일, 비밀번호를 모두 입력하세요.',
    });
  }

  try {
    const hashed = await bcrypt.hash(pw, 10);
    const normalizedEmail = email.trim().toLowerCase();

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

        const verifyUrl = `${req.protocol}://${req.get(
          'host'
        )}/api/verify-email?token=${token}`;

        res.json({
          ok: true,
          message:
            '입력하신 이메일로 인증 링크를 보냈어요. 메일에서 인증을 완료한 뒤 로그인해 주세요.',
        });

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

// 6-2) 이메일 인증 처리
router.get('/verify-email', (req, res) => {
  const token = req.query.token;

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
router.post('/password-reset-request', (req, res) => {
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

      if (!user) {
        return res.json({
          ok: true,
          message:
            '입력하신 이메일이 등록되어 있다면, 비밀번호 재설정 메일이 발송됩니다.',
        });
      }

      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 1000 * 60 * 60);

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
router.post('/password-reset', async (req, res) => {
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

// 6-5) 로그인
router.post('/login', (req, res) => {
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
        // secure: true, // HTTPS 사용 시
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

// 6-6) 로그아웃
router.post('/logout', (req, res) => {
  res.clearCookie('token', { path: '/' });
  res.json({ ok: true, message: '로그아웃되었습니다.' });
});

// 7-1) 내 정보 조회
router.get('/me', authRequired, (req, res) => {
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

// 7-2) 내 정보 수정
router.put('/me', authRequired, (req, res) => {
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

module.exports = router;
