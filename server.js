// server.js

//node_ENV 설정 확인.
console.log('[ENV] NODE_ENV =', process.env.NODE_ENV);
// 1. 필수 모듈 로드
// - Express: 기본 웹 서버
// - path: 정적 파일 경로 구성
// - bodyParser / cookieParser: JSON, 폼 데이터, 쿠키 파싱
// - applySecurity: Helmet + CORS 등 공통 보안 헤더 설정
const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const { applySecurity } = require('./middleware/security');
const { cleanupExpiredPending } = require('./utils/pendingSignup');
const { runMigrations } = require('./utils/migrations');
const { reconcileMonetizationState } = require('./utils/monetizationState');
const { cleanupExpiredSessions } = require('./utils/authSession');
const { startPushDispatcher } = require('./services/pushDispatcher');
const { startMarketingPushReminderScheduler } = require('./services/marketingPushReminder');

// 환경 변수 및 메일/JWT 설정, DB는 각각 모듈에서 처리
// (실제 DB 연결 로직은 db.js, 이메일/JWT 키는 config.js에서 초기화됨)
require('./config');
require('./db');

// 라우트 모듈
const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const postRoutes = require('./routes/postRoutes');
const bookmarkRoutes = require('./routes/bookmarkRoutes');
const growthRoutes = require('./routes/growthRoutes');
const searchRoutes = require('./routes/searchRoutes');
const shareRoutes = require('./routes/shareRoutes');
const commentRoutes = require('./routes/commentRoutes');
const activityRoutes = require('./routes/activityRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const feedImageRoutes = require('./routes/feedImageRoutes');
const uxEventRoutes = require('./routes/uxEventRoutes');
const runtimeRoutes = require('./routes/runtimeRoutes');
const cosmeticsRoutes = require('./routes/cosmeticsRoutes');
const monetizationRoutes = require('./routes/monetizationRoutes');
const monetizationWebhookRoutes = require('./routes/monetizationWebhookRoutes');
const photoSaveRoutes = require('./routes/photoSaveRoutes');
const profilePhotoRoutes = require('./routes/profilePhotoRoutes');
const adminRoutes = require('./routes/adminRoutes');
const adminPageRoutes = require('./routes/adminPageRoutes');
const authPageRoutes = require('./routes/authPageRoutes');
const supportPageRoutes = require('./routes/supportPageRoutes');


const app = express();
// 로컬 개발은 3000, 배포 환경에서는 포트 환경 변수 사용
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const APPLE_APP_SITE_ASSOCIATION = Object.freeze({
  applinks: {
    apps: [],
    details: [
      {
        appID: 'NX3NR9FFKP.com.glsoop.app',
        paths: [
          '/',
          '/index.html',
          '/explore',
          '/explore/',
          '/posts/*',
          '/users/*',
          '/html/post.html',
          '/html/author.html',
        ],
      },
    ],
  },
});
const PUSH_DISPATCH_ENABLED = process.env.PUSH_DISPATCH_ENABLED === 'true';
const MARKETING_PUSH_REMINDER_ENABLED = process.env.MARKETING_PUSH_REMINDER_ENABLED === 'true';
const PENDING_CLEANUP_INTERVAL_MS = 30 * 60 * 1000;
const MONETIZATION_RECONCILE_INTERVAL_MS = 30 * 60 * 1000;
const AUTH_SESSION_CLEANUP_INTERVAL_MS = 30 * 60 * 1000;

const trustProxyCidrs = String(process.env.TRUST_PROXY_CIDRS || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

if (process.env.NODE_ENV === 'production' && trustProxyCidrs.length === 0) {
  throw new Error(
    '[FATAL] 운영 환경에서는 TRUST_PROXY_CIDRS가 필요합니다. 신뢰 프록시 CIDR/별칭을 설정하세요.'
  );
}

if (trustProxyCidrs.length > 0) {
  app.set('trust proxy', trustProxyCidrs);
} else {
  app.set('trust proxy', ['loopback']);
}

// 2. 공통 미들웨어
// - 보안 헤더 및 CORS 설정을 먼저 적용
applySecurity(app);

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());

//느린 API 확인하기.
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    if (ms >= 300) {
      console.log(`[SLOW ${ms}ms] ${req.method} ${req.originalUrl} -> ${res.statusCode}`);
    }
  });
  next();
});

