// public/js/igExportUI.js
// - post.html의 내보내기 바(포맷/스타일/배경) UI를 exportPostToInstagram에 연결
// - post 데이터 우선순위: window.__igPost > localStorage.glsoop_lastPost

(() => {
  function safeJsonParse(s) {
    try { return JSON.parse(s); } catch { return null; }
  }

  function getCurrentPostForExport() {
    // 1) post.js에서 혹시 전역으로 올려둔 경우
    if (window.__igPost && typeof window.__igPost === 'object') return window.__igPost;

    // 2) 너가 말한: localStorage glsoop_lastPost
    const ls = localStorage.getItem('glsoop_lastPost');
    const parsed = safeJsonParse(ls);

    // glsoop_lastPost가 id만 있는 경우도 고려해서 최소 체크
    if (parsed && typeof parsed === 'object') return parsed;

    return null;
  }

  function $(id) {
    return document.getElementById(id);
  }

  async function handleExportClick() {
    if (!window.exportPostToInstagram) {
      alert('내보내기 모듈(igExport.js)이 아직 로드되지 않았어.');
      return;
    }

    const post = getCurrentPostForExport();
    if (!post) {
      alert('내보낼 글 데이터를 찾지 못했어. (glsoop_lastPost / __igPost 없음)');
      return;
    }

    // content가 없으면 이미지에 본문이 비는 문제가 생김
    if (!post.content) {
      alert('현재 글 데이터에 content가 없어. post.js에서 glsoop_lastPost에 content까지 저장되게 해줘야 해.');
      return;
    }

    const format = $('igFormat')?.value || 'feed45';
    const style = $('igStyle')?.value || 'photo-overlay';
    const bgKey = $('igBgKey')?.value || 'dawnSky';
    const bgImageUrl = ($('igBgUrl')?.value || '').trim();

    // bgImageUrl이 있으면 그게 우선, 없으면 bgKey 프리셋 사용
    const opts = {
      format,
      style,
      bgKey,
      bgImageUrl,
      // 필요하면 여기서 더 옵션 추가 가능:
      // paragraphGap: 34,
      // watermarkText: 'www.glsoop.com',
    };

    try {
      await window.exportPostToInstagram(post, opts);
    } catch (e) {
      console.error(e);
      alert('내보내기 중 오류가 났어. 콘솔을 확인해줘.');
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    const btn = $('igExportBtn');
    if (!btn) return;
    btn.addEventListener('click', handleExportClick);
  });
})();
