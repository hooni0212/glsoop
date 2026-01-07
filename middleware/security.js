// middleware/security.js

const cors = require('cors');
const helmet = require('helmet');

// ✅ 허용 origin 목록
// - 로컬 개발 & 실제 서비스 도메인을 명시
const allowedOrigins = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',

  // ✅ Expo Web(dev server)
  'http://localhost:8081',
  'http://127.0.0.1:8081',

  // (선택) Expo 웹이 다른 포트로 뜰 때 대비
  'http://localhost:19006',
  'http://127.0.0.1:19006',

  'https://www.glsoop.com',
  'https://glsoop.com',
];

// Cloudflare Tunnel 도메인 패턴 (예: xxx.trycloudflare.com)
const allowedOriginSuffixes = ['.trycloudflare.com'];

// ✅ CORS 옵션
const corsOptions = {
  origin(origin, callback) {
    // origin이 없는 경우(서버 내부 호출, Postman 등)는 허용
    if (!origin) return callback(null, true);

    if (
      allowedOrigins.includes(origin) ||
      allowedOriginSuffixes.some((suffix) => origin.endsWith(suffix))
    ) {
      return callback(null, true);
    }

    console.log('[CORS BLOCKED] origin =', origin);
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true, // 쿠키(JWT) 같이 보내려면 필수
};

function applySecurity(app) {
  // 1) 기본 helmet (XSS, clickjacking 등 기본 보안 헤더)
  app.use(
    helmet({
      crossOriginEmbedderPolicy: false,
      // 정적 리소스를 다른 origin에서 가져오는 것도 허용
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    })
  );

  // 2) CSP – 폰트/부트스트랩/Quill/Google Fonts + Cloudflare beacon만 열어둠
  app.use(
    helmet.contentSecurityPolicy({
      // useDefaults: true 빼고, 우리가 쓰는 것만 명시적으로 작성
      directives: {
        // 기본: 같은 origin만
        defaultSrc: ["'self'"],

        // JS
        scriptSrc: [
          "'self'",
          'https://cdn.jsdelivr.net',             // Bootstrap JS
          'https://cdn.quilljs.com',             // Quill
          'https://static.cloudflareinsights.com', // Cloudflare beacon
        ],

        // CSS
        styleSrc: [
          "'self'",
          "'unsafe-inline'",                      // Bootstrap, Quill, 우리가 쓰는 인라인 스타일
          'https://cdn.jsdelivr.net',
          'https://cdn.quilljs.com',
          'https://fonts.googleapis.com',         // Google Fonts CSS
        ],

        // 폰트
        fontSrc: [
          "'self'",                               // /fonts/* 같이 우리 서버에서 서빙하는 폰트
          'https://fonts.gstatic.com',            // Google Fonts 폰트 파일
          'data:',                               // data: URL 폰트도 허용
        ],

        // 이미지
        imgSrc: [
          "'self'",
          'data:',
          'https://cdn.quilljs.com',
        ],

        // XHR / fetch / 웹소켓
        connectSrc: [
          "'self'",
          'https://cdn.jsdelivr.net',
          'https://static.cloudflareinsights.com',
          'https://fonts.googleapis.com',
          'https://fonts.gstatic.com',
        ],

        frameSrc: ["'self'"],
      },
    })
  );

  // 3) CORS
  app.use(cors(corsOptions));
}

module.exports = { applySecurity };
