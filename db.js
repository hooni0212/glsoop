// db.js
// - SQLite3 연결 및 주요 테이블 생성
const sqlite3 = require('sqlite3').verbose();

const db = new sqlite3.Database('data/live/users.db');

db.serialize(() => {
  db.run('PRAGMA foreign_keys = ON');
  db.run('PRAGMA journal_mode = WAL');
  db.run('PRAGMA synchronous = NORMAL');
  db.run('PRAGMA busy_timeout = 5000');

  db.get('PRAGMA journal_mode;', (err, row) => {
    console.log('journal_mode =', row?.journal_mode);
  });
  db.get('PRAGMA foreign_keys;', (err, row) => {
    console.log('foreign_keys =', row?.foreign_keys);
  });  

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

  db.run(`
    CREATE TABLE IF NOT EXISTS otp_verifications (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL,
      code_hash  TEXT NOT NULL,
      expires_at DATETIME NOT NULL,
      attempts   INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS pending_signups (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL,
      nickname   TEXT,
      email      TEXT NOT NULL UNIQUE,
      pw_hash    TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS pending_otp_verifications (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      pending_id INTEGER NOT NULL,
      code_hash  TEXT NOT NULL,
      expires_at DATETIME NOT NULL,
      attempts   INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (pending_id) REFERENCES pending_signups(id) ON DELETE CASCADE
    )
  `);

  // users 확장 컬럼이 없다면 추가 (레벨/XP/스트릭)
  db.all('PRAGMA table_info(users)', (err, columns) => {
    if (err) {
      console.error('users 테이블 스키마 조회 실패:', err);
      return;
    }

    const ensureColumn = (name, ddl) => {
      const hasColumn = Array.isArray(columns)
        ? columns.some((col) => col.name === name)
        : false;
      if (!hasColumn) {
        db.run(`ALTER TABLE users ADD COLUMN ${ddl}`, (alterErr) => {
          if (alterErr) {
            console.error(`users.${name} 컬럼 추가 실패:`, alterErr);
          }
        });
      }
    };

    ensureColumn('level', 'level INTEGER DEFAULT 1');
    ensureColumn('xp', 'xp INTEGER DEFAULT 0');
    ensureColumn('streak_days', 'streak_days INTEGER DEFAULT 0');
    ensureColumn('max_streak_days', 'max_streak_days INTEGER DEFAULT 0');
    ensureColumn('last_post_date', "last_post_date TEXT");
  });

  // 4-2) 글(포스트) 테이블
  // - 작성자(user_id) 기준 외래키로 연결
  db.run(`
    CREATE TABLE IF NOT EXISTS posts (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL,
      title      TEXT NOT NULL,
      content    TEXT NOT NULL,
      category   TEXT DEFAULT 'short',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // 게시글 카테고리(시/에세이/짧은 구절) 컬럼이 없으면 추가
  db.all('PRAGMA table_info(posts)', (err, columns) => {
    if (err) {
      console.error('posts 테이블 스키마 조회 실패:', err);
      return;
    }

    const hasCategory = Array.isArray(columns)
      ? columns.some((col) => col.name === 'category')
      : false;

    if (!hasCategory) {
      db.run(
        "ALTER TABLE posts ADD COLUMN category TEXT DEFAULT 'short'",
        (alterErr) => {
          if (alterErr) {
            console.error('posts.category 컬럼 추가 실패:', alterErr);
          } else {
            db.run(
              "UPDATE posts SET category = 'short' WHERE category IS NULL OR category = ''",
              (updateErr) => {
                if (updateErr) {
                  console.error('기존 posts.category 기본값 설정 실패:', updateErr);
                }
              }
            );
          }
        }
      );
    }
  });

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

  // 4-6) 북마크 폴더(리스트)
  db.run(`
    CREATE TABLE IF NOT EXISTS bookmark_lists (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL,
      name        TEXT NOT NULL,
      description TEXT,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, name),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // 4-7) 북마크 항목 (폴더 안의 글)
  db.run(`
    CREATE TABLE IF NOT EXISTS bookmark_items (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      list_id     INTEGER NOT NULL,
      post_id     INTEGER NOT NULL,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(list_id, post_id),
      FOREIGN KEY (list_id) REFERENCES bookmark_lists(id) ON DELETE CASCADE,
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
    )
  `);

  // 인덱스
  db.run(
    'CREATE INDEX IF NOT EXISTS idx_bookmark_lists_user ON bookmark_lists(user_id)'
  );
  db.run(
    'CREATE INDEX IF NOT EXISTS idx_bookmark_items_list ON bookmark_items(list_id)'
  );
  db.run(
    'CREATE INDEX IF NOT EXISTS idx_bookmark_items_post ON bookmark_items(post_id)'
  );
  db.run(
    'CREATE INDEX IF NOT EXISTS idx_pending_signups_expires ON pending_signups(expires_at)'
  );
  db.run(
    'CREATE INDEX IF NOT EXISTS idx_pending_otp_pending ON pending_otp_verifications(pending_id)'
  );

  // XP 로그: 경험치 변화를 기록
  db.run(`
    CREATE TABLE IF NOT EXISTS xp_log (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL,
      delta      INTEGER NOT NULL,
      reason     TEXT NOT NULL,
      meta       TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);
  db.run('CREATE INDEX IF NOT EXISTS idx_xp_log_user_date ON xp_log(user_id, created_at)');

  // 업적 정의 테이블
  db.run(`
    CREATE TABLE IF NOT EXISTS achievements (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      code           TEXT UNIQUE NOT NULL,
      name           TEXT NOT NULL,
      description    TEXT,
      category       TEXT,
      target_value   INTEGER NOT NULL,
      position_index INTEGER,
      extra_json     TEXT
    )
  `);

  // 사용자 업적 진행도 테이블
  db.run(`
    CREATE TABLE IF NOT EXISTS user_achievements (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id         INTEGER NOT NULL,
      achievement_id  INTEGER NOT NULL,
      progress_value  INTEGER NOT NULL DEFAULT 0,
      unlocked_at     DATETIME,
      UNIQUE(user_id, achievement_id),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (achievement_id) REFERENCES achievements(id)
    )
  `);

  // 업적 시드 데이터 삽입
  const seedAchievements = [
    {
      code: 'first_post',
      name: '첫 걸음',
      description: '첫 글을 작성했습니다.',
      category: 'habit',
      target_value: 1,
      position_index: 1,
      extra_json: JSON.stringify({ icon: '🌱' }),
    },
    {
      code: 'posts_10',
      name: '조심스러운 시작',
      description: '글 10개를 작성했습니다.',
      category: 'count_posts',
      target_value: 10,
      position_index: 2,
      extra_json: JSON.stringify({ icon: '🌿' }),
    },
    {
      code: 'posts_50',
      name: '단단한 나무',
      description: '글 50개를 작성했습니다.',
      category: 'count_posts',
      target_value: 50,
      position_index: 3,
      extra_json: JSON.stringify({ icon: '🌳' }),
    },
    {
      code: 'first_like',
      name: '따뜻한 첫 공감',
      description: '처음으로 공감을 받았습니다.',
      category: 'likes',
      target_value: 1,
      position_index: 4,
      extra_json: JSON.stringify({ icon: '✨' }),
    },
    {
      code: 'likes_10_single',
      name: '공감이 쌓이는 글',
      description: '한 글에 공감을 10개 받았습니다.',
      category: 'likes',
      target_value: 10,
      position_index: 5,
      extra_json: JSON.stringify({ icon: '💙' }),
    },
    {
      code: 'streak_3',
      name: '리듬 찾기',
      description: '3일 연속 글을 작성했습니다.',
      category: 'streak',
      target_value: 3,
      position_index: 6,
      extra_json: JSON.stringify({ icon: '🔥' }),
    },
    {
      code: 'streak_7',
      name: '꾸준한 발걸음',
      description: '7일 연속 글을 작성했습니다.',
      category: 'streak',
      target_value: 7,
      position_index: 7,
      extra_json: JSON.stringify({ icon: '🌠' }),
    },
    {
      code: 'streak_30',
      name: '숲의 주인',
      description: '30일 연속 글을 작성했습니다.',
      category: 'streak',
      target_value: 30,
      position_index: 8,
      extra_json: JSON.stringify({ icon: '🏆' }),
    },
    {
      code: 'first_bookmark',
      name: '첫 보금자리',
      description: '내 글이 처음으로 북마크되었습니다.',
      category: 'bookmark',
      target_value: 1,
      position_index: 9,
      extra_json: JSON.stringify({ icon: '📌' }),
    },
  ];

  seedAchievements.forEach((ach) => {
    db.run(
      `INSERT OR IGNORE INTO achievements
        (code, name, description, category, target_value, position_index, extra_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      [
        ach.code,
        ach.name,
        ach.description,
        ach.category,
        ach.target_value,
        ach.position_index,
        ach.extra_json || null,
      ],
      (seedErr) => {
        if (seedErr) {
          console.error(`업적 시드 삽입 실패 (${ach.code}):`, seedErr);
        }
      }
    );
  });

  // 퀘스트/캠페인 운영 테이블
  db.run(`
    CREATE TABLE IF NOT EXISTS quest_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      condition_type TEXT NOT NULL,
      category TEXT,
      target_value INTEGER NOT NULL,
      reward_xp INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS quest_campaigns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      campaign_type TEXT DEFAULT 'event',
      start_at DATETIME,
      end_at DATETIME,
      is_active INTEGER DEFAULT 0,
      priority INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS quest_campaign_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER NOT NULL,
      template_id INTEGER NOT NULL,
      sort_order INTEGER DEFAULT 0,
      FOREIGN KEY (campaign_id) REFERENCES quest_campaigns(id) ON DELETE CASCADE,
      FOREIGN KEY (template_id) REFERENCES quest_templates(id) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS user_quest_state (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      campaign_id INTEGER NOT NULL,
      template_id INTEGER NOT NULL,
      progress INTEGER DEFAULT 0,
      reset_key TEXT,
      completed_at DATETIME,
      UNIQUE(user_id, campaign_id, template_id, reset_key),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (campaign_id) REFERENCES quest_campaigns(id),
      FOREIGN KEY (template_id) REFERENCES quest_templates(id)
    )
  `);
});

  // ✅ posts (피드/작성자별 목록)
  db.run('CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at)');
  db.run('CREATE INDEX IF NOT EXISTS idx_posts_user_created ON posts(user_id, created_at)');
  db.run('CREATE INDEX IF NOT EXISTS idx_posts_category_created ON posts(category, created_at)');

  // ✅ likes (좋아요 수 집계 / 내가 누른 글)
  db.run('CREATE INDEX IF NOT EXISTS idx_likes_post ON likes(post_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_likes_user_created ON likes(user_id, created_at)');

  // ✅ follows (팔로워 목록 조회)
  db.run('CREATE INDEX IF NOT EXISTS idx_follows_followee ON follows(followee_id)');

  // ✅ post_hashtags (태그 조회 + 중복 방지)
  db.run('CREATE UNIQUE INDEX IF NOT EXISTS uq_post_hashtags ON post_hashtags(post_id, hashtag_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_post_hashtags_tag ON post_hashtags(hashtag_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_post_hashtags_post ON post_hashtags(post_id)');

  // ✅ user_achievements / quest (마이페이지 위젯이 자주 치면 필요)
  db.run('CREATE INDEX IF NOT EXISTS idx_user_ach_user ON user_achievements(user_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_user_quest_user_campaign ON user_quest_state(user_id, campaign_id, reset_key)');


module.exports = db;
