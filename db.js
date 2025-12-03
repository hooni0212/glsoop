// db.js
const sqlite3 = require('sqlite3').verbose();

const db = new sqlite3.Database('users.db');

db.serialize(() => {
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

  // 4-3) 좋아요 테이블
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

  // 4-5) 게시글-해시태그 매핑
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
