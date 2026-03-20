const express = require('express');
const { LEGAL_CONFIG } = require('../config');

const router = express.Router();

router.get('/runtime-config', (req, res) => {
  const safeAreaGuidesEnabled = process.env.NODE_ENV !== 'production';

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
        department: LEGAL_CONFIG.contacts.department,
        email: LEGAL_CONFIG.contacts.email,
        phone: LEGAL_CONFIG.contacts.phone,
        dpo_name: LEGAL_CONFIG.contacts.dpo_name,
      },
    },
  });
});

module.exports = router;
