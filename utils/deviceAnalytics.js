const DEVICE_CLASSES = new Set(['desktop', 'mobile', 'tablet', 'unknown']);
const PLATFORM_FAMILIES = new Set([
  'ios',
  'android',
  'windows',
  'macos',
  'linux',
  'chromeos',
  'unknown',
]);

function normalizeDeviceClass(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return DEVICE_CLASSES.has(normalized) ? normalized : 'unknown';
}

function normalizePlatformFamily(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return PLATFORM_FAMILIES.has(normalized) ? normalized : 'unknown';
}

function classifyUserAgent(value) {
  const userAgent = typeof value === 'string' ? value.trim() : '';
  if (!userAgent || /bot|crawler|spider|slurp|headlesschrome|lighthouse/i.test(userAgent)) {
    return { deviceClass: 'unknown', platformFamily: 'unknown' };
  }

  if (/ipad/i.test(userAgent) || (/macintosh/i.test(userAgent) && /mobile\//i.test(userAgent))) {
    return { deviceClass: 'tablet', platformFamily: 'ios' };
  }

  if (/iphone|ipod/i.test(userAgent)) {
    return { deviceClass: 'mobile', platformFamily: 'ios' };
  }

  if (/windows phone/i.test(userAgent)) {
    return { deviceClass: 'mobile', platformFamily: 'windows' };
  }

  if (/android/i.test(userAgent)) {
    return {
      deviceClass: /mobile/i.test(userAgent) ? 'mobile' : 'tablet',
      platformFamily: 'android',
    };
  }

  if (/cros/i.test(userAgent)) {
    return { deviceClass: 'desktop', platformFamily: 'chromeos' };
  }

  if (/windows/i.test(userAgent)) {
    return { deviceClass: 'desktop', platformFamily: 'windows' };
  }

  if (/macintosh|mac os x/i.test(userAgent)) {
    return { deviceClass: 'desktop', platformFamily: 'macos' };
  }

  if (/linux|x11/i.test(userAgent)) {
    return { deviceClass: 'desktop', platformFamily: 'linux' };
  }

  if (/mobile/i.test(userAgent)) {
    return { deviceClass: 'mobile', platformFamily: 'unknown' };
  }

  return { deviceClass: 'unknown', platformFamily: 'unknown' };
}

function resolveUxEventClient({ clientType, deviceClass, platformFamily, userAgent } = {}) {
  const normalizedClientType =
    typeof clientType === 'string' ? clientType.trim().toLowerCase() : '';
  const normalizedPlatform = normalizePlatformFamily(platformFamily);

  if (
    normalizedClientType === 'native_app' &&
    (normalizedPlatform === 'ios' || normalizedPlatform === 'android')
  ) {
    const normalizedDevice = normalizeDeviceClass(deviceClass);
    return {
      source: 'native_client',
      deviceClass:
        normalizedDevice === 'mobile' || normalizedDevice === 'tablet'
          ? normalizedDevice
          : 'mobile',
      platformFamily: normalizedPlatform,
    };
  }

  const classified = classifyUserAgent(userAgent);
  return {
    source: 'web_client',
    ...classified,
  };
}

module.exports = {
  classifyUserAgent,
  normalizeDeviceClass,
  normalizePlatformFamily,
  resolveUxEventClient,
};
