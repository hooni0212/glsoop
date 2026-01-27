import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn, execSync } from 'child_process';
import bcrypt from 'bcrypt';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const dbPath = path.join(repoRoot, 'tmp', 'phase2_verify.sqlite');
const reportPath = path.join(repoRoot, 'reports', 'phase2-verify.md');
const port = Number(process.env.PHASE2_VERIFY_PORT || 4010);
const jwtSecret = process.env.JWT_SECRET || 'phase2_verify_secret_key_1234567890';
const serverEnv = {
  ...process.env,
  PORT: String(port),
  DB_PATH: dbPath,
  NODE_ENV: 'development',
  JWT_SECRET: jwtSecret,
  DB_AUTOINIT: 'false',
};

const results = [];
const evidence = [];

function formatStatus(pass) {
  return pass ? 'O' : 'X';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getDb() {
  return require('../db');
}

function dbRun(sql, params = []) {
  const db = getDb();
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

function dbGet(sql, params = []) {
  const db = getDb();
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}


async function resetDbFile() {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  if (fs.existsSync(dbPath)) {
    fs.rmSync(dbPath);
  }
}

async function runMigrations() {
  process.env.DB_PATH = dbPath;
  process.env.NODE_ENV = 'development';
  process.env.JWT_SECRET = jwtSecret;
  const { runMigrations } = require('../utils/migrations');
  await runMigrations();
}

async function seedUsers() {
  const password = 'Passw0rd!';
  const hash = await bcrypt.hash(password, 10);
  const admin = await dbRun(
    `INSERT INTO users (name, nickname, email, pw, is_admin, is_verified, level, xp)
     VALUES (?, ?, ?, ?, 1, 1, 1, 0)`,
    ['Admin', 'admin', 'admin@example.com', hash]
  );
  const userA = await dbRun(
    `INSERT INTO users (name, nickname, email, pw, is_admin, is_verified, level, xp)
     VALUES (?, ?, ?, ?, 0, 1, 1, 0)`,
    ['UserA', 'usera', 'usera@example.com', hash]
  );
  const userB = await dbRun(
    `INSERT INTO users (name, nickname, email, pw, is_admin, is_verified, level, xp)
     VALUES (?, ?, ?, ?, 0, 1, 1, 0)`,
    ['UserB', 'userb', 'userb@example.com', hash]
  );
  return {
    password,
    adminId: admin.lastID,
    userAId: userA.lastID,
    userBId: userB.lastID,
  };
}

async function waitForServerReady() {
  const baseUrl = `http://localhost:${port}`;
  for (let i = 0; i < 30; i += 1) {
    try {
      const res = await fetch(baseUrl, { method: 'GET' });
      if (res.ok) return;
    } catch (error) {
      // ignore
    }
    await sleep(300);
  }
  throw new Error('Server did not become ready in time');
}

async function login(email, password) {
  const res = await fetch(`http://localhost:${port}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, pw: password }),
  });
  const data = await res.json();
  return { res, data };
}

async function apiFetch(url, token, options = {}) {
  const headers = {
    ...(options.headers || {}),
    Authorization: `Bearer ${token}`,
  };
  return fetch(url, { ...options, headers });
}

function recordResult(id, title, pass, detail, hint) {
  results.push({ id, title, pass, detail, hint });
}

async function main() {
  await resetDbFile();
  await runMigrations();
  const users = await seedUsers();

  const server = spawn('node', ['server.js'], {
    cwd: repoRoot,
    env: serverEnv,
    stdio: 'pipe',
  });

  server.stdout.on('data', (data) => {
    evidence.push({ title: 'server stdout', detail: data.toString() });
  });
  server.stderr.on('data', (data) => {
    evidence.push({ title: 'server stderr', detail: data.toString() });
  });

  try {
    await waitForServerReady();

    const adminLogin = await login('admin@example.com', users.password);
    const userALogin = await login('usera@example.com', users.password);
    const userBLogin = await login('userb@example.com', users.password);

    if (!adminLogin.data?.token || !userALogin.data?.token || !userBLogin.data?.token) {
      throw new Error('Login failed for seeded users.');
    }

    const adminToken = adminLogin.data.token;
    const userAToken = userALogin.data.token;
    const userBToken = userBLogin.data.token;

    getDb();

    // (1) achievement template auto attach
    let achievementTemplateId = null;
    try {
      const res = await apiFetch(`http://localhost:${port}/api/admin/quest-templates`, adminToken, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: '테스트 업적',
          description: '업적 템플릿 테스트',
          condition_type: 'POST_COUNT_TOTAL',
          target_value: 1,
          reward_xp: 10,
          template_kind: 'achievement',
          code: 'ach_test_auto',
          ui_json: JSON.stringify({ icon: '🏆', label: '업적' }),
          is_active: 1,
        }),
      });
      const data = await res.json();
      achievementTemplateId = data?.template_id;
      const campaign = await dbGet(
        "SELECT id FROM quest_campaigns WHERE campaign_type = 'permanent' AND name = '업적' LIMIT 1"
      );
      const link = await dbGet(
        'SELECT COUNT(*) as cnt FROM quest_campaign_items WHERE campaign_id = ? AND template_id = ?',
        [campaign?.id, achievementTemplateId]
      );
      const pass = Boolean(campaign?.id) && (link?.cnt || 0) > 0;
      recordResult(
        1,
        '관리자: 업적 템플릿 생성 시 자동 연결',
        pass,
        `campaign_id=${campaign?.id}, link_count=${link?.cnt || 0}`,
        'adminRoutes POST /quest-templates의 achievement 분기에서 캠페인 보장 + 링크 생성 로직 확인'
      );
    } catch (error) {
      recordResult(1, '관리자: 업적 템플릿 생성 시 자동 연결', false, error.message, 'adminRoutes POST /quest-templates 분기 확인');
    }

    // (2) template kind update + link removal
    let transitionTemplateId = null;
    try {
      const createRes = await apiFetch(`http://localhost:${port}/api/admin/quest-templates`, adminToken, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: '전환 템플릿',
          description: '전환 테스트',
          condition_type: 'POST_COUNT_TOTAL',
          target_value: 1,
          reward_xp: 5,
          template_kind: 'quest',
          code: 'transition_test',
          is_active: 1,
        }),
      });
      const createData = await createRes.json();
      transitionTemplateId = createData?.template_id;

      const promoteRes = await apiFetch(`http://localhost:${port}/api/admin/quest-templates/${transitionTemplateId}`, adminToken, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: '전환 템플릿',
          description: '전환 테스트',
          condition_type: 'POST_COUNT_TOTAL',
          target_value: 1,
          reward_xp: 5,
          template_kind: 'achievement',
          code: 'transition_test',
          is_active: 1,
        }),
      });
      await promoteRes.json();

      const campaign = await dbGet(
        "SELECT id FROM quest_campaigns WHERE campaign_type = 'permanent' AND name = '업적' LIMIT 1"
      );
      const linkAfterPromotion = await dbGet(
        'SELECT COUNT(*) as cnt FROM quest_campaign_items WHERE campaign_id = ? AND template_id = ?',
        [campaign?.id, transitionTemplateId]
      );

      const demoteRes = await apiFetch(`http://localhost:${port}/api/admin/quest-templates/${transitionTemplateId}`, adminToken, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: '전환 템플릿',
          description: '전환 테스트',
          condition_type: 'POST_COUNT_TOTAL',
          target_value: 1,
          reward_xp: 5,
          template_kind: 'quest',
          code: 'transition_test',
          is_active: 1,
        }),
      });
      await demoteRes.json();

      const linkAfterDemotion = await dbGet(
        'SELECT COUNT(*) as cnt FROM quest_campaign_items WHERE campaign_id = ? AND template_id = ?',
        [campaign?.id, transitionTemplateId]
      );

      const pass = (linkAfterPromotion?.cnt || 0) > 0 && (linkAfterDemotion?.cnt || 0) === 0;
      recordResult(
        2,
        '관리자: 템플릿 수정 시 업적 연결/해제',
        pass,
        `promotion_links=${linkAfterPromotion?.cnt || 0}, demotion_links=${linkAfterDemotion?.cnt || 0}`,
        'adminRoutes PUT /quest-templates에서 template_kind 변경 시 캠페인 링크 업데이트 확인'
      );
    } catch (error) {
      recordResult(2, '관리자: 템플릿 수정 시 업적 연결/해제', false, error.message, 'adminRoutes PUT /quest-templates 분기 확인');
    }

    // (3) delete removes links
    try {
      if (!transitionTemplateId) throw new Error('transition template missing');
      const delRes = await apiFetch(`http://localhost:${port}/api/admin/quest-templates/${transitionTemplateId}`, adminToken, {
        method: 'DELETE',
      });
      await delRes.json();
      const linkAfterDelete = await dbGet(
        'SELECT COUNT(*) as cnt FROM quest_campaign_items WHERE template_id = ?',
        [transitionTemplateId]
      );
      const pass = (linkAfterDelete?.cnt || 0) === 0;
      recordResult(
        3,
        '관리자: 템플릿 삭제 시 링크 정리',
        pass,
        `link_count=${linkAfterDelete?.cnt || 0}`,
        'adminRoutes DELETE /quest-templates에서 quest_campaign_items 정리 확인'
      );
    } catch (error) {
      recordResult(3, '관리자: 템플릿 삭제 시 링크 정리', false, error.message, 'adminRoutes DELETE /quest-templates 확인');
    }

    // (4) active quest payload fields
    let activePayload = null;
    try {
      const res = await apiFetch(`http://localhost:${port}/api/quests/active`, userAToken, {
        method: 'GET',
      });
      const data = await res.json();
      activePayload = data;
      const quests = (data.campaigns || []).flatMap((c) => c.quests || []);
      const requiredKeys = ['state_id', 'template_kind', 'code', 'completed_at', 'reward_claimed_at'];
      const uiKeyOk = quests.every((q) => 'ui_json' in q || 'ui' in q);
      const requiredOk = quests.length > 0 && quests.every((q) => requiredKeys.every((key) => key in q));
      const pass = requiredOk && uiKeyOk;
      recordResult(
        4,
        'Active API: 새 필드 포함 + 기존 기능 유지',
        pass,
        `quest_count=${quests.length}, required_ok=${requiredOk}, ui_ok=${uiKeyOk}`,
        'routes/growthRoutes.js의 active quests payload 매핑 확인'
      );
    } catch (error) {
      recordResult(4, 'Active API: 새 필드 포함 + 기존 기능 유지', false, error.message, 'routes/growthRoutes.js 매핑 확인');
    }

    // (5) eager assignment forbidden
    try {
      const countBefore = await dbGet(
        `SELECT COUNT(*) as cnt
         FROM user_quest_state uqs
         JOIN quest_templates qt ON qt.id = uqs.template_id
         WHERE qt.template_kind = 'achievement' AND uqs.user_id = ? AND uqs.progress = 0`,
        [users.userBId]
      );

      await apiFetch(`http://localhost:${port}/api/growth/summary`, userBToken, { method: 'GET' });

      const countAfter = await dbGet(
        `SELECT COUNT(*) as cnt
         FROM user_quest_state uqs
         JOIN quest_templates qt ON qt.id = uqs.template_id
         WHERE qt.template_kind = 'achievement' AND uqs.user_id = ? AND uqs.progress = 0`,
        [users.userBId]
      );
      const pass = (countBefore?.cnt || 0) === 0 && (countAfter?.cnt || 0) === 0;
      recordResult(
        5,
        '업적 Eager assignment 금지',
        pass,
        `before=${countBefore?.cnt || 0}, after=${countAfter?.cnt || 0}`,
        'questService syncUserQuestState에서 초기 insert 조건 확인'
      );
    } catch (error) {
      recordResult(5, '업적 Eager assignment 금지', false, error.message, 'questService syncUserQuestState 확인');
    }

    // setup posts for completion
    await dbRun(
      `INSERT INTO posts (user_id, title, content, category)
       VALUES (?, '테스트', '테스트 내용', 'short')`,
      [users.userAId]
    );

    const userAActive = await apiFetch(`http://localhost:${port}/api/quests/active`, userAToken, {
      method: 'GET',
    });
    const userAData = await userAActive.json();
    const userAQuest = (userAData.campaigns || [])
      .flatMap((c) => c.quests || [])
      .find((q) => q.template_kind === 'achievement');

    const userBActive = await apiFetch(`http://localhost:${port}/api/quests/active`, userBToken, {
      method: 'GET',
    });
    const userBData = await userBActive.json();
    const userBQuest = (userBData.campaigns || [])
      .flatMap((c) => c.quests || [])
      .find((q) => q.template_kind === 'achievement');

    // (6) claim validation
    try {
      if (!userAQuest?.state_id || !userBQuest?.state_id) {
        throw new Error('Missing achievement quest state for claim validation.');
      }
      const otherClaim = await apiFetch(
        `http://localhost:${port}/api/quests/${userBQuest.state_id}/claim`,
        userAToken,
        { method: 'POST' }
      );
      const otherPass = [403, 404].includes(otherClaim.status);

      const incompleteClaim = await apiFetch(
        `http://localhost:${port}/api/quests/${userBQuest.state_id}/claim`,
        userBToken,
        { method: 'POST' }
      );
      const incompletePass = incompleteClaim.status === 400;

      const firstClaim = await apiFetch(
        `http://localhost:${port}/api/quests/${userAQuest.state_id}/claim`,
        userAToken,
        { method: 'POST' }
      );
      const firstClaimData = await firstClaim.json();
      const firstPass = firstClaim.ok && firstClaimData.ok;

      const secondClaim = await apiFetch(
        `http://localhost:${port}/api/quests/${userAQuest.state_id}/claim`,
        userAToken,
        { method: 'POST' }
      );
      const secondPass = secondClaim.status === 409;

      const pass = otherPass && incompletePass && firstPass && secondPass;
      recordResult(
        6,
        'Claim API: 권한/상태 검증',
        pass,
        `other=${otherClaim.status}, incomplete=${incompleteClaim.status}, second=${secondClaim.status}`,
        'routes/growthRoutes.js claim handler의 user_id/상태 체크 확인'
      );
    } catch (error) {
      recordResult(
        6,
        'Claim API: 권한/상태 검증',
        false,
        error.message,
        'routes/growthRoutes.js claim handler 확인'
      );
    }

    // (7) claim concurrency
    let concurrentStateId = null;
    try {
      const res = await apiFetch(`http://localhost:${port}/api/admin/quest-templates`, adminToken, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: '동시성 업적',
          description: '동시성 테스트',
          condition_type: 'POST_COUNT_TOTAL',
          target_value: 1,
          reward_xp: 7,
          template_kind: 'achievement',
          code: 'ach_concurrent',
          is_active: 1,
        }),
      });
      const data = await res.json();
      if (!data?.template_id) {
        throw new Error('Failed to create concurrent achievement template.');
      }

      const refresh = await apiFetch(`http://localhost:${port}/api/quests/active`, userAToken, { method: 'GET' });
      const refreshData = await refresh.json();
      const quest = (refreshData.campaigns || [])
        .flatMap((c) => c.quests || [])
        .find((q) => q.code === 'ach_concurrent');
      concurrentStateId = quest?.state_id;
      if (!concurrentStateId) {
        throw new Error('Missing concurrent stateId.');
      }
      const beforeXp = await dbGet('SELECT xp FROM users WHERE id = ?', [users.userAId]);
      const beforeLogs = await dbGet(
        "SELECT COUNT(*) as cnt FROM xp_log WHERE user_id = ? AND reason = 'QUEST_REWARD' AND meta LIKE ?",
        [users.userAId, `%\"stateId\":${concurrentStateId}%`]
      );

      const [first, second] = await Promise.all([
        apiFetch(`http://localhost:${port}/api/quests/${concurrentStateId}/claim`, userAToken, { method: 'POST' }),
        apiFetch(`http://localhost:${port}/api/quests/${concurrentStateId}/claim`, userAToken, { method: 'POST' }),
      ]);
      await first.text();
      await second.text();

      const afterXp = await dbGet('SELECT xp FROM users WHERE id = ?', [users.userAId]);
      const afterLogs = await dbGet(
        "SELECT COUNT(*) as cnt FROM xp_log WHERE user_id = ? AND reason = 'QUEST_REWARD' AND meta LIKE ?",
        [users.userAId, `%\"stateId\":${concurrentStateId}%`]
      );

      const xpDelta = (afterXp?.xp || 0) - (beforeXp?.xp || 0);
      const logDelta = (afterLogs?.cnt || 0) - (beforeLogs?.cnt || 0);
      const pass = xpDelta === 7 && logDelta === 1;
      recordResult(
        7,
        'Claim 원자성(트랜잭션)',
        pass,
        `xp_delta=${xpDelta}, log_delta=${logDelta}`,
        'routes/growthRoutes.js claim handler의 BEGIN IMMEDIATE 범위 확인'
      );
    } catch (error) {
      recordResult(7, 'Claim 원자성(트랜잭션)', false, error.message, 'claim handler 트랜잭션 범위 확인');
    }

    // (8) timestamp consistency
    try {
      const state = await dbGet(
        'SELECT completed_at, reward_claimed_at FROM user_quest_state WHERE id = ?',
        [concurrentStateId || userAQuest.state_id]
      );
      const logRow = await dbGet(
        "SELECT created_at FROM xp_log WHERE user_id = ? AND reason = 'QUEST_REWARD' ORDER BY id DESC LIMIT 1",
        [users.userAId]
      );
      const isoRegex = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:/;
      const completedOk = state?.completed_at && isoRegex.test(state.completed_at);
      const claimedOk = state?.reward_claimed_at && isoRegex.test(state.reward_claimed_at);
      const logOk = logRow?.created_at && isoRegex.test(logRow.created_at);
      const pass = Boolean(completedOk && claimedOk && logOk);
      recordResult(
        8,
        '타임스탬프 일관성',
        pass,
        `completed_at=${state?.completed_at}, reward_claimed_at=${state?.reward_claimed_at}, xp_log=${logRow?.created_at}`,
        'claim handler 및 questService 완료 시간 포맷 통일 확인'
      );
    } catch (error) {
      recordResult(8, '타임스탬프 일관성', false, error.message, 'timestamp 생성 로직 통일 확인');
    }

  } catch (error) {
    results.push({ id: 0, title: 'verify runner', pass: false, detail: error.message, hint: 'setup 확인' });
  } finally {
    server.kill('SIGTERM');
  }

  const allPass = results.every((r) => r.pass);

  const commitHash = (() => {
    try {
      return execSync('git rev-parse HEAD', { cwd: repoRoot }).toString().trim();
    } catch (error) {
      return 'unknown';
    }
  })();

  const lines = [];
  lines.push('# Phase2 Verify Report');
  lines.push('');
  lines.push(`- Port: ${port}`);
  lines.push(`- DB_PATH: ${dbPath}`);
  lines.push(`- Commit: ${commitHash}`);
  lines.push(`- Node: ${process.version}`);
  lines.push('');
  lines.push('| # | 항목 | 결과 | 증거 요약 | 수정 포인트 |');
  lines.push('| --- | --- | --- | --- | --- |');
  results.forEach((r) => {
    lines.push(`| ${r.id} | ${r.title} | ${formatStatus(r.pass)} | ${r.detail || ''} | ${r.pass ? '-' : r.hint || ''} |`);
  });

  if (evidence.length) {
    lines.push('');
    lines.push('## Evidence Logs');
    evidence.slice(0, 10).forEach((entry) => {
      lines.push(`- ${entry.title}: ${String(entry.detail).trim()}`);
    });
  }

  fs.writeFileSync(reportPath, `${lines.join('\n')}\n`, 'utf8');

  console.log('Phase2 Verify Result');
  results.forEach((r) => {
    console.log(`${r.id}) ${r.title} ${formatStatus(r.pass)}`);
  });
  console.log(`=> ${allPass ? 'ALL PASS' : 'FAIL'}`);

  process.exit(allPass ? 0 : 1);
}

main();
