// server.js
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

// ================== 이메일 전송 설정 ==================
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS,
  },
});

// .env로 빼두기 완료.
const JWT_SECRET = process.env.JWT_SECRET || 'DEV_ONLY_FALLBACK_SECRET';


// ================== 미들웨어 ==================
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());

// 정적 파일 제공 (public 폴더)
app.use(express.static(path.join(__dirname, 'public')));

// ================== DB 연결 및 테이블 생성 ==================
const db = new sqlite3.Database('users.db');

// users 테이블
db.run(`
  CREATE TABLE IF NOT EXISTS users (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    name      TEXT NOT NULL,
    nickname  TEXT,                -- ✅ 닉네임 컬럼 추가
    email     TEXT NOT NULL UNIQUE,
    pw        TEXT NOT NULL,
    is_admin  INTEGER DEFAULT 0,
    is_verified INTEGER DEFAULT 0,
    verification_token TEXT,
    verification_expires DATETIME
  )
`);

// posts 테이블
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

// likes 테이블 (user별로 한 번만 공감 가능)
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

// ================== JWT 인증 미들웨어 ==================
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
    // decoded: { id, name, email, isAdmin, isVerified, iat, exp }
    req.user = decoded;
    next();
  });
}

// 관리자 전용 체크 미들웨어
function adminRequired(req, res, next) {
  if (!req.user || !req.user.isAdmin) {
    return res
      .status(403)
      .json({ ok: false, message: '관리자만 접근할 수 있습니다.' });
  }
  next();
}

// ================== 회원가입 / 이메일 인증 / 로그인 / 로그아웃 ==================

/**
 * 회원가입
 * POST /api/signup
 * body: { name, email, pw }
 * → DB에 is_verified = 0 상태로 저장 후 인증 메일 발송
 */
