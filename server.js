// server.js

// 1. 필수 모듈 로드
const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');

// 환경 변수 및 메일/JWT 설정, DB는 각각 모듈에서 처리
require('./config');
require('./db');

// 라우트 모듈
const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const postRoutes = require('./routes/postRoutes');

const app = express();
const PORT = process.env.PORT || 3000;

// 2. 공통 미들웨어
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());

// API 응답 캐시 방지
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

// 4. 루트 페이지
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 5. 서버 실행
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
