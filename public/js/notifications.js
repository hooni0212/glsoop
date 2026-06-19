const NotificationInbox = (() => {
  const PAGE_SIZE = 30;
  const state = {
    items: [],
    offset: 0,
    hasMore: false,
    loading: false,
  };

  const typeMeta = {
    post_reaction: { icon: '♥', label: '공감' },
    post_comment: { icon: '✎', label: '댓글' },
    comment_reply: { icon: '↳', label: '답글' },
    following_new_post: { icon: '▤', label: '새 글' },
    new_follower: { icon: '+', label: '새 독자' },
    admin_operational_alert: { icon: '!', label: '운영' },
    marketing_campaign: { icon: '♧', label: '소식' },
  };

  function init() {
    document.getElementById('notificationsReadAll')?.addEventListener('click', markAllRead);
    document.getElementById('notificationsMore')?.addEventListener('click', () => load(false));
    document.getElementById('notificationsList')?.addEventListener('click', onNotificationClick);
    load(true);
  }

  async function load(reset) {
    if (state.loading) return;
    state.loading = true;
    const list = document.getElementById('notificationsList');
    if (reset) {
      state.offset = 0;
      list?.setAttribute('aria-busy', 'true');
    }

    try {
      const res = await fetch(`/api/notifications?limit=${PAGE_SIZE}&offset=${reset ? 0 : state.offset}`, {
        cache: 'no-store',
      });
      if (res.status === 401) {
        window.location.href = `/html/login.html?next=${encodeURIComponent('/notifications')}`;
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.message || '알림을 불러오지 못했습니다.');

      const nextItems = Array.isArray(data.notifications) ? data.notifications : [];
      state.items = reset ? nextItems : mergeUnique(state.items, nextItems);
      state.offset = state.items.length;
      state.hasMore = Boolean(data.has_more || data.pagination?.has_more);
      render();
      updateHeaderBadge(Number(data.unread_count) || 0);
    } catch (error) {
      if (list) list.innerHTML = `<p class="notifications-state is-error">${escapeHtml(error.message || '알림을 불러오지 못했습니다.')}</p>`;
    } finally {
      state.loading = false;
      list?.setAttribute('aria-busy', 'false');
    }
  }

  function mergeUnique(current, incoming) {
    const seen = new Set(current.map((item) => String(item.id)));
    return [...current, ...incoming.filter((item) => !seen.has(String(item.id)))];
  }

  function render() {
    const list = document.getElementById('notificationsList');
    const moreWrap = document.getElementById('notificationsMoreWrap');
    if (!list || !moreWrap) return;

    if (!state.items.length) {
      list.innerHTML = `
        <div class="notifications-empty">
          <strong>아직 알림이 없습니다.</strong>
          <p>댓글, 답글, 공감과 새 독자 소식이 생기면 여기에 모아둘게요.</p>
          <a class="gls-btn gls-btn-secondary" href="/explore">글 둘러보기</a>
        </div>
      `;
    } else {
      list.innerHTML = state.items.map(renderItem).join('');
    }
    moreWrap.classList.toggle('gls-hidden', !state.hasMore);
  }

  function renderItem(item) {
    const meta = typeMeta[item.type] || typeMeta.post_comment;
    const unread = !item.read_at;
    return `
      <button
        type="button"
        class="notification-row${unread ? ' is-unread' : ''}"
        data-notification-id="${escapeHtml(String(item.id || ''))}"
        data-target-path="${escapeHtml(normalizeTarget(item.target_path))}"
      >
        <span class="notification-row__icon" aria-hidden="true">${meta.icon}</span>
        <span class="notification-row__copy">
          <span class="notification-row__meta">${escapeHtml(meta.label)} · ${escapeHtml(formatRelativeTime(item.created_at))}</span>
          <strong>${escapeHtml(item.title || '새 알림')}</strong>
          ${item.body ? `<span>${escapeHtml(item.body)}</span>` : ''}
        </span>
        ${unread ? '<span class="notification-row__dot" aria-label="읽지 않음"></span>' : ''}
      </button>
    `;
  }

  function normalizeTarget(value) {
    const target = typeof value === 'string' ? value.trim() : '';
    if (!target.startsWith('/') || target.startsWith('//') || target.startsWith('/(auth)')) return '/notifications';
    if (target === '/growth') return '/html/growth.html';
    if (target.startsWith('/(tabs)')) return '/';
    return target;
  }

  function formatRelativeTime(value) {
    const time = Date.parse(value || '');
    if (!Number.isFinite(time)) return '';
    const seconds = Math.max(0, Math.floor((Date.now() - time) / 1000));
    if (seconds < 60) return '방금 전';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}분 전`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}시간 전`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)}일 전`;
    return typeof formatKoreanDateTime === 'function' ? formatKoreanDateTime(value) : value;
  }

  async function onNotificationClick(event) {
    const row = event.target.closest('[data-notification-id]');
    if (!row) return;
    const id = row.dataset.notificationId;
    const target = normalizeTarget(row.dataset.targetPath);
    row.classList.remove('is-unread');
    row.querySelector('.notification-row__dot')?.remove();
    const item = state.items.find((candidate) => String(candidate.id) === String(id));
    if (item) item.read_at = item.read_at || new Date().toISOString();
    updateHeaderBadge(state.items.filter((candidate) => !candidate.read_at).length);

    try {
      await fetch(`/api/notifications/${encodeURIComponent(id)}/read`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
    } catch (error) {
      // Navigation should still work if read state persistence fails.
    }
    if (target !== '/notifications') window.location.href = target;
  }

  async function markAllRead() {
    const button = document.getElementById('notificationsReadAll');
    if (button) button.disabled = true;
    try {
      const res = await fetch('/api/activity/read-all', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.message || '읽음 처리에 실패했습니다.');
      state.items.forEach((item) => { item.read_at = item.read_at || new Date().toISOString(); });
      render();
      updateHeaderBadge(0);
    } catch (error) {
      alert(error.message || '알림 읽음 처리에 실패했습니다.');
    } finally {
      if (button) button.disabled = false;
    }
  }

  function updateHeaderBadge(count) {
    document.querySelectorAll('[data-notification-unread]').forEach((badge) => {
      badge.textContent = count > 99 ? '99+' : String(count);
      badge.classList.toggle('gls-hidden', count <= 0);
      badge.setAttribute('aria-label', `읽지 않은 알림 ${count}개`);
    });
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', NotificationInbox.init);
