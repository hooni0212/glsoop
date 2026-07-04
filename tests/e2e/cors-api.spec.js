const { test, expect } = require('@playwright/test');

test.describe('CORS policy', () => {
  test('allows admin delete preflight from bare production domain', async ({ request }) => {
    const response = await request.fetch('/api/admin/posts/1', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://glsoop.com',
        'Access-Control-Request-Method': 'DELETE',
        'Access-Control-Request-Headers': 'content-type',
      },
    });

    expect(response.status()).toBe(204);
    expect(response.headers()['access-control-allow-origin']).toBe('https://glsoop.com');
    expect(response.headers()['access-control-allow-credentials']).toBe('true');
  });
});
