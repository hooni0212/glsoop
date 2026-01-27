// public/js/admin.js
// 글숲 관리자 페이지 스크립트 (모듈 방식)

window.Glsoop = window.Glsoop || {};

Glsoop.AdminPage = (function () {
  const postsState = {
    page: 1,
    limit: 48,
    search: '',
    category: 'all',
    sort: 'recent',
    range: 'all',
  };

  const questState = {
    templates: [],
    campaigns: [],
    campaignItems: [],
  };

  const THEME_LABELS = {
    spring: '봄',
    summer: '여름',
    autumn: '가을',
    winter: '겨울',
  };

  const CONDITION_LABELS = {
    POST_COUNT_TOTAL: '총 글 작성',
    POST_COUNT_BY_CATEGORY: '카테고리별 글 작성',
    LIKE_GIVEN: '공감 남기기',
    LIKE_RECEIVED: '공감 받기',
    BOOKMARK_GIVEN: '북마크 추가',
    BOOKMARK_RECEIVED: '북마크 받기',
    STREAK_DAYS: '연속 글쓰기',
  };

  const CAMPAIGN_TYPE_LABELS = {
    permanent: '상시',
    daily: '일일',
    weekly: '주간',
    season: '시즌',
    event: '이벤트',
  };

  /**
   * 엔트리 포인트
   */
  async function init() {
    const statusBox = document.getElementById('adminStatus');
    const contentBox = document.getElementById('adminContent');
    const usersBox = document.getElementById('adminUsers');
    const postsBox = document.getElementById('adminPosts');

    if (!statusBox || !contentBox || !usersBox || !postsBox) {
      console.error(
        'adminStatus / adminContent / adminUsers / adminPosts 요소를 찾을 수 없습니다.'
      );
      return;
    }

    setupThemeControls();
    setupTabSwitching();
    setupModalEvents();

    const me = await fetchMeAsAdmin();
    if (!me) return;

    statusBox.innerHTML = `
      <p class="gls-mb-1">
        <strong>${escapeHtml(me.name)}</strong> 님, 관리자 권한으로 접속했습니다.
      </p>
      <p class="gls-text-muted gls-mb-0">
        회원과 게시글, 퀘스트를 이 페이지에서 관리할 수 있습니다.
      </p>
    `;
    contentBox.style.display = 'block';

    await loadUsers(usersBox);
    setupPostsUi(postsBox);
    await loadPosts(postsBox);
    await loadQuestTemplates();
    await loadQuestCampaigns();
    setupAchievementBackfillButton();
  }

  function setupThemeControls() {
    const radios = document.querySelectorAll('input[name="adminTheme"]');
    const preview = document.querySelector('.admin-theme-preview');
    const applyBtn = document.getElementById('applyThemeBtn');
    if (!radios.length) return;

    const themeApi = window.Glsoop?.Theme;
    const allowed = themeApi?.ALLOWED_THEMES || ['spring', 'summer', 'autumn', 'winter'];
    const defaultTheme = themeApi?.DEFAULT_THEME || 'winter';

    let appliedTheme = themeApi?.readTheme ? themeApi.readTheme() : readThemeLegacy();
    appliedTheme = allowed.includes(appliedTheme) ? appliedTheme : defaultTheme;
    let pendingTheme = appliedTheme;

    applyPreview(appliedTheme, false);

    radios.forEach((radio) => {
      radio.checked = radio.value === appliedTheme;
      radio.addEventListener('change', () => {
        if (!radio.checked) return;
        pendingTheme = radio.value;
        applyPreview(pendingTheme, pendingTheme !== appliedTheme);
      });
    });

    applyBtn?.addEventListener('click', () => {
      const next = applyPreview(pendingTheme, false);
      appliedTheme = next;
      persistTheme(next);
    });

    function applyPreview(theme, showPending) {
      const safeTheme = allowed.includes(theme) ? theme : defaultTheme;
      const applied = themeApi?.applyTheme
        ? themeApi.applyTheme(safeTheme)
        : legacyApplyTheme(safeTheme, allowed);

      if (preview) {
        preview.textContent = showPending
          ? `미리보기: ${THEME_LABELS[applied] || applied} (적용 버튼을 눌러 저장)`
          : `현재 테마: ${THEME_LABELS[applied] || applied}`;
      }

      return applied;
    }

    function persistTheme(theme) {
      if (themeApi?.persistTheme) {
        themeApi.persistTheme(theme);
        return;
      }
      try {
        localStorage.setItem('gls-admin-theme', theme);
      } catch (e) {
        console.warn('테마를 로컬스토리지에 저장할 수 없습니다.', e);
      }
    }

    function readThemeLegacy() {
      try {
        return localStorage.getItem('gls-admin-theme') || defaultTheme;
      } catch (e) {
        console.warn('테마를 로컬스토리지에서 읽을 수 없습니다.', e);
        return defaultTheme;
      }
    }
  }

  function legacyApplyTheme(theme, allowed) {
    const body = document.body;
    allowed.forEach((t) => body.classList.remove(`${t}-theme`));
    body.classList.add(`${theme}-theme`);
    return theme;
  }

  function setupTabSwitching() {
    const tabButtons = document.querySelectorAll('.admin-tabs .nav-link');
    const panels = document.querySelectorAll('.tab-panel');
    if (!tabButtons.length || !panels.length) return;

    tabButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const targetId = btn.getAttribute('data-target');
        if (!targetId) return;

        tabButtons.forEach((b) => b.classList.toggle('active', b === btn));
        panels.forEach((panel) => {
          const isTarget = panel.id === targetId;
          panel.classList.toggle('gls-hidden', !isTarget);
        });
      });
    });
  }

  function setupModalEvents() {
    document.body.addEventListener('click', (e) => {
      const dismissTarget = e.target.getAttribute?.('data-dismiss');
      if (dismissTarget === 'adminPostModal') {
        closePostModal();
      }
      if (e.target.id === 'adminPostModalDelete') {
        const modal = document.getElementById('adminPostModal');
        const postId = modal?.dataset?.postId;
        const card = document.querySelector(`.admin-post-card[data-post-id="${postId}"]`);
        confirmAndDeletePost(postId, card);
      }
    });
  }

  async function fetchMeAsAdmin() {
    try {
      const meRes = await fetch('/api/me');
      if (!meRes.ok) {
        alert('로그인이 필요한 페이지입니다.');
        window.location.href = '/html/login.html?next=/admin';
        return null;
      }
      const meData = await meRes.json();
      if (!meData.ok) {
        alert('로그인이 필요한 페이지입니다.');
        window.location.href = '/html/login.html?next=/admin';
        return null;
      }
      if (!meData.is_admin) {
        alert('관리자만 접근할 수 있는 페이지입니다.');
        window.location.href = '/index.html';
        return null;
      }
      return meData;
    } catch (e) {
      console.error(e);
      alert('접근 권한 확인 중 오류가 발생했습니다.');
      window.location.href = '/index.html';
      return null;
    }
  }

  async function loadUsers(usersBox) {
    try {
      const res = await fetch('/api/admin/users');
      if (!res.ok) {
        usersBox.innerHTML =
          '<p class="text-danger">회원 목록을 불러오는 중 오류가 발생했습니다.</p>';
        return;
      }
      const data = await res.json();
      if (!data.ok) {
        usersBox.innerHTML = `<p class="text-danger">${
          data.message || '회원 목록을 불러오지 못했습니다.'
        }</p>`;
        return;
      }
      const users = data.users || [];
      if (!users.length) {
        usersBox.innerHTML = '<p class="gls-text-muted">현재 가입된 회원이 없습니다.</p>';
        return;
      }
      usersBox.innerHTML = buildUsersTableHtml(users);
      const tbody = usersBox.querySelector('tbody');
      tbody?.addEventListener('click', (e) => handleUserTableClick(e, tbody, usersBox));
    } catch (e) {
      console.error(e);
      usersBox.innerHTML =
        '<p class="text-danger">회원 목록을 불러오는 중 오류가 발생했습니다.</p>';
    }
  }

  function buildUsersTableHtml(users) {
    const rowsHtml = users
      .map((u) => {
        const isAdminBadge = u.is_admin
          ? '<span class="gls-badge gls-badge--danger gls-ms-1">관리자</span>'
          : '';
        const isVerifiedBadge =
          u.is_verified && Number(u.is_verified) === 1
            ? '<span class="gls-badge gls-badge--success gls-ms-1">인증완료</span>'
            : '<span class="gls-badge gls-badge--muted gls-ms-1">미인증</span>';
        const nicknameText =
          u.nickname && String(u.nickname).trim().length > 0
            ? escapeHtml(u.nickname)
            : '<span class="gls-text-muted">-</span>';
        const maskedEmail = maskEmail(u.email);
        return `
          <tr data-user-id="${u.id}">
            <td>${u.id}</td>
            <td>${escapeHtml(u.name)}${isAdminBadge}</td>
            <td>${nicknameText}</td>
            <td>${escapeHtml(maskedEmail || u.email || '')}</td>
            <td>${isVerifiedBadge}</td>
            <td>
              <button
                type="button"
                class="gls-btn gls-btn-danger gls-btn-xs admin-delete-user-btn"
              >
                삭제
              </button>
            </td>
          </tr>
        `;
      })
      .join('');

    return `
      <div class="table-responsive">
        <table class="table align-middle">
          <thead>
            <tr>
              <th style="width: 60px;">ID</th>
              <th style="width: 160px;">이름</th>
              <th style="width: 160px;">닉네임</th>
              <th>이메일</th>
              <th style="width: 120px;">인증 상태</th>
              <th style="width: 80px;">관리</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
      </div>
    `;
  }

  async function handleUserTableClick(e, tbody, usersBox) {
    const target = e.target;
    if (!target.classList.contains('admin-delete-user-btn')) return;
    const tr = target.closest('tr');
    if (!tr) return;
    const userId = tr.getAttribute('data-user-id');
    if (!userId) return;
    const ok = confirm('정말 이 회원을 삭제하시겠습니까? 관련 글/공감도 함께 삭제됩니다.');
    if (!ok) return;
    try {
      const delRes = await fetch(`/api/admin/users/${userId}`, { method: 'DELETE' });
      const delData = await delRes.json();
      if (!delRes.ok || !delData.ok) {
        alert(delData.message || '회원 삭제에 실패했습니다.');
        return;
      }
      tr.remove();
      if (!tbody.children.length) {
        usersBox.innerHTML = '<p class="gls-text-muted">현재 가입된 회원이 없습니다.</p>';
      }
    } catch (err) {
      console.error(err);
      alert('회원 삭제 중 오류가 발생했습니다.');
    }
  }

  function setupPostsUi(postsBox) {
    if (!postsBox) return;
    const filterBox = document.getElementById('adminPostsFilters');
    if (filterBox) {
      filterBox.innerHTML = `
        <div class="admin-toolbar">
          <input type="search" class="gls-input gls-input-sm" id="adminPostsSearch" placeholder="제목/작성자 검색" value="${
            postsState.search
          }" />
          <select class="gls-select gls-select-sm" id="adminPostsCategory">
            <option value="all">전체</option>
            <option value="poem">시</option>
            <option value="essay">에세이</option>
            <option value="short">짧은 구절</option>
          </select>
          <select class="gls-select gls-select-sm" id="adminPostsRange">
            <option value="all">전체 기간</option>
            <option value="7">최근 7일</option>
            <option value="30">최근 30일</option>
          </select>
          <select class="gls-select gls-select-sm" id="adminPostsSort">
            <option value="recent">최신순</option>
            <option value="oldest">오래된순</option>
            <option value="likes">공감 많은순</option>
          </select>
          <select class="gls-select gls-select-sm" id="adminPostsLimit">
            <option value="24">24개씩</option>
            <option value="48" selected>48개씩</option>
            <option value="96">96개씩</option>
          </select>
          <button class="gls-btn gls-btn-primary gls-btn-sm" id="adminPostsApply" type="button">적용</button>
        </div>
      `;
      filterBox.addEventListener('click', (e) => {
        if (e.target.id === 'adminPostsApply') {
          const searchInput = document.getElementById('adminPostsSearch');
          const category = document.getElementById('adminPostsCategory');
          const sort = document.getElementById('adminPostsSort');
          const range = document.getElementById('adminPostsRange');
          const limit = document.getElementById('adminPostsLimit');
          postsState.search = searchInput?.value?.trim() || '';
          postsState.category = category?.value || 'all';
          postsState.sort = sort?.value || 'recent';
          postsState.range = range?.value || 'all';
          postsState.limit = Number(limit?.value) || 48;
          postsState.page = 1;
          loadPosts(postsBox);
        }
      });
    }

    postsBox.innerHTML = `
      <div id="adminPostsGrid" class="admin-posts-grid"></div>
      <div id="adminPostsPagination" class="admin-pagination"></div>
    `;
  }

  async function loadPosts(postsBox) {
    const grid = postsBox?.querySelector('#adminPostsGrid');
    const pagination = postsBox?.querySelector('#adminPostsPagination');
    if (!grid) return;
    grid.innerHTML = '<p class="gls-text-muted">글 목록을 불러오는 중입니다...</p>';
    if (pagination) pagination.innerHTML = '';

    const params = new URLSearchParams({
      search: postsState.search,
      category: postsState.category,
      sort: postsState.sort,
      range: postsState.range,
      page: postsState.page,
      limit: postsState.limit,
    });

    try {
      const res = await fetch(`/api/admin/posts?${params.toString()}`);
      if (res.status === 401 || res.status === 403) {
        const txt = await res.text();
        alert(txt || '로그인/권한을 다시 확인해주세요.');
        window.location.href = '/html/login.html?next=/admin';
        return;
      }
      if (res.status === 404) {
        const txt = await res.text();
        throw new Error(`관리자 글 API를 찾을 수 없습니다. status=404 body=${txt.slice(0, 200)}`);
      }
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`status=${res.status} body=${txt.slice(0, 200)}`);
      }

      const data = await res.json();
      if (!data?.ok) {
        grid.innerHTML = `<p class="text-danger">${
          data?.message || '글 목록을 불러오는 중 오류가 발생했습니다.'
        }</p>`;
        return;
      }

      const posts = data.items || data.posts || [];
      if (!posts.length) {
        grid.innerHTML = '<p class="gls-text-muted">등록된 글이 없습니다.</p>';
      } else {
        grid.innerHTML = buildPostsHtml(posts);
      }

      if (pagination) {
        pagination.innerHTML = buildPagination(data.page, data.page_size, data.total);
        pagination.onclick = handlePaginationClick;
      }

      grid.onclick = (e) => handlePostGridClick(e, grid);
    } catch (e) {
      console.error('admin posts 로드 실패:', e);
      const msg = typeof e?.message === 'string' ? e.message : '글 목록을 불러오는 중 오류가 발생했습니다.';
      grid.innerHTML = `<p class="text-danger">${escapeHtml(msg)}</p>`;
    }
  }

  function buildPostsHtml(posts) {
    return posts
      .map((post) => {
        const dateStr = post.created_at
          ? String(post.created_at).replace('T', ' ').slice(0, 16)
          : '';
        const nickname =
          post.author_nickname && post.author_nickname.trim().length > 0
            ? post.author_nickname.trim()
            : '';
        const baseName =
          nickname ||
          (post.author_name && post.author_name.trim().length > 0
            ? post.author_name.trim()
            : '익명');
        const maskedEmail = maskEmail(post.author_email);
        const author = maskedEmail ? `${baseName} (${maskedEmail})` : baseName;
        const snippet = (post.content || '').replace(/<[^>]+>/g, '').slice(0, 80);
        return `
          <article class="admin-post-card" data-post-id="${post.id}">
            <div class="admin-post-card__top">
              <span class="gls-badge gls-badge-soft admin-post-card__category">${
                post.category || '카테고리 없음'
              }</span>
              <button class="gls-btn gls-btn-ghost gls-btn-xs admin-post-card__delete" type="button" aria-label="삭제" title="삭제">
                ×
              </button>
            </div>
            <h5 class="admin-post-card__title">${escapeHtml(post.title)}</h5>
            <p class="admin-post-card__meta">${escapeHtml(author)} · ${dateStr}</p>
            <p class="admin-post-card__snippet">${escapeHtml(snippet)}${
          snippet.length >= 80 ? '…' : ''
        }</p>
            <div class="gls-spread admin-post-card__footer">
              <span class="gls-text-muted gls-text-small">❤ ${post.like_count || 0}</span>
              <button class="gls-btn gls-btn-secondary gls-btn-xs admin-post-card__preview" type="button">미리보기</button>
            </div>
          </article>
        `;
      })
      .join('');
  }

  function buildPagination(page, pageSize, total) {
    const totalPages = Math.max(Math.ceil(total / pageSize), 1);
    const prevDisabled = page <= 1 ? 'disabled' : '';
    const nextDisabled = page >= totalPages ? 'disabled' : '';
    return `
      <div class="gls-spread gls-w-100">
        <button class="gls-btn gls-btn-secondary gls-btn-xs" data-page="${page - 1}" ${prevDisabled}>이전</button>
        <span class="gls-text-muted gls-text-small">${page} / ${totalPages} 페이지 · 총 ${total}건</span>
        <button class="gls-btn gls-btn-secondary gls-btn-xs" data-page="${page + 1}" ${nextDisabled}>다음</button>
      </div>
    `;
  }

  function handlePaginationClick(e) {
    const btn = e.target.closest('button[data-page]');
    if (!btn || btn.disabled) return;
    const nextPage = Number(btn.getAttribute('data-page'));
    if (!Number.isFinite(nextPage) || nextPage < 1) return;
    postsState.page = nextPage;
    loadPosts(document.getElementById('adminPosts'));
  }

  function handlePostGridClick(e) {
    const deleteBtn = e.target.closest('.admin-post-card__delete');
    const previewBtn = e.target.closest('.admin-post-card__preview');
    const card = e.target.closest('.admin-post-card');
    if (!card) return;
    const postId = card.getAttribute('data-post-id');

    if (deleteBtn) {
      confirmAndDeletePost(postId, card);
      return;
    }
    if (previewBtn) {
      const targetUrl = `/html/post.html?id=${encodeURIComponent(postId)}`;
      window.open(targetUrl, '_blank');
    }
  }

  async function openPostModal(postId) {
    if (!postId) return;
    const modal = document.getElementById('adminPostModal');
    if (!modal) return;
    try {
      const res = await fetch(`/api/admin/posts/${postId}`);
      if (res.status === 401 || res.status === 403) {
        const txt = await res.text();
        alert(txt || '관리자 권한을 다시 확인해주세요.');
        window.location.href = '/html/login.html?next=/admin';
        return;
      }
      if (res.status === 404) {
        const txt = await res.text();
        throw new Error(`관리자 템플릿 API가 없습니다. status=404 body=${txt.slice(0, 200)}`);
      }
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`status=${res.status} body=${txt.slice(0, 200)}`);
      }
      const data = await res.json();
      if (!data.ok || !data.post) {
        alert(data?.message || '글 정보를 불러오지 못했습니다.');
        return;
      }
      const post = data.post;
      modal.dataset.postId = postId;
      document.getElementById('adminPostModalTitle').innerText = post.title || '';
      const maskedEmail = maskEmail(post.author_email);
      const authorLine = maskedEmail
        ? `${post.author_nickname || post.author_name || '익명'} (${maskedEmail})`
        : post.author_nickname || post.author_name || '익명';
      const meta = `${authorLine} · ${
        post.created_at ? String(post.created_at).replace('T', ' ').slice(0, 16) : ''
      } · ${post.category || ''}`;
      document.getElementById('adminPostModalMeta').innerText = meta;
      document.getElementById('adminPostModalBody').innerHTML = sanitizePostHtml(post.content || '');
      modal.classList.remove('gls-hidden');
    } catch (err) {
      console.error(err);
      alert('글 정보를 불러오는 중 오류가 발생했습니다.');
    }
  }

  function closePostModal() {
    const modal = document.getElementById('adminPostModal');
    if (!modal) return;
    modal.classList.add('gls-hidden');
    modal.dataset.postId = '';
  }

  async function confirmAndDeletePost(postId, card) {
    if (!postId) return;
    const ok = confirm(`정말 이 글(ID: ${postId})을 삭제하시겠습니까?`);
    if (!ok) return;
    try {
      const delRes = await fetch(`/api/admin/posts/${postId}`, { method: 'DELETE' });
      if (!delRes.ok) {
        const txt = await delRes.text();
        throw new Error(`status=${delRes.status} body=${txt.slice(0, 200)}`);
      }
      const delData = await delRes.json();
      if (!delData.ok) {
        alert(delData.message || '글 삭제에 실패했습니다.');
        return;
      }
      if (card) card.remove();
      const grid = document.getElementById('adminPostsGrid');
      if (grid && !grid.querySelector('.admin-post-card')) {
        grid.innerHTML = '<p class="gls-text-muted">등록된 글이 없습니다.</p>';
      }
      closePostModal();
    } catch (err) {
      console.error(err);
      alert('글 삭제 중 오류가 발생했습니다.');
    }
  }

  async function loadQuestTemplates() {
      const box = document.getElementById('questTemplates');
      if (!box) return;
      box.innerHTML = '<p class="gls-text-muted">템플릿을 불러오는 중입니다...</p>';
      try {
        const res = await fetch('/api/admin/quest-templates');
        if (res.status === 401 || res.status === 403) {
          const txt = await res.text();
          box.innerHTML = `<p class="text-danger">${txt || '권한을 다시 확인해주세요.'}</p>`;
          return;
        }
        if (res.status === 404) {
          const txt = await res.text();
          throw new Error(`관리자 템플릿 API가 없습니다. status=404 body=${txt.slice(0, 200)}`);
        }
        if (!res.ok) {
          const txt = await res.text();
          throw new Error(`status=${res.status} body=${txt.slice(0, 200)}`);
        }
        const data = await res.json();
        if (!data.ok) {
          box.innerHTML = `<p class="text-danger">${
            data?.message || '템플릿 조회에 실패했습니다.'
          }</p>`;
          return;
        }
        questState.templates = data.items || data.templates || [];
        box.innerHTML = buildTemplateEditor();
        bindTemplateEvents();
      } catch (err) {
      console.error(err);
      box.innerHTML = '<p class="text-danger">템플릿 조회 중 오류가 발생했습니다.</p>';
    }
  }

  function setupAchievementBackfillButton() {
    const btn = document.getElementById('achievementBackfillBtn');
    if (!btn) return;
    btn.addEventListener('click', async () => {
      if (!confirm('현재 업적 템플릿을 모든 유저에게 부여하시겠습니까?')) return;
      btn.disabled = true;
      try {
        const res = await fetch('/api/admin/quests/achievements/backfill', { method: 'POST' });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          alert(data.message || '업적 backfill에 실패했습니다.');
          return;
        }
        alert(`업적 backfill 완료: ${data.inserted || 0}건`);
      } catch (err) {
        console.error(err);
        alert('업적 backfill 중 오류가 발생했습니다.');
      } finally {
        btn.disabled = false;
      }
    });
  }

  function buildTemplateEditor(editingId = '') {
    const target = questState.templates.find((t) => String(t.id) === String(editingId));
    const values = target || {};
    const listHtml = questState.templates
      .map(
        (t) => `
        <tr data-template-id="${t.id}">
          <td>${escapeHtml(t.name)}</td>
          <td><span class="gls-badge gls-badge-soft">${escapeHtml(
            CONDITION_LABELS[t.condition_type] || t.condition_type
          )}</span> ${
            t.category ? `<span class="gls-badge gls-badge--muted gls-ms-1">${escapeHtml(t.category)}</span>` : ''
          }</td>
          <td>${t.target_value}</td>
          <td>${t.reward_xp || 0} XP</td>
          <td>${escapeHtml(t.template_kind || 'quest')}</td>
          <td>${escapeHtml(t.code || '-')}</td>
          <td>${t.is_active ? '활성' : '비활성'}</td>
          <td class="gls-text-end">
            <button class="gls-btn gls-btn-secondary gls-btn-xs quest-template-edit" type="button">수정</button>
            <button class="gls-btn gls-btn-danger gls-btn-xs quest-template-delete" type="button">삭제</button>
          </td>
        </tr>`
      )
      .join('');

    return `
      <form id="questTemplateForm" class="quest-form card gls-mb-3 gls-p-3">
        <div class="gls-spread gls-mb-2">
          <h5 class="gls-mb-0">${editingId ? '템플릿 수정' : '새 템플릿 추가'}</h5>
          <button class="gls-btn gls-btn-secondary gls-btn-xs" type="button" id="questTemplateReset">초기화</button>
        </div>
        <div class="gls-grid gls-grid-12 gls-gap-2">
          <div class="gls-col-span-12 gls-md-col-span-4">
            <label class="gls-label gls-text-small gls-mb-1">제목</label>
            <input class="gls-input gls-input-sm" name="name" value="${escapeHtml(
              values.name || ''
            )}" required />
          </div>
          <div class="gls-col-span-12 gls-md-col-span-4">
            <label class="gls-label gls-text-small gls-mb-1">조건 타입</label>
            <select class="gls-select gls-select-sm" name="condition_type" required>
              ${buildConditionOptions(values.condition_type)}
            </select>
          </div>
          <div class="gls-col-span-12 gls-md-col-span-4">
            <label class="gls-label gls-text-small gls-mb-1">카테고리(선택)</label>
            <select class="gls-select gls-select-sm" name="category">
              <option value="">(전체)</option>
              <option value="poem" ${values.category === 'poem' ? 'selected' : ''}>시</option>
              <option value="essay" ${values.category === 'essay' ? 'selected' : ''}>에세이</option>
              <option value="short" ${values.category === 'short' ? 'selected' : ''}>짧은 구절</option>
            </select>
          </div>
          <div class="gls-col-span-12 gls-md-col-span-3">
            <label class="gls-label gls-text-small gls-mb-1">목표</label>
            <input type="number" min="1" class="gls-input gls-input-sm" name="target_value" value="${
              values.target_value || ''
            }" required />
          </div>
          <div class="gls-col-span-12 gls-md-col-span-3">
            <label class="gls-label gls-text-small gls-mb-1">템플릿 종류</label>
            <select class="gls-select gls-select-sm" name="template_kind">
              <option value="quest" ${values.template_kind !== 'achievement' ? 'selected' : ''}>퀘스트</option>
              <option value="achievement" ${values.template_kind === 'achievement' ? 'selected' : ''}>업적</option>
            </select>
          </div>
          <div class="gls-col-span-12 gls-md-col-span-3">
            <label class="gls-label gls-text-small gls-mb-1">보상 XP</label>
            <input type="number" min="0" class="gls-input gls-input-sm" name="reward_xp" value="${
              values.reward_xp || 0
            }" />
          </div>
          <div class="gls-col-span-12 gls-md-col-span-6">
            <label class="gls-label gls-text-small gls-mb-1">설명</label>
            <input class="gls-input gls-input-sm" name="description" value="${escapeHtml(
              values.description || ''
            )}" />
          </div>
          <div class="gls-col-span-12 gls-md-col-span-3">
            <label class="gls-label gls-text-small gls-mb-1">코드(선택)</label>
            <input class="gls-input gls-input-sm" name="code" value="${escapeHtml(values.code || '')}" />
          </div>
          <div class="gls-col-span-12">
            <label class="gls-label gls-text-small gls-mb-1">UI 메타(JSON)</label>
            <textarea class="gls-input gls-input-sm" name="ui_json" rows="2" placeholder='{"icon":"🌟","label":"업적"}'>${escapeHtml(
              values.ui_json || ''
            )}</textarea>
          </div>
          <div class="gls-col-span-12 gls-md-col-span-3 gls-flex gls-items-end">
            <div class="gls-check">
              <input class="gls-check-input" type="checkbox" name="is_active" id="templateActive" ${
                values.is_active || editingId === '' ? 'checked' : ''
              } />
              <label class="gls-check-label" for="templateActive">활성</label>
            </div>
          </div>
        </div>
        <div class="gls-text-end gls-mt-3">
          <input type="hidden" name="id" value="${editingId}" />
          <button class="gls-btn gls-btn-primary gls-btn-sm" type="submit">${editingId ? '수정 저장' : '추가'}</button>
        </div>
      </form>
      <div class="table-responsive">
        <table class="table align-middle table-sm">
          <thead><tr><th>제목</th><th>조건</th><th>목표</th><th>보상</th><th>종류</th><th>코드</th><th>상태</th><th class="gls-text-end">관리</th></tr></thead>
          <tbody>${listHtml}</tbody>
        </table>
      </div>
    `;
  }

  function bindTemplateEvents() {
    const box = document.getElementById('questTemplates');
    if (!box) return;
    const form = box.querySelector('#questTemplateForm');
    const resetBtn = box.querySelector('#questTemplateReset');
    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const formData = new FormData(form);
      const payload = Object.fromEntries(formData.entries());
      payload.is_active = formData.get('is_active') ? 1 : 0;
      const isEdit = payload.id;
      const method = isEdit ? 'PUT' : 'POST';
      const url = isEdit
        ? `/api/admin/quest-templates/${payload.id}`
        : '/api/admin/quest-templates';
      try {
        const res = await fetch(url, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          alert(data.message || '저장에 실패했습니다.');
          return;
        }
        await loadQuestTemplates();
        await loadQuestCampaigns();
      } catch (err) {
        console.error(err);
        alert('템플릿 저장 중 오류가 발생했습니다.');
      }
    });

    resetBtn?.addEventListener('click', () => {
      box.innerHTML = buildTemplateEditor();
      bindTemplateEvents();
    });

    box.querySelectorAll('.quest-template-edit').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const id = e.target.closest('tr')?.dataset?.templateId;
        box.innerHTML = buildTemplateEditor(id);
        bindTemplateEvents();
      });
    });
    box.querySelectorAll('.quest-template-delete').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        const id = e.target.closest('tr')?.dataset?.templateId;
        if (!id) return;
        if (!confirm('이 템플릿을 삭제하시겠습니까?')) return;
        try {
          const res = await fetch(`/api/admin/quest-templates/${id}`, { method: 'DELETE' });
          const data = await res.json();
          if (!res.ok || !data.ok) {
            alert(data.message || '삭제에 실패했습니다.');
            return;
          }
          await loadQuestTemplates();
          await loadQuestCampaigns();
        } catch (err) {
          console.error(err);
          alert('템플릿 삭제 중 오류가 발생했습니다.');
        }
      });
    });
  }

  function buildConditionOptions(selected) {
    const options = [
      'POST_COUNT_TOTAL',
      'POST_COUNT_BY_CATEGORY',
      'LIKE_GIVEN',
      'LIKE_RECEIVED',
      'BOOKMARK_GIVEN',
      'BOOKMARK_RECEIVED',
      'STREAK_DAYS',
    ];
    return options
      .map(
        (opt) => `<option value="${opt}" ${selected === opt ? 'selected' : ''}>${
          CONDITION_LABELS[opt] || opt
        }</option>`
      )
      .join('');
  }

  async function loadQuestCampaigns() {
    const box = document.getElementById('questCampaigns');
    if (!box) return;
    box.innerHTML = '<p class="gls-text-muted">캠페인을 불러오는 중입니다...</p>';
    try {
      const res = await fetch('/api/admin/quest-campaigns');
      if (res.status === 401 || res.status === 403) {
        const txt = await res.text();
        box.innerHTML = `<p class="text-danger">${txt || '권한을 다시 확인해주세요.'}</p>`;
        return;
      }
      if (res.status === 404) {
        const txt = await res.text();
        throw new Error(`관리자 캠페인 API가 없습니다. status=404 body=${txt.slice(0, 200)}`);
      }
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`status=${res.status} body=${txt.slice(0, 200)}`);
      }
      const data = await res.json();
      if (!data.ok) {
        box.innerHTML = `<p class="text-danger">${
          data?.message || '캠페인 조회에 실패했습니다.'
        }</p>`;
        return;
      }
      questState.campaigns = data.items || data.campaigns || [];
      questState.campaignItems = data.campaign_items || [];
      box.innerHTML = buildCampaignEditor();
      bindCampaignEvents();
      } catch (err) {
      console.error(err);
      box.innerHTML = '<p class="text-danger">캠페인 조회 중 오류가 발생했습니다.</p>';
    }
  }

  function buildCampaignEditor(editingId = '') {
    const target = questState.campaigns.find((c) => String(c.id) === String(editingId));
    const values = target || {};
    const typeOptions = ['permanent', 'daily', 'weekly', 'season', 'event'];
    const itemsByCampaign = questState.campaignItems.reduce((acc, cur) => {
      acc[cur.campaign_id] = acc[cur.campaign_id] || [];
      acc[cur.campaign_id].push(cur);
      return acc;
    }, {});
    const selectedItems = itemsByCampaign[values.id] || [];
    const selection = questState.templates
      .map((t) => {
        const found = selectedItems.find((i) => Number(i.template_id) === Number(t.id));
        return `
          <div class="gls-check gls-check-inline gls-mb-1">
            <input class="gls-check-input quest-campaign-template" type="checkbox" data-template-id="${t.id}" id="campaignTpl${t.id}" ${
          found ? 'checked' : ''
        } />
            <label class="gls-check-label" for="campaignTpl${t.id}">${escapeHtml(t.name)}</label>
            <input type="number" class="gls-input gls-input-sm gls-ms-2" style="width:80px" placeholder="순서" data-template-order="${t.id}" value="${
          found ? found.sort_order || 0 : ''
        }" />
          </div>`;
      })
      .join('');

    const listHtml = questState.campaigns
      .map(
        (c) => `
        <tr data-campaign-id="${c.id}">
          <td>${escapeHtml(c.name)}</td>
          <td>${escapeHtml(CAMPAIGN_TYPE_LABELS[c.campaign_type] || c.campaign_type || '')}</td>
          <td>${c.start_at || '-'} ~ ${c.end_at || '-'}</td>
          <td>${c.is_active ? '활성' : '비활성'} (priority ${c.priority || 1})</td>
          <td class="gls-text-end">
            <button class="gls-btn gls-btn-secondary gls-btn-xs quest-campaign-edit" type="button">편집</button>
            <button class="gls-btn gls-btn-danger gls-btn-xs quest-campaign-delete" type="button">삭제</button>
          </td>
        </tr>`
      )
      .join('');

    return `
      <form id="questCampaignForm" class="quest-form card gls-mb-3 gls-p-3">
        <div class="gls-spread gls-mb-2">
          <h5 class="gls-mb-0">${editingId ? '캠페인 수정' : '새 캠페인 추가'}</h5>
          <button class="gls-btn gls-btn-secondary gls-btn-xs" type="button" id="questCampaignReset">초기화</button>
        </div>
        <div class="gls-grid gls-grid-12 gls-gap-2">
          <div class="gls-col-span-12 gls-md-col-span-4">
            <label class="gls-label gls-text-small gls-mb-1">이름</label>
            <input class="gls-input gls-input-sm" name="name" value="${escapeHtml(
              values.name || ''
            )}" required />
          </div>
          <div class="gls-col-span-12 gls-md-col-span-3">
            <label class="gls-label gls-text-small gls-mb-1">유형</label>
            <select class="gls-select gls-select-sm" name="campaign_type">
              ${typeOptions
                .map(
                  (t) => `<option value="${t}" ${
                    (values.campaign_type || 'event') === t ? 'selected' : ''
                  }>${CAMPAIGN_TYPE_LABELS[t] || t}</option>`
                )
                .join('')}
            </select>
          </div>
          <div class="gls-col-span-12 gls-md-col-span-3">
            <label class="gls-label gls-text-small gls-mb-1">시작</label>
            <input type="datetime-local" class="gls-input gls-input-sm" name="start_at" value="${
              values.start_at ? values.start_at.replace(' ', 'T') : ''
            }" />
          </div>
          <div class="gls-col-span-12 gls-md-col-span-3">
            <label class="gls-label gls-text-small gls-mb-1">종료</label>
            <input type="datetime-local" class="gls-input gls-input-sm" name="end_at" value="${
              values.end_at ? values.end_at.replace(' ', 'T') : ''
            }" />
          </div>
          <div class="gls-col-span-12 gls-md-col-span-2">
            <label class="gls-label gls-text-small gls-mb-1">우선순위</label>
            <input type="number" class="gls-input gls-input-sm" name="priority" value="${
              values.priority || 1
            }" />
          </div>
          <div class="gls-col-span-12 gls-md-col-span-4">
            <label class="gls-label gls-text-small gls-mb-1">설명</label>
            <input class="gls-input gls-input-sm" name="description" value="${escapeHtml(
              values.description || ''
            )}" />
          </div>
          <div class="gls-col-span-12 gls-md-col-span-2 gls-flex gls-items-end">
            <div class="gls-check">
              <input class="gls-check-input" type="checkbox" name="is_active" id="campaignActive" ${
                values.is_active ? 'checked' : ''
              } />
              <label class="gls-check-label" for="campaignActive">활성</label>
            </div>
          </div>
        </div>
        <div class="gls-mt-3">
          <p class="gls-text-small gls-text-muted gls-mb-1">캠페인에 포함할 템플릿을 선택하고 정렬 순서를 지정하세요.</p>
          <div class="quest-template-select">
            ${selection || '<p class="gls-text-muted">등록된 템플릿이 없습니다.</p>'}
          </div>
        </div>
        <div class="gls-text-end gls-mt-3">
          <input type="hidden" name="id" value="${editingId}" />
          <button class="gls-btn gls-btn-primary gls-btn-sm" type="submit">${editingId ? '수정 저장' : '추가'}</button>
        </div>
      </form>
      <div class="table-responsive">
        <table class="table align-middle table-sm">
          <thead><tr><th>이름</th><th>유형</th><th>기간</th><th>상태</th><th class="gls-text-end">관리</th></tr></thead>
          <tbody>${listHtml}</tbody>
        </table>
      </div>
    `;
  }

  function bindCampaignEvents() {
    const box = document.getElementById('questCampaigns');
    if (!box) return;
    const form = box.querySelector('#questCampaignForm');
    const resetBtn = box.querySelector('#questCampaignReset');
    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const formData = new FormData(form);
      const payload = Object.fromEntries(formData.entries());
      payload.is_active = formData.get('is_active') ? 1 : 0;
      const isEdit = payload.id;
      const method = isEdit ? 'PUT' : 'POST';
      const url = isEdit
        ? `/api/admin/quest-campaigns/${payload.id}`
        : '/api/admin/quest-campaigns';
      try {
        const res = await fetch(url, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          alert(data.message || '캠페인 저장에 실패했습니다.');
          return;
        }
        if (isEdit) {
          await saveCampaignItems(payload.id, form);
        }
        await loadQuestCampaigns();
        await loadQuestTemplates();
      } catch (err) {
        console.error(err);
        alert('캠페인 저장 중 오류가 발생했습니다.');
      }
    });

    resetBtn?.addEventListener('click', () => {
      box.innerHTML = buildCampaignEditor();
      bindCampaignEvents();
    });

    box.querySelectorAll('.quest-campaign-edit').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const id = e.target.closest('tr')?.dataset?.campaignId;
        box.innerHTML = buildCampaignEditor(id);
        bindCampaignEvents();
      });
    });
    box.querySelectorAll('.quest-campaign-delete').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        const id = e.target.closest('tr')?.dataset?.campaignId;
        if (!id) return;
        if (!confirm('이 캠페인을 삭제하시겠습니까?')) return;
        try {
          const res = await fetch(`/api/admin/quest-campaigns/${id}`, { method: 'DELETE' });
          const data = await res.json();
          if (!res.ok || !data.ok) {
            alert(data.message || '삭제에 실패했습니다.');
            return;
          }
          await loadQuestCampaigns();
        } catch (err) {
          console.error(err);
          alert('캠페인 삭제 중 오류가 발생했습니다.');
        }
      });
    });
  }

  async function saveCampaignItems(campaignId, formEl) {
    const selectedTemplates = Array.from(
      formEl.querySelectorAll('.quest-template-select .quest-campaign-template')
    )
      .filter((el) => el.checked)
      .map((el) => {
        const templateId = el.getAttribute('data-template-id');
        const orderInput = formEl.querySelector(
          `input[data-template-order="${templateId}"]`
        );
        return {
          template_id: Number(templateId),
          sort_order: Number(orderInput?.value || 0),
        };
      });
    try {
      await fetch(`/api/admin/quest-campaigns/${campaignId}/items`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: selectedTemplates }),
      });
    } catch (err) {
      console.error(err);
    }
  }

  function escapeHtml(str = '') {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function maskEmail(email) {
    if (!email || typeof email !== 'string') return '';
    const [user, domain] = email.split('@');
    if (!domain) return email;
    const maskedUser = user.length <= 2 ? user[0] + '*' : user.slice(0, 2) + '***';
    return `${maskedUser}@${domain}`;
  }

  return {
    init,
  };
})();

// DOMContentLoaded 시점에 모듈 init 호출
document.addEventListener('DOMContentLoaded', () => {
  if (
    window.Glsoop &&
    Glsoop.AdminPage &&
    typeof Glsoop.AdminPage.init === 'function'
  ) {
    Glsoop.AdminPage.init();
  }
});