app.post('/api/signup', async (req, res) => {
  const { name, email, pw } = req.body;

  if (!name || !email || !pw) {
    return res
      .status(400)
      .json({ ok: false, message: '이름, 이메일, 비밀번호를 모두 입력하세요.' });
  }

  try {
    // 비밀번호 해시
    const hashed = await bcrypt.hash(pw, 10);

    // 인증 토큰 & 만료 시간 생성 (1시간 유효)
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60).toISOString();

    db.run(
      `
      INSERT INTO users (name, email, pw, is_admin, is_verified, verification_token, verification_expires)
      VALUES (?, ?, ?, 0, 0, ?, ?)
      `,
      [name, email, hashed, token, expiresAt],
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

        // 가입은 DB에 저장됐고, 이제 인증 메일 발송
        const verifyUrl =
          `${req.protocol}://${req.get('host')}/api/verify-email?token=${token}`;

        transporter.sendMail(
          {
            from: `"글숲" <${process.env.GMAIL_USER}>`, // ✅ 실제 발신 계정과 일치시키기
            to: email,
            subject: '[글숲] 이메일 인증을 완료해주세요',
            html: `
              <div style="font-family: 'Noto Sans KR', sans-serif; line-height: 1.6;">
                <p><strong>${name}님, 안녕하세요.</strong></p>
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
              console.error(mailErr);
              return res.status(500).json({
                ok: false,
                message:
                  '회원 정보는 생성되었지만, 인증 메일 발송 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
              });
            }

            return res.json({
              ok: true,
              message:
                '입력하신 이메일로 인증 링크를 보냈어요. 메일에서 인증을 완료한 뒤 로그인해 주세요.',
            });
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

/**
 * 이메일 인증
 * GET /api/verify-email?token=...
 * → 토큰 확인 후 is_verified = 1로 업데이트
 */
app.get('/api/verify-email', (req, res) => {
  const { token } = req.query;

  if (!token) {
    return res
      .status(400)
      .send('<h3>잘못된 요청입니다. 토큰이 없습니다.</h3>');
  }

  db.get(
    'SELECT * FROM users WHERE verification_token = ?',
    [token],
    (err, user) => {
      if (err) {
        console.error(err);
        return res
          .status(500)
          .send('<h3>서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요.</h3>');
      }

      if (!user) {
        return res
          .status(400)
          .send('<h3>유효하지 않은 토큰입니다. 이미 인증이 완료되었거나, 잘못된 링크입니다.</h3>');
      }

      // 만료 시간 체크
      if (user.verification_expires) {
        const now = Date.now();
        const expiresTime = new Date(user.verification_expires).getTime();
        if (expiresTime < now) {
          return res
            .status(400)
            .send('<h3>인증 링크가 만료되었습니다. 다시 회원가입을 진행해주세요.</h3>');
        }
      }

      db.run(
        `
        UPDATE users
        SET is_verified = 1,
            verification_token = NULL,
            verification_expires = NULL
        WHERE id = ?
        `,
        [user.id],
        function (updateErr) {
          if (updateErr) {
            console.error(updateErr);
            return res
              .status(500)
              .send('<h3>인증 처리 중 오류가 발생했습니다.</h3>');
          }

          // 간단한 완료 페이지 응답
          return res.send(`
            <html lang="ko">
              <head>
                <meta charset="UTF-8" />
                <title>이메일 인증 완료 | 글숲</title>
              </head>
              <body style="font-family: -apple-system,BlinkMacSystemFont,'Noto Sans KR',sans-serif;">
                <div style="max-width:480px;margin:60px auto;text-align:center;">
                  <h2>이메일 인증이 완료되었습니다 ✅</h2>
                  <p>이제 로그인하실 수 있어요.</p>
                  <p style="margin-top:24px;">
                    <a href="/html/login.html"
                       style="display:inline-block;padding:10px 18px;
                              background:#2e8b57;color:#fff;
                              text-decoration:none;border-radius:6px;">
                      로그인 하러 가기
                    </a>
                  </p>
                </div>
              </body>
            </html>
          `);
        }
      );
    }
  );
});

/**
 * 로그인
 * POST /api/login
 * body: { email, pw }
 * 성공 시 httpOnly 쿠키에 JWT 저장
 */
app.post('/api/login', (req, res) => {
  const { email, pw } = req.body;

  if (!email || !pw) {
    return res
      .status(400)
      .json({ ok: false, message: '이메일과 비밀번호를 입력하세요.' });
  }

  db.get('SELECT * FROM users WHERE email = ?', [email], async (err, user) => {
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

    // ✅ 이메일 인증 여부 체크
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
        email: user.email,
        isAdmin: !!user.is_admin,      // 관리자 여부
        isVerified: !!user.is_verified // 토큰에도 인증 여부 포함
      },
      JWT_SECRET,
      { expiresIn: '2h' }
    );

    // httpOnly 쿠키에 JWT 저장
    res.cookie('token', token, {
      httpOnly: true,
      sameSite: 'lax',
      // secure: true, // HTTPS 환경에서만 사용할 경우
      path: '/',
    });

    return res.json({
      ok: true,
      message: `환영합니다, ${user.name}님!`,
      name: user.name,
    });
  });
});

/**
 * 로그아웃
 * POST /api/logout
 */
app.post('/api/logout', (req, res) => {
  res.clearCookie('token', { path: '/' });
  res.json({ ok: true, message: '로그아웃되었습니다.' });
});

// ================== 사용자 정보 ==================

/**
 * 내 정보 확인 (헤더 토글 / 마이페이지 / 관리자 페이지용)
 * GET /api/me
 */
app.get('/api/me', authRequired, (req, res) => {
  const { id, name, email, isAdmin, isVerified } = req.user;
  res.json({
    ok: true,
    id,
    name,
    email,
    isAdmin: !!isAdmin,
    isVerified: !!isVerified,
  });
});

// ================== 글 관련 API ==================

/**
 * 글 작성 (저장)
 * POST /api/posts
 * body: { title, content }
 * 로그인 필요
 */
app.post('/api/posts', authRequired, (req, res) => {
  const { title, content } = req.body;
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

      return res.json({
        ok: true,
        message: '글이 저장되었습니다.',
        postId: this.lastID,
      });
    }
  );
});

/**
 * 글 수정 (작성자 또는 관리자)
 * PUT /api/posts/:id
 * body: { title, content }
 */
app.put('/api/posts/:id', authRequired, (req, res) => {
  const postId = req.params.id;
  const { title, content } = req.body;
  const userId = req.user.id;
  const isAdmin = !!req.user.isAdmin;

  if (!title || !content) {
    return res
      .status(400)
      .json({ ok: false, message: '제목과 내용을 모두 입력하세요.' });
  }

  // 먼저 글의 작성자 확인
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

    // 작성자 본인 또는 관리자만 수정 허용
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

        return res.json({
          ok: true,
          message: '글이 수정되었습니다.',
        });
      }
    );
  });
});

/**
 * 내가 쓴 글 목록 (마이페이지)
 * GET /api/posts/my
 * 로그인 필요
 */
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

/**
 * 공개 피드: 모든 사용자의 글을 최신순으로 반환
 * GET /api/posts/feed
 * 로그인 필요 없음 (단, 로그인 되어 있으면 내가 공감 눌렀는지까지 포함)
 */
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

  let sql;
  let params = [];

  if (userId) {
    // 🔹 로그인한 경우: 닉네임 + 이메일 + 좋아요 정보
    sql = `
      SELECT
        p.id,
        p.title,
        p.content,
        p.created_at,
        u.name     AS author_name,
        u.nickname AS author_nickname,
        u.email    AS author_email,
        (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS like_count,
        CASE
          WHEN EXISTS (
            SELECT 1 FROM likes l2
            WHERE l2.post_id = p.id AND l2.user_id = ?
          ) THEN 1
          ELSE 0
        END AS user_liked
      FROM posts p
      JOIN users u ON p.user_id = u.id
      ORDER BY p.created_at DESC
      LIMIT 50
    `;
    params = [userId];
  } else {
    // 🔹 비로그인: 닉네임 + 이메일 + 좋아요 수만
    sql = `
      SELECT
        p.id,
        p.title,
        p.content,
        p.created_at,
        u.name     AS author_name,
        u.nickname AS author_nickname,
        u.email    AS author_email,
        (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS like_count,
        0 AS user_liked
      FROM posts p
      JOIN users u ON p.user_id = u.id
      ORDER BY p.created_at DESC
      LIMIT 50
    `;
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
    });
  });
});

/**
 * 글 상세 조회
 * GET /api/posts/:id
 * 로그인 필요, 자기 글만 조회 가능 (편집용)
 */
app.get('/api/posts/:id', authRequired, (req, res) => {
  const postId = req.params.id;
  const userId = req.user.id;

  db.get(
    `
    SELECT p.id, p.title, p.content, p.created_at
    FROM posts p
    WHERE p.id = ? AND p.user_id = ?
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

      return res.json({
        ok: true,
        post: row,
      });
    }
  );
});

/**
 * 글 삭제 (작성자 또는 관리자)
 * DELETE /api/posts/:id
 */
app.delete('/api/posts/:id', authRequired, (req, res) => {
  const postId = req.params.id;
  const userId = req.user.id;
  const isAdmin = !!req.user.isAdmin;

  // 먼저 글의 작성자 확인
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

    // 작성자 본인 또는 관리자만 삭제 허용
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

/**
 * 공감 토글 (좋아요/좋아요 취소)
 * POST /api/posts/:id/toggle-like
 * 로그인 필요
 */
app.post('/api/posts/:id/toggle-like', authRequired, (req, res) => {
  const postId = req.params.id;
  const userId = req.user.id;

  // 1. 이미 좋아요 했는지 확인
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
        // 이미 좋아요 되어 있으면 → 좋아요 취소
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

            // 최신 좋아요 수 다시 조회
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
        // 아직 좋아요 안 되어 있으면 → 좋아요 추가
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

            // 최신 좋아요 수 다시 조회
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

/**
 * 관리자용: 회원 목록 조회
 * GET /api/admin/users
 * (관리자만 접근 가능)
 */
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

/**
 * 관리자용: 회원 삭제
 * DELETE /api/admin/users/:id
 * (관리자만 접근 가능)
 * - 해당 회원의 좋아요 + 게시글 + 계정 삭제
 */
app.delete('/api/admin/users/:id', authRequired, adminRequired, (req, res) => {
  const targetUserId = req.params.id;

  // 본인을 삭제하는 경우를 막고 싶으면 여기서 체크 가능 (원하면 추가)
  // if (Number(targetUserId) === req.user.id) { ... }

  db.serialize(() => {
    // 1) 이 유저가 남긴 좋아요 삭제
    db.run(
      'DELETE FROM likes WHERE user_id = ?',
      [targetUserId],
      function (err1) {
        if (err1) {
          console.error(err1);
          return res
            .status(500)
            .json({ ok: false, message: '회원 좋아요 삭제 중 오류가 발생했습니다.' });
        }

        // 2) 이 유저의 글에 달린 좋아요 삭제
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
                message: '회원 게시글의 좋아요 삭제 중 오류가 발생했습니다.',
              });
            }

            // 3) 이 유저의 게시글 삭제
            db.run(
              'DELETE FROM posts WHERE user_id = ?',
              [targetUserId],
              function (err3) {
                if (err3) {
                  console.error(err3);
                  return res
                    .status(500)
                    .json({ ok: false, message: '회원 게시글 삭제 중 오류가 발생했습니다.' });
                }

                // 4) 마지막으로 유저 계정 삭제
                db.run(
                  'DELETE FROM users WHERE id = ?',
                  [targetUserId],
                  function (err4) {
                    if (err4) {
                      console.error(err4);
                      return res
                        .status(500)
                        .json({ ok: false, message: '회원 삭제 중 DB 오류가 발생했습니다.' });
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
});

// ================== 루트 → index.html ==================
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ================== 서버 시작 ==================
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
