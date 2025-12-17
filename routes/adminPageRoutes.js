// routes/adminPageRoutes.js
// - /html/admin.html 직접 접근을 404로 "완전 차단"
// - /admin 에서만 관리자에게 admin.html 제공

const express = require('express');
const path = require('path');
const { adminPageRequired } = require('../middleware/adminPageGuard');

const router = express.Router();

// 1) 예전 주소(정적 파일) 완전 차단: 관리자여도 404
router.get('/html/admin.html', (req, res) => {
  return res.status(404).send('Not Found');
});

// 2) 새 관리자 진입점: /admin
router.get(['/admin', '/admin/'], adminPageRequired, (req, res) => {
  return res.sendFile(path.join(__dirname, '..', 'public', 'html', 'admin.html'));
});

module.exports = router;
