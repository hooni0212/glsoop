import 'dotenv/config';

const REQUIRED_APPLE = [
  'MONETIZATION_APPLE_ISSUER_ID',
  'MONETIZATION_APPLE_KEY_ID',
  'MONETIZATION_APPLE_PRIVATE_KEY',
];

const REQUIRED_GOOGLE = [
  'MONETIZATION_GOOGLE_PACKAGE_NAME',
  'MONETIZATION_GOOGLE_SERVICE_ACCOUNT_EMAIL',
  'MONETIZATION_GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY',
];

function hasValue(name) {
  const value = process.env[name];
  return typeof value === 'string' && value.trim().length > 0;
}

function printSection(title) {
  console.log(`\n[${title}]`);
}

function printKeyStatus(name) {
  console.log(`- ${name}: ${hasValue(name) ? 'SET' : 'MISSING'}`);
}

function listMissing(keys) {
  return keys.filter((name) => !hasValue(name));
}

function main() {
  const verifyMode = (process.env.MONETIZATION_VERIFY_MODE || 'pending_only').trim();
  const strict = ['1', 'true', 'yes', 'on'].includes(
    String(process.env.MONETIZATION_VERIFY_LIVE_STRICT || '')
      .trim()
      .toLowerCase()
  );
  const fallbackMode = (process.env.MONETIZATION_VERIFY_LIVE_FALLBACK_MODE || 'receipt_inspect').trim();

  console.log('Monetization Live Verify Preflight');
  console.log(`- MONETIZATION_VERIFY_MODE=${verifyMode}`);
  console.log(`- MONETIZATION_VERIFY_LIVE_STRICT=${strict}`);
  console.log(`- MONETIZATION_VERIFY_LIVE_FALLBACK_MODE=${fallbackMode}`);

  printSection('Apple Live Verify');
  REQUIRED_APPLE.forEach(printKeyStatus);
  printKeyStatus('MONETIZATION_APPLE_BUNDLE_ID');
  printKeyStatus('MONETIZATION_APPLE_ENV');

  printSection('Google Live Verify');
  REQUIRED_GOOGLE.forEach(printKeyStatus);
  printKeyStatus('MONETIZATION_GOOGLE_SERVICE_ACCOUNT_JSON');

  printSection('Webhook');
  printKeyStatus('MONETIZATION_WEBHOOK_SECRET');
  printKeyStatus('MONETIZATION_APPLE_WEBHOOK_SECRET');
  printKeyStatus('MONETIZATION_GOOGLE_WEBHOOK_SECRET');

  const missingApple = listMissing(REQUIRED_APPLE);
  const missingGoogleByKey = listMissing(REQUIRED_GOOGLE);
  const hasGoogleJson = hasValue('MONETIZATION_GOOGLE_SERVICE_ACCOUNT_JSON');
  const missingGoogle = hasGoogleJson ? [] : missingGoogleByKey;

  printSection('Summary');
  if (missingApple.length === 0) {
    console.log('- Apple live verify: READY');
  } else {
    console.log(`- Apple live verify: NOT READY (missing: ${missingApple.join(', ')})`);
  }

  if (missingGoogle.length === 0) {
    console.log('- Google live verify: READY');
  } else {
    console.log(`- Google live verify: NOT READY (missing: ${missingGoogle.join(', ')})`);
  }

  if (verifyMode !== 'live_verify') {
    console.log('- Current mode is not live_verify; live credentials are optional right now.');
    process.exitCode = 0;
    return;
  }

  if (strict && (missingApple.length > 0 || missingGoogle.length > 0)) {
    console.log('- strict=true + missing credentials detected: runtime verification may fail.');
    process.exitCode = 1;
    return;
  }

  process.exitCode = 0;
}

main();
