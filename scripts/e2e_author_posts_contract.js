const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');

const rootDir = path.resolve(__dirname, '..');
const dataDir = path.join(rootDir, 'data', 'test');
const dbPath = path.join(dataDir, 'author-posts-e2e.sqlite');
const port = 3102;
const baseUrl = `http://localhost:${port}`;
const authorId = 7101;
const viewerId = 7102;

function ensureCleanFile(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

function waitForServer(url, timeoutMs = 15000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = async () => {
      try {
        const res = await fetch(url, { method: 'GET' });
        if (res.ok) return resolve();
      } catch {}
      if (Date.now() - startedAt > timeoutMs) {
        return reject(new Error('Server did not become ready in time'));
      }
      setTimeout(attempt, 500);
    };
    attempt();
  });
}

function openDb() {
  return new sqlite3.Database(dbPath);
}

function runDb(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

async function seedUsersAndPosts() {
  const db = openDb();
  const pw = await bcrypt.hash('Pass1234!', 10);

  await runDb(
    db,
    `INSERT INTO users (id, name, nickname, email, pw, is_admin, is_verified)
     VALUES (?, ?, ?, ?, ?, 0, 1)`,
    [authorId, 'Author User', 'author_user', 'author-user@glsoop.test', pw]
  );
  await runDb(
    db,
    `INSERT INTO users (id, name, nickname, email, pw, is_admin, is_verified)
     VALUES (?, ?, ?, ?, ?, 0, 1)`,
    [viewerId, 'Viewer User', 'viewer_user', 'viewer-user@glsoop.test', pw]
  );

  const posts = [
    {
      id: 901,
      title: '첫 번째 글',
      content: 'alpha',
      category: 'short',
      created_at: '2026-03-20T10:00:00.000Z',
    },
    {
      id: 902,
      title: '두 번째 글',
      content: 'beta',
      category: 'essay',
      created_at: '2026-03-21T10:00:00.000Z',
    },
    {
      id: 903,
      title: '세 번째 글',
      content: 'gamma',
      category: 'poem',
      created_at: '2026-03-22T10:00:00.000Z',
    },
  ];

  for (const post of posts) {
    await runDb(
      db,
      `INSERT INTO posts (id, user_id, title, content, category, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [post.id, authorId, post.title, post.content, post.category, post.created_at]
    );
  }

  await runDb(db, `INSERT INTO likes (user_id, post_id) VALUES (?, ?)`, [viewerId, 901]);
  await runDb(db, `INSERT INTO likes (user_id, post_id) VALUES (?, ?)`, [authorId, 901]);
  await runDb(db, `INSERT INTO likes (user_id, post_id) VALUES (?, ?)`, [viewerId, 902]);

  await new Promise((resolve) => db.close(resolve));
}

async function assertJson(url, expectedMessage) {
  const res = await fetch(url);
  const body = await res.json();
  if (!res.ok || body?.ok !== true) {
    throw new Error(`${expectedMessage}: ${JSON.stringify(body)}`);
  }
  return body;
}

async function main() {
  ensureCleanFile(dbPath);

  const server = spawn('node', ['server.js'], {
    cwd: rootDir,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      PORT: String(port),
      BASE_URL: baseUrl,
      DB_PATH: dbPath,
      DB_AUTOINIT: 'false',
      JWT_SECRET: process.env.JWT_SECRET || 'dev_only_test_secret',
      GMAIL_USER: process.env.GMAIL_USER || 'test@example.com',
      GMAIL_PASS: process.env.GMAIL_PASS || 'test',
      CORS_ALLOWED_HOSTS: 'localhost,127.0.0.1',
    },
    stdio: 'inherit',
  });

  try {
    await waitForServer(baseUrl);
    await seedUsersAndPosts();

    const newest = await assertJson(
      `${baseUrl}/api/users/${authorId}/posts?limit=2&offset=0&sort=newest`,
      'newest failed'
    );
    if (newest.posts[0]?.id !== 903 || newest.posts[1]?.id !== 902) {
      throw new Error(`newest order mismatch: ${JSON.stringify(newest.posts.map((p) => p.id))}`);
    }
    if (newest.has_more !== true) {
      throw new Error('newest has_more mismatch');
    }

    const nextPage = await assertJson(
      `${baseUrl}/api/users/${authorId}/posts?limit=2&offset=2&sort=newest`,
      'next page failed'
    );
    if (nextPage.posts.length !== 1 || nextPage.posts[0]?.id !== 901) {
      throw new Error(`next page mismatch: ${JSON.stringify(nextPage.posts.map((p) => p.id))}`);
    }
    if (nextPage.has_more !== false) {
      throw new Error('next page has_more mismatch');
    }

    const oldest = await assertJson(
      `${baseUrl}/api/users/${authorId}/posts?limit=3&offset=0&sort=oldest`,
      'oldest failed'
    );
    if (oldest.posts[0]?.id !== 901 || oldest.posts[2]?.id !== 903) {
      throw new Error(`oldest order mismatch: ${JSON.stringify(oldest.posts.map((p) => p.id))}`);
    }

    const likes = await assertJson(
      `${baseUrl}/api/users/${authorId}/posts?limit=3&offset=0&sort=likes`,
      'likes failed'
    );
    if (likes.posts[0]?.id !== 901 || likes.posts[1]?.id !== 902) {
      throw new Error(`likes order mismatch: ${JSON.stringify(likes.posts.map((p) => p.id))}`);
    }

    console.log('PASS: author posts contract verified');
  } finally {
    server.kill('SIGINT');
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('FAIL:', error.message || error);
    process.exit(1);
  });