// API 응답 캐시 방지 (브라우저 캐시로 인한 데이터 일관성 문제 방지)
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

// 관리자 페이지 HTML 차단/보호 라우트 (정적 파일보다 먼저!)
app.use(adminPageRoutes);
// 인증 페이지 접근 가드 (로그인 상태에서 로그인 페이지 재진입 차단)
app.use(authPageRoutes);
// support 페이지는 clean URL로만 노출
app.use(supportPageRoutes);

app.get(['/apple-app-site-association', '/.well-known/apple-app-site-association'], (req, res) => {
  res.set('Content-Type', 'application/json');
  res.set('Cache-Control', 'public, max-age=3600');
  res.send(JSON.stringify(APPLE_APP_SITE_ASSOCIATION));
});

// 정적 파일 제공
app.use(express.static(path.join(__dirname, 'public')));

// 3. API 라우트 연결
app.use('/api', authRoutes);
app.use('/api', userRoutes);
app.use('/api', postRoutes);
app.use('/api', bookmarkRoutes);
app.use('/api', searchRoutes);
app.use('/api', shareRoutes);
app.use('/api', commentRoutes);
app.use('/api', activityRoutes);
app.use('/api', notificationRoutes);
app.use('/api', feedImageRoutes);
app.use('/api', uxEventRoutes);
app.use('/api', runtimeRoutes);
app.use('/api', growthRoutes);
app.use('/api', cosmeticsRoutes);
app.use('/api', monetizationRoutes);
app.use('/api', monetizationWebhookRoutes);
app.use('/api', photoSaveRoutes);
app.use('/api', profilePhotoRoutes);
app.use('/api/admin', adminRoutes);

// 4. 루트 페이지
app.get(['/explore', '/explore/'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'explore.html'));
});

app.get(['/posts/:id', '/posts/:id/'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'html', 'post.html'));
});

app.get(['/users/:id', '/users/:id/'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'html', 'author.html'));
});

app.get(['/write', '/write/'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'html', 'editor.html'));
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 5. 서버 실행
const startServer = async () => {
  try {
    await runMigrations();
  } catch (error) {
    console.error('migration failed:', error);
    process.exit(1);
  }

  app.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
  });

  if (PUSH_DISPATCH_ENABLED) {
    startPushDispatcher();
    console.log('[push/dispatcher] enabled');
  }
  if (MARKETING_PUSH_REMINDER_ENABLED) {
    startMarketingPushReminderScheduler();
    console.log('[marketing-push-reminder] enabled');
    if (!PUSH_DISPATCH_ENABLED) {
      console.warn(
        '[marketing-push-reminder] PUSH_DISPATCH_ENABLED is not true; reminders will queue but not send.'
      );
    }
  }

  cleanupExpiredPending().catch((error) => {
    console.error('pending signup cleanup failed:', error);
  });
  cleanupExpiredSessions().catch((error) => {
    console.error('auth session cleanup failed:', error);
  });

  const runMonetizationReconcile = () => {
    reconcileMonetizationState()
      .then((summary) => {
        const changedCount =
          Number(summary?.expired_purchases || 0) +
          Number(summary?.activated_entitlements || 0) +
          Number(summary?.deactivated_entitlements || 0);
        if (changedCount > 0) {
          console.log('[monetization/reconcile] summary:', summary);
        }
      })
      .catch((error) => {
        console.error('monetization reconcile failed:', error);
      });
  };

  runMonetizationReconcile();

  setInterval(() => {
    cleanupExpiredPending().catch((error) => {
      console.error('pending signup cleanup failed:', error);
    });
  }, PENDING_CLEANUP_INTERVAL_MS);

  setInterval(() => {
    cleanupExpiredSessions().catch((error) => {
      console.error('auth session cleanup failed:', error);
    });
  }, AUTH_SESSION_CLEANUP_INTERVAL_MS);

  setInterval(runMonetizationReconcile, MONETIZATION_RECONCILE_INTERVAL_MS);
};

startServer();
