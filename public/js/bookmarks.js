(() => {
  const listsEl = document.getElementById('bookmarkLists');
  const postsEl = document.getElementById('bookmarkPosts');
  const loadMoreWrap = document.getElementById('bookmarkLoadMoreWrap');
  const loadMoreBtn = document.getElementById('bookmarkLoadMore');
  const createBtn = document.getElementById('createListBtn');
  const listModalEl = document.getElementById('listFormModal');
  const nameInput = document.getElementById('listNameInput');
  const descInput = document.getElementById('listDescInput');
  const saveListBtn = document.getElementById('saveListBtn');
  const editIdInput = document.getElementById('listEditId');
  let activeListId = null;
  let loadingItems = false;
  let offset = 0;
  const LIMIT = 10;
  let hasMore = false;

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    await ensureLogin();
    await loadLists();
    bindEvents();
  }

  function bindEvents() {
    if (createBtn) {
      createBtn.addEventListener('click', () => openListModal());
    }
    if (saveListBtn) {
      saveListBtn.addEventListener('click', saveList);
    }
    if (loadMoreBtn) {
      loadMoreBtn.addEventListener('click', () => loadItems());
    }
  }

  async function ensureLogin() {
    try {
      const res = await fetch('/api/me', { cache: 'no-store' });
      if (!res.ok) throw new Error('login');
      const data = await res.json();
      if (!data.ok) throw new Error('login');
    } catch (e) {
      alert('로그인 후 이용할 수 있습니다.');
      window.location.href = '/html/login.html';
      throw e;
    }
  }

  async function loadLists(selectedId = null) {
    if (!listsEl) return;
    listsEl.innerHTML = '<li class="gls-text-muted">불러오는 중...</li>';
    try {
      const res = await fetch('/api/bookmarks/lists');
      if (res.status === 401) {
        alert('로그인 후 이용할 수 있습니다.');
        window.location.href = '/html/login.html';
        return;
      }
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.message || '북마크 폴더를 불러오지 못했습니다.');
      renderListItems(data.lists || [], selectedId);
    } catch (e) {
      console.error(e);
      listsEl.innerHTML = '<li class="text-danger">폴더를 불러오는 중 오류가 발생했습니다.</li>';
    }
  }

  function renderListItems(lists, selectedId = null) {
    listsEl.innerHTML = '';
    if (!lists.length) {
      listsEl.innerHTML = '<li class="gls-text-muted">아직 북마크 폴더가 없습니다. 상단의 + 버튼으로 새 폴더를 만들어 주세요.</li>';
      postsEl.innerHTML =
        '<div class="bookmark-empty-state"><span class="emoji" aria-hidden="true">📂</span><p class="gls-mb-1 fw-semibold">폴더를 만든 뒤 글을 저장해 보세요.</p><p class="gls-text-muted gls-text-small gls-mb-0">피드에서 마음에 드는 글을 북마크하면 여기서 모아볼 수 있습니다.</p></div>';
      loadMoreWrap.style.display = 'none';
      return;
    }

    lists.forEach((list) => {
    const item = document.createElement('li');
    item.className = 'bookmark-folder-item';
    item.dataset.listId = list.id;
    item.innerHTML = `
        <div class="bookmark-folder-name">${escapeHtml(list.name)}</div>
        <div class="bookmark-folder-desc">${escapeHtml(list.description || '')}</div>
        <div class="bookmark-folder-meta">
          <span class="bookmark-folder-count">글 ${list.item_count || 0}개</span>
          <div class="bookmark-folder-actions">
            <button class="gls-btn gls-btn-secondary gls-btn-xs" data-action="edit">수정</button>
            <button class="gls-btn gls-btn-danger gls-btn-xs" data-action="delete">삭제</button>
          </div>
        </div>
      `;

      item.addEventListener('click', (e) => {
        const action = e.target.getAttribute('data-action');
        if (action === 'edit') {
          e.stopPropagation();
          openListModal(list);
          return;
        }
        if (action === 'delete') {
          e.stopPropagation();
          confirmDelete(list.id);
          return;
        }
        selectList(list.id);
      });

      listsEl.appendChild(item);
    });

    const chosen = selectedId || lists[0].id;
    selectList(chosen);
  }

  function openListModal(list = null) {
    if (!listModalEl || !window.glsModal) return;
    nameInput.value = list ? list.name : '';
    descInput.value = list ? list.description || '' : '';
    editIdInput.value = list ? list.id : '';
    document.getElementById('listFormTitle').textContent = list
      ? '폴더 수정'
      : '새 폴더 만들기';
    window.glsModal.open(listModalEl);
  }

  async function saveList() {
    const name = nameInput.value.trim();
    const desc = descInput.value.trim();
    const editId = editIdInput.value;
    if (!name) {
      alert('폴더 이름을 입력하세요.');
      return;
    }

    const method = editId ? 'PATCH' : 'POST';
    const url = editId
      ? `/api/bookmarks/lists/${encodeURIComponent(editId)}`
      : '/api/bookmarks/lists';

    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description: desc }),
      });
      if (res.status === 401) {
        alert('로그인이 필요합니다.');
        return;
      }
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.message || '저장에 실패했습니다.');
      window.glsModal.close(listModalEl);
      await loadLists(editId || (data.list && data.list.id));
    } catch (e) {
      console.error(e);
      alert(e.message || '폴더 저장 중 오류가 발생했습니다.');
    }
  }

  async function confirmDelete(listId) {
    if (!confirm('정말 삭제하시겠습니까? 폴더 안의 글도 함께 삭제됩니다.')) return;
    try {
      const res = await fetch(`/api/bookmarks/lists/${encodeURIComponent(listId)}`, {
        method: 'DELETE',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.message || '삭제에 실패했습니다.');
      await loadLists();
    } catch (e) {
      console.error(e);
      alert(e.message || '폴더 삭제 중 오류가 발생했습니다.');
    }
  }

  function resetItems() {
    offset = 0;
    hasMore = false;
    postsEl.innerHTML = '';
    if (loadMoreWrap) loadMoreWrap.style.display = 'none';
  }

  async function selectList(listId) {
    if (activeListId === listId) {
      updateActiveListUI(listId);
      return;
    }
    activeListId = listId;
    updateActiveListUI(listId);
    resetItems();
    await loadItems();
  }

  function updateActiveListUI(listId) {
    const items = document.querySelectorAll('.bookmark-folder-item');
    items.forEach((el) => {
      if (String(el.dataset.listId) === String(listId)) {
        el.classList.add('is-active');
      } else {
        el.classList.remove('is-active');
      }
    });
  }

  async function loadItems() {
    if (!activeListId || loadingItems) return;
    loadingItems = true;
    try {
      const res = await fetch(
        `/api/bookmarks/lists/${encodeURIComponent(activeListId)}/items?limit=${LIMIT}&offset=${offset}`
      );
      if (res.status === 401) {
        alert('로그인 후 이용해주세요.');
        return;
      }
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.message || '글을 불러오지 못했습니다.');
      const posts = data.posts || [];
      if (offset === 0 && !posts.length) {
        renderEmptyState();
        hasMore = false;
        loadMoreWrap.style.display = 'none';
        return;
      }

      posts.forEach((post) => {
        const html = buildStandardPostCardHTML(post, { showMoreButton: true });
        const wrapper = document.createElement('div');
        wrapper.innerHTML = html.trim();
        const card = wrapper.firstElementChild;
        postsEl.appendChild(card);
        enhanceStandardPostCard(card, post);
      });

      offset += posts.length;
      hasMore = data.has_more;
      const hasCards = Boolean(postsEl.querySelector('.gls-post-card'));
      loadMoreWrap.style.display = hasCards && hasMore ? 'block' : 'none';
    } catch (e) {
      console.error(e);
      if (offset === 0) {
        postsEl.innerHTML = '<p class="text-danger">글을 불러오지 못했습니다.</p>';
      }
    } finally {
      loadingItems = false;
    }
  }

  function renderEmptyState() {
    postsEl.innerHTML = `
      <div class="bookmark-empty-state">
        <span class="emoji" aria-hidden="true">📁</span>
        <p class="gls-mb-1 fw-semibold">이 폴더에는 아직 저장된 글이 없습니다.</p>
        <p class="gls-text-muted gls-text-small gls-mb-0">피드에서 마음에 드는 글을 북마크해 보세요.</p>
      </div>
    `;
  }
})();
