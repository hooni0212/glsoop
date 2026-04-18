// routes/supportPageRoutes.js
// - 공개 지원/정책 페이지의 clean URL 제공
// - 일부 정적 html 직접 접근은 필요한 경우 404로 차단

const express = require('express');
const path = require('path');

const router = express.Router();
const PUBLIC_HTML_DIR = path.join(__dirname, '..', 'public', 'html');

function sendPublicHtml(fileName) {
  return (req, res) => {
    return res.sendFile(path.join(PUBLIC_HTML_DIR, fileName));
  };
}

router.get('/html/support.html', (req, res) => {
  return res.status(404).send('Not Found');
});

router.get(['/support', '/support/'], sendPublicHtml('support.html'));

router.get('/html/delete-account.html', (req, res) => {
  return res.status(404).send('Not Found');
});

router.get(['/delete-account', '/delete-account/'], sendPublicHtml('delete-account.html'));
router.get(['/terms', '/terms/'], sendPublicHtml('terms.html'));
router.get(['/privacy', '/privacy/'], sendPublicHtml('privacy.html'));
router.get(
  ['/community-guidelines', '/community-guidelines/'],
  sendPublicHtml('community-guidelines.html')
);
router.get(['/child-safety', '/child-safety/'], sendPublicHtml('child-safety.html'));

module.exports = router;
