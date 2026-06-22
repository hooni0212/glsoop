const E2E_SESSION_PASSWORD = 'Pass1234';
const E2E_SESSION_PASSWORD_HASH =
  '$2b$10$mcLbWSryjVd9dzRn3o70re3ZFtsVZNuOvWNKT3MCa6//CSWF19Rry';

async function requestSession(request, email, options = {}) {
  const response = await request.post('/api/login', {
    headers: {
      'x-forwarded-for': options.ip || '198.51.100.210',
    },
    data: {
      email,
      pw: options.password || E2E_SESSION_PASSWORD,
      remember: false,
    },
  });

  if (response.status() !== 200) {
    const body = await response.text().catch(() => '');
    throw new Error(`E2E session login failed (${response.status()}): ${body}`);
  }

  const payload = await response.json();
  if (!payload.ok || !payload.token) {
    throw new Error('E2E session login response did not include a valid token.');
  }

  return payload;
}

async function loginWithSession(page, email, options = {}) {
  return requestSession(page.request, email, options);
}

async function loginWithApiSession(request, email, options = {}) {
  return requestSession(request, email, options);
}

module.exports = {
  E2E_SESSION_PASSWORD,
  E2E_SESSION_PASSWORD_HASH,
  loginWithApiSession,
  loginWithSession,
};
