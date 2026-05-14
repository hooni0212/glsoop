const express = require('express');
const { BASE_URL, LEGAL_CONFIG } = require('../config');
const { buildSafetyRuntimeConfig } = require('../utils/safety');

const router = express.Router();

function resolveOrigin(req) {
  if (BASE_URL) {
    return BASE_URL.replace(/\/+$/, '');
  }
  return `${req.protocol}://${req.get('host')}`;
}

router.get('/runtime-config', (req, res) => {
  const safeAreaGuidesEnabled = process.env.NODE_ENV !== 'production';
  const origin = resolveOrigin(req);

  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');

  return res.json({
    ok: true,
    flags: {
      safe_area_guides: safeAreaGuidesEnabled,
    },
    legal: {
      versions: {
        terms: LEGAL_CONFIG.versions.terms,
        privacy: LEGAL_CONFIG.versions.privacy,
        marketing: LEGAL_CONFIG.versions.marketing,
        guidelines: LEGAL_CONFIG.versions.guidelines,
      },
      effective_dates: {
        terms: LEGAL_CONFIG.effective_dates.terms,
        privacy: LEGAL_CONFIG.effective_dates.privacy,
        guidelines: LEGAL_CONFIG.effective_dates.guidelines,
      },
      contacts: {
        operator_name: LEGAL_CONFIG.contacts.operator_name,
        department: LEGAL_CONFIG.contacts.department,
        email: LEGAL_CONFIG.contacts.email,
        phone: LEGAL_CONFIG.contacts.phone,
        dpo_name: LEGAL_CONFIG.contacts.dpo_name,
      },
      urls: {
        terms: `${origin}/html/terms.html`,
        privacy: `${origin}/html/privacy.html`,
        guidelines: `${origin}/html/community-guidelines.html`,
      },
    },
    safety: buildSafetyRuntimeConfig(),
  });
});

module.exports = router;
