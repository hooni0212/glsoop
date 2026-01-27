const db = require('../db');

function cleanupExpiredPending() {
  return new Promise((resolve, reject) => {
    db.run(
      "DELETE FROM pending_signups WHERE expires_at < datetime('now')",
      function (err) {
        if (err) return reject(err);
        resolve(this.changes || 0);
      }
    );
  });
}

module.exports = {
  cleanupExpiredPending,
};
