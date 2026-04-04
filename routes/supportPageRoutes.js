// routes/supportPageRoutes.js
// - /html/support.html 직접 접근을 404로 차단
// - /support 에서만 support.html 제공

const express = require('express');
const path = require('path');

const router = express.Router();

router.get('/html/support.html', (req, res) => {
  return res.status(404).send('Not Found');
});

router.get(['/support', '/support/'], (req, res) => {
  return res.sendFile(path.join(__dirname, '..', 'public', 'html', 'support.html'));
});

module.exports = router;
