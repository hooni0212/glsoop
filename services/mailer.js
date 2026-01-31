const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { transporter } = require('../config');

function getEnv(name, fallback = '') {
  const value = process.env[name];
  return typeof value === 'string' ? value.trim() : fallback;
}

function resolveOutboxPath() {
  const configured = getEnv('MAIL_OUTBOX_PATH');
  if (configured) return configured;
  return path.join('data', 'test', 'outbox.jsonl');
}

function ensureOutboxWritable(filePath) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
}

function parseTokenFromUrl(resetUrl) {
  try {
    const parsed = new URL(resetUrl);
    return parsed.searchParams.get('token') || '';
  } catch (error) {
    return '';
  }
}

async function sendWithOutbox({ to, name, resetUrl }) {
  const outboxPath = resolveOutboxPath();
  ensureOutboxWritable(outboxPath);
  const token = parseTokenFromUrl(resetUrl);
  const entry = {
    type: 'password_reset',
    to,
    name,
    resetUrl,
    token,
    createdAt: new Date().toISOString(),
  };
  fs.appendFileSync(outboxPath, `${JSON.stringify(entry)}\n`, 'utf8');
}

async function sendWithSmtp({ to, name, resetUrl }) {
  const subject = '[글숲] 비밀번호 재설정 안내';
  const html = `
    <div style="font-family: 'Noto Sans KR', sans-serif; line-height: 1.6;">
      <p><strong>${name}님, 안녕하세요.</strong></p>
      <p>아래 버튼을 눌러 비밀번호를 재설정해주세요.</p>
      <p style="margin: 24px 0;">
        <a href="${resetUrl}"
           style="display:inline-block;padding:10px 18px;background:#2e8b57;color:#fff;
                  text-decoration:none;border-radius:6px;">
          비밀번호 재설정하기
        </a>
      </p>
      <p>만약 위 버튼이 동작하지 않으면 아래 링크를 복사해서 주소창에 붙여넣어 주세요.</p>
      <p style="font-size:0.9rem;word-break:break-all;">${resetUrl}</p>
      <p style="font-size:0.9rem;color:#888;">이 링크는 1시간 동안만 유효합니다.</p>
    </div>
  `;

  return new Promise((resolve, reject) => {
    transporter.sendMail(
      {
        from: `"글숲" <${process.env.GMAIL_USER}>`,
        to,
        subject,
        html,
      },
      (error, info) => {
        if (error) return reject(error);
        resolve(info);
      }
    );
  });
}

function assertTransportPolicy(transport) {
  const isProduction = process.env.NODE_ENV === 'production';
  if (transport === 'outbox' && isProduction) {
    const allow = getEnv('ALLOW_OUTBOX_IN_PROD') === 'true';
    if (!allow) {
      throw new Error('[FATAL] production에서 outbox mail transport는 허용되지 않습니다.');
    }
  }
}

const configuredTransport = getEnv('MAIL_TRANSPORT', 'smtp') || 'smtp';
assertTransportPolicy(configuredTransport);

async function sendPasswordResetEmail({ to, name, resetUrl }) {
  const failSend = getEnv('MAIL_FAIL_SEND') === '1';

  if (failSend) {
    throw new Error('MAIL_FAIL_SEND enabled');
  }

  if (configuredTransport === 'outbox') {
    return sendWithOutbox({ to, name, resetUrl });
  }

  return sendWithSmtp({ to, name, resetUrl });
}

module.exports = {
  sendPasswordResetEmail,
  resolveOutboxPath,
};
