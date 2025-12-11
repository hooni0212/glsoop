// utils/hashtags.js
// - 게시글 저장/수정 시 전달된 해시태그 문자열을 정리하고 DB에 반영
const db = require('../db');

// 해시태그 문자열 정리
function normalizeHashtagName(raw) {
  if (!raw) return null;
  let t = String(raw).trim();
  if (!t) return null;

  if (t[0] === '#') t = t.slice(1);
  t = t.trim();
  if (!t) return null;

  if (t.length > 50) t = t.slice(0, 50);

  return t.toLowerCase();
}

// 해당 게시글의 해시태그 매핑을 모두 재저장
// - 기존 매핑 삭제 → 태그 테이블에 없는 태그는 생성 → 새 매핑 저장 순서
function saveHashtagsForPostFromInput(postId, hashtagsInput, callback) {
  let rawList = [];

  if (Array.isArray(hashtagsInput)) {
    rawList = hashtagsInput;
  } else if (typeof hashtagsInput === 'string') {
    rawList = hashtagsInput.split(/[\s,]+/);
  } else {
    rawList = [];
  }

  const set = new Set();
  rawList.forEach((raw) => {
    const n = normalizeHashtagName(raw);
    if (n) set.add(n);
  });

  const tags = Array.from(set);

  if (tags.length === 0) {
    db.run(
      'DELETE FROM post_hashtags WHERE post_id = ?',
      [postId],
      (err) => {
        if (err) console.error('delete post_hashtags error:', err);
        if (callback) callback(err);
      }
    );
    return;
  }

  db.serialize(() => {
    db.run('DELETE FROM post_hashtags WHERE post_id = ?', [postId], (err) => {
      if (err) {
        console.error('delete post_hashtags error:', err);
        if (callback) callback(err);
        return;
      }

      const insertTagStmt = db.prepare(
        'INSERT OR IGNORE INTO hashtags (name) VALUES (?)'
      );
      const selectTagStmt = db.prepare(
        'SELECT id FROM hashtags WHERE name = ?'
      );
      const insertMapStmt = db.prepare(
        'INSERT INTO post_hashtags (post_id, hashtag_id) VALUES (?, ?)'
      );

      let index = 0;

      function processNext() {
        if (index >= tags.length) {
          insertTagStmt.finalize();
          selectTagStmt.finalize();
          insertMapStmt.finalize();
          if (callback) callback(null);
          return;
        }

        const tag = tags[index++];
        insertTagStmt.run(tag, (err2) => {
          if (err2) {
            console.error('insert hashtag error:', err2);
            processNext();
            return;
          }

          selectTagStmt.get(tag, (err3, row) => {
            if (err3 || !row) {
              console.error('select hashtag error:', err3);
              processNext();
              return;
            }

            insertMapStmt.run(postId, row.id, (err4) => {
              if (err4) {
                console.error('insert post_hashtags error:', err4);
              }
              processNext();
            });
          });
        });
      }

      processNext();
    });
  });
}

module.exports = {
  normalizeHashtagName,
  saveHashtagsForPostFromInput
};

