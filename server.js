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
const adminRoutes = require('./routes/adminRoutes');

const app = express();
// 로컬 개발은 3000, 배포 환경에서는 포트 환경 변수 사용
const PORT = process.env.PORT || 3000;

// 프록시/로드밸런서 뒤에서도 올바른 프로토콜 정보를 사용하기 위함
app.set('trust proxy', 1);

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

// 정적 파일 제공
app.use(express.static(path.join(__dirname, 'public')));

// 3. API 라우트 연결
app.use('/api', authRoutes);
app.use('/api', userRoutes);
app.use('/api', postRoutes);
app.use('/api', bookmarkRoutes);
app.use('/api', growthRoutes);
app.use('/api/admin', adminRoutes);

// 4. 루트 페이지
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 5. 서버 실행
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
