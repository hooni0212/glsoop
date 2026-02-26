const express = require('express');

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
  });
});

module.exports = router;
