// middleware/security.js

const cors = require('cors');
const helmet = require('helmet');

// ✅ 이 도메인들만 허용 (필요하면 추가)
const allowedOrigins = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'https://www.glsoop.com',
  'https://glsoop.com',
];

// ✅ CORS 옵션
const corsOptions = {
  origin(origin, callback) {
    // origin이 없는 경우 (예: Postman, 서버 내부 호출 등) 허용
    if (!origin) {
      return callback(null, true);
    }

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    console.log('[CORS BLOCKED] origin =', origin);
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true, // JWT 쿠키 같이 보내려면 필수
};

// ✅ 보안 관련 미들웨어 적용
function applySecurity(app) {
  // 1) 기본 helmet
  app.use(
    helmet({
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: 'same-origin' },
    })
  );

  // 2) CSP (필요한 CDN만 열어둔다)
  app.use(
    helmet.contentSecurityPolicy({
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          'https://cdn.jsdelivr.net', // 부트스트랩 JS
          'https://cdn.quilljs.com', // Quill 에디터
          'https://static.cloudflareinsights.com', // (원하면) Cloudflare beacon
        ],
        styleSrc: [
          "'self'",
          "'unsafe-inline'",
          'https://cdn.jsdelivr.net', // 부트스트랩 CSS
          'https://cdn.quilljs.com', // Quill 에디터 CSS
          'https://fonts.googleapis.com',
        ],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"], // 필요 시 API/WS 도메인 추가
      },
    })
  );

  // 3) CORS 적용
  app.use(cors(corsOptions));
  //app.options('*', cors(corsOptions)); // Preflight 대응
}

module.exports = { applySecurity };
