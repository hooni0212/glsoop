// db.js
// - SQLite3 연결 및 주요 테이블 생성
const sqlite3 = require('sqlite3').verbose();

const db = new sqlite3.Database('users.db');

db.serialize(() => {
  // 4-1) 사용자 정보 테이블
  // - 인증 상태, 비밀번호 해시, 이메일 인증/비밀번호 초기화 토큰을 모두 관리
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
  // - 작성자(user_id) 기준 외래키로 연결
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

  // 4-3) 좋아요 테이블
  // - 복합 PK(user_id, post_id)로 중복 좋아요 방지
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

  // 4-3-1) 팔로우 테이블
  // - 팔로워/팔로이 관계를 1행으로 표현 (중복 팔로우 방지)
  db.run(`
    CREATE TABLE IF NOT EXISTS follows (
      follower_id INTEGER NOT NULL,
      followee_id INTEGER NOT NULL,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (follower_id, followee_id),
      FOREIGN KEY (follower_id) REFERENCES users(id),
      FOREIGN KEY (followee_id) REFERENCES users(id)
    )
  `);

  // 4-4) 해시태그 목록
  // - 중복 해시태그 이름을 막기 위해 UNIQUE 제약 포함
  db.run(`
    CREATE TABLE IF NOT EXISTS hashtags (
      id   INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE
    )
  `);

  // 4-5) 게시글-해시태그 매핑
  // - 게시글과 해시태그 사이의 다대다 관계를 표현
  db.run(`
    CREATE TABLE IF NOT EXISTS post_hashtags (
      post_id    INTEGER NOT NULL,
      hashtag_id INTEGER NOT NULL,
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
      FOREIGN KEY (hashtag_id) REFERENCES hashtags(id) ON DELETE CASCADE
    )
  `);
});

module.exports = db;
