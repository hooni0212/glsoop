const DraftManager = (() => {
  const DRAFT_KEY_PREFIX = 'glsoop:editor:drafts:v2';
  const LEGACY_DRAFT_KEY_PREFIX = 'glsoop:editor:draft:v1';
  const MAX_DRAFTS = 30;
  const DRAFT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
  let namespace = null;
  let drafts = [];

  async function init() {
    document.getElementById('draftsList')?.addEventListener('click', onListClick);
    document.getElementById('draftsClearAll')?.addEventListener('click', clearAll);
    try {
      const res = await fetch('/api/me', { cache: 'no-store' });
      if (res.status === 401) {
        window.location.href = `/html/login.html?next=${encodeURIComponent('/drafts')}`;
        return;
      }
      const me = await res.json().catch(() => ({}));
      if (!res.ok || !me.ok) throw new Error('로그인 정보를 확인하지 못했습니다.');
      const userId = Number(me.id);
      namespace = Number.isInteger(userId) && userId > 0
        ? `user:${userId}`
        : `email:${String(me.email || 'session').trim().toLowerCase()}`;
      migrateLegacyDrafts();
      drafts = readDrafts();
      render();
    } catch (error) {
      renderError(error.message || '임시저장함을 불러오지 못했습니다.');
    }
  }

  function migrateLegacyDrafts() {
    const legacyKeys = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key?.startsWith(`${LEGACY_DRAFT_KEY_PREFIX}:`)) legacyKeys.push(key);
    }
    legacyKeys.forEach((legacyKey) => {
      try {
        const parsed = JSON.parse(localStorage.getItem(legacyKey) || 'null');
        if (!parsed?.state) return;
        const isEdit = legacyKey.includes(':edit:');
        const postId = isEdit ? legacyKey.split(':').pop() : null;
        const draftId = isEdit ? `edit-${postId}` : `legacy-${Date.now()}`;
        const nextKey = isEdit
          ? `${DRAFT_KEY_PREFIX}:${namespace}:edit:${postId}`
          : `${DRAFT_KEY_PREFIX}:${namespace}:create:${draftId}`;
        if (!localStorage.getItem(nextKey)) {
          localStorage.setItem(nextKey, JSON.stringify({
            ...parsed,
            version: 2,
            draft_id: draftId,
            auth_namespace: namespace,
            expires_at: new Date(Date.now() + DRAFT_TTL_MS).toISOString(),
          }));
        }
        localStorage.removeItem(legacyKey);
      } catch (error) {
        localStorage.removeItem(legacyKey);
      }
    });
  }

  function readDrafts() {
    const prefix = `${DRAFT_KEY_PREFIX}:${namespace}:`;
    const items = [];
    const invalidKeys = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key?.startsWith(prefix)) continue;
      try {
        const payload = JSON.parse(localStorage.getItem(key) || 'null');
        if (!payload?.state || !isMeaningful(payload.state)) {
          invalidKeys.push(key);
          continue;
        }
        const savedAt = Date.parse(payload.saved_at || '') || 0;
        const expiresAt = Date.parse(payload.expires_at || '') || savedAt + DRAFT_TTL_MS;
        if (!savedAt || expiresAt <= Date.now()) {
          invalidKeys.push(key);
          continue;
        }
        items.push({ key, payload, savedAt });
      } catch (error) {
        invalidKeys.push(key);
      }
    }
    invalidKeys.forEach((key) => localStorage.removeItem(key));
    items.sort((a, b) => b.savedAt - a.savedAt);
    items.slice(MAX_DRAFTS).forEach((item) => localStorage.removeItem(item.key));
    return items.slice(0, MAX_DRAFTS);
  }

  function isMeaningful(state) {
    if (String(state?.title || '').trim()) return true;
    if (htmlToText(state?.content_html).trim()) return true;
    if (Array.isArray(state?.hashtags) && state.hashtags.length) return true;
    return Boolean(state?.category || state?.layout_json);
  }

  function htmlToText(value) {
    const doc = new DOMParser().parseFromString(String(value || ''), 'text/html');
    return String(doc.body.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function render() {
    const mount = document.getElementById('draftsList');
    const clearButton = document.getElementById('draftsClearAll');
    if (!mount) return;
    mount.setAttribute('aria-busy', 'false');
    if (clearButton) clearButton.disabled = drafts.length === 0;
    if (!drafts.length) {
      mount.innerHTML = `
        <div class="drafts-empty CardSoft">
          <strong>임시저장한 글이 없습니다.</strong>
          <p>새 글을 쓰기 시작하면 작성 내용이 자동으로 이곳에 저장됩니다.</p>
          <a class="gls-btn gls-btn-primary" href="/write">글 작성하기</a>
        </div>
      `;
      return;
    }
    mount.innerHTML = drafts.map(renderDraft).join('');
  }

  function renderDraft(item) {
    const payload = item.payload;
    const snapshot = payload.state || {};
    const title = String(snapshot.title || '').trim() || '(제목 없음)';
    const preview = htmlToText(snapshot.content_html).slice(0, 140);
    const modeLabel = payload.mode === 'edit' ? '수정 중인 글' : '새 글';
    const category = categoryLabel(snapshot.category);
    return `
      <article class="draft-card CardSoft" data-draft-key="${escapeHtml(item.key)}">
        <div class="draft-card__head">
          <div>
            <p>${escapeHtml(`${modeLabel}${category ? ` · ${category}` : ''}`)}</p>
            <h2>${escapeHtml(title)}</h2>
          </div>
          <time datetime="${escapeHtml(payload.saved_at || '')}">${escapeHtml(formatDraftDate(item.savedAt))}</time>
        </div>
        <p class="draft-card__preview">${escapeHtml(preview || '아직 본문 내용이 없습니다.')}</p>
        ${payload.writing_event_context ? `<span class="draft-card__campaign">${escapeHtml(payload.writing_event_context.promptSource || '글쓰기 프로젝트')} · ${escapeHtml(payload.writing_event_context.promptDay || '-')}일차</span>` : ''}
        <div class="draft-card__actions">
          <a class="gls-btn gls-btn-primary gls-btn-sm" href="${escapeHtml(buildResumePath(payload))}">이어서 쓰기</a>
          <button class="gls-btn gls-btn-secondary gls-btn-sm" type="button" data-delete-draft>삭제</button>
        </div>
      </article>
    `;
  }

  function buildResumePath(payload) {
    const params = new URLSearchParams();
    if (payload.mode === 'edit' && payload.post_id) {
      params.set('postId', String(payload.post_id));
    } else {
      params.set('draftId', String(payload.draft_id || 'draft'));
    }
    const context = payload.writing_event_context;
    if (context) {
      if (context.eventKey) params.set('campaignKey', context.eventKey);
      if (context.promptKey) params.set('campaignPromptKey', context.promptKey);
      if (context.promptDay) params.set('promptDay', context.promptDay);
      if (context.promptTitle) params.set('promptTitle', context.promptTitle);
      if (context.promptBody) params.set('promptBody', context.promptBody);
      if (context.promptCategory) params.set('promptCategory', context.promptCategory);
      if (context.promptTags) params.set('promptTags', context.promptTags);
      if (context.promptSource) params.set('promptSource', context.promptSource);
    }
    return `/write?${params.toString()}`;
  }

  function onListClick(event) {
    const button = event.target.closest('[data-delete-draft]');
    if (!button) return;
    const card = button.closest('[data-draft-key]');
    const key = card?.dataset.draftKey;
    if (!key || !confirm('이 임시저장 글을 삭제할까요?')) return;
    localStorage.removeItem(key);
    drafts = drafts.filter((item) => item.key !== key);
    render();
  }

  function clearAll() {
    if (!drafts.length || !confirm(`임시저장 글 ${drafts.length}개를 모두 삭제할까요?`)) return;
    drafts.forEach((item) => localStorage.removeItem(item.key));
    drafts = [];
    render();
  }

  function categoryLabel(value) {
    if (value === 'poem') return '시';
    if (value === 'essay') return '에세이/일기';
    if (value === 'short') return '짧은 구절';
    return '';
  }

  function formatDraftDate(timestamp) {
    return new Date(timestamp).toLocaleString('ko-KR', {
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    });
  }

  function renderError(message) {
    const mount = document.getElementById('draftsList');
    if (mount) mount.innerHTML = `<div class="drafts-state is-error CardSoft">${escapeHtml(message)}</div>`;
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', DraftManager.init);
