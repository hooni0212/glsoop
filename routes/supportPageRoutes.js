// routes/supportPageRoutes.js
// - 공개 지원/정책 페이지의 clean URL 제공
// - 정적 html 직접 접근은 필요한 경우 404로 차단

const express = require('express');
const path = require('path');

const router = express.Router();

router.get('/html/support.html', (req, res) => {
  return res.status(404).send('Not Found');
});

router.get(['/support', '/support/'], (req, res) => {
  return res.sendFile(path.join(__dirname, '..', 'public', 'html', 'support.html'));
});

router.get('/html/delete-account.html', (req, res) => {
  return res.status(404).send('Not Found');
});

router.get(['/delete-account', '/delete-account/'], (req, res) => {
  return res.sendFile(path.join(__dirname, '..', 'public', 'html', 'delete-account.html'));
});

module.exports = router;
