// middleware/security.js

const cors = require('cors');
const helmet = require('helmet');

const rawAllowedHosts = process.env.CORS_ALLOWED_HOSTS
  ? process.env.CORS_ALLOWED_HOSTS.split(',').map((value) => value.trim())
  : [];
const filteredHosts = rawAllowedHosts.filter(Boolean);
const isProduction = process.env.NODE_ENV === 'production';

const defaultHosts = new Set(['www.glsoop.com', 'm.glsoop.com']);
if (!isProduction) {
  defaultHosts.add('localhost');
  defaultHosts.add('127.0.0.1');
}

const allowExactHosts =
  filteredHosts.length > 0 ? new Set(filteredHosts) : defaultHosts;

function originToHostname(origin) {
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return parsed.hostname;
  } catch (error) {
    return null;
  }
}

// ✅ CORS 옵션
const corsOptions = {
  origin(origin, callback) {
    // origin이 없는 경우(서버 내부 호출, Postman 등)는 허용
    if (!origin) return callback(null, true);

    const hostname = originToHostname(origin);
    if (!hostname) {
      if (!isProduction) {
        console.warn('[CORS BLOCKED] invalid origin =', origin);
      }
      return callback(null, false);
    }

    if (allowExactHosts.has(hostname)) {
      return callback(null, true);
    }

    if (!isProduction) {
      console.warn('[CORS BLOCKED] origin =', origin, 'hostname =', hostname);
    }
    return callback(null, false);
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
