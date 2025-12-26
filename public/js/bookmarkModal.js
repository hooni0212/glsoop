(function () {
  const modalId = 'bookmarkSelectModal';
  let currentPostId = null;
  let listContainer = null;
  let createInput = null;
  let createBtn = null;
  let statusText = null;

  function bindCreateInputEnter() {
    if (!createInput) return;
    if (createInput.dataset && createInput.dataset.enterBound === '1') return;
    if (createInput.dataset) createInput.dataset.enterBound = '1';
    createInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleCreateList();
      }
    });
  }

  function ensureModal() {
    let modalEl = document.getElementById(modalId);
    if (modalEl) {      listContainer = modalEl.querySelector('.bookmark-modal-list');
      createInput = modalEl.querySelector('#bookmarkNewListInput');
      createBtn = modalEl.querySelector('#bookmarkNewListSubmit');
      statusText = modalEl.querySelector('.bookmark-modal-status');
      bindCreateInputEnter();
      return;
    }

    const wrapper = document.createElement('div');
    wrapper.innerHTML = `
      <div class="modal fade gls-bookmark-modal" id="${modalId}" tabindex="-1" aria-hidden="true">
        <div class="modal-dialog modal-dialog-centered modal-dialog-scrollable">
          <div class="modal-content">
            <div class="modal-header">
              <h5 class="modal-title">북마크 폴더 선택</h5>
              <button type="button" class="gls-modal-close" data-gls-dismiss="modal" aria-label="Close"></button>
            </div>
            <div class="modal-body">
              <div class="bookmark-modal-status gls-text-muted gls-text-small gls-mb-2"></div>
              <div class="bookmark-modal-list list-group gls-mb-3"></div>
              <div class="bookmark-modal-create gls-flex gls-gap-2 gls-items-center">
                <input type="text" class="gls-input" id="bookmarkNewListInput" placeholder="새 폴더 이름" />
                <button class="gls-btn gls-btn-primary gls-btn-sm bookmark-modal-create-btn" type="button" id="bookmarkNewListSubmit">추가</button>
              </div>
            </div>
            <div class="modal-footer">
              <a href="/html/bookmarks.html" class="gls-btn gls-btn-secondary gls-btn-sm">북마크 페이지로 이동</a>
              <button type="button" class="gls-btn gls-btn-primary gls-btn-sm" data-gls-dismiss="modal">완료</button>
            </div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(wrapper.firstElementChild);

    modalEl = document.getElementById(modalId);    listContainer = modalEl.querySelector('.bookmark-modal-list');
    createInput = modalEl.querySelector('#bookmarkNewListInput');
    createBtn = modalEl.querySelector('#bookmarkNewListSubmit');
    statusText = modalEl.querySelector('.bookmark-modal-status');

    createBtn.addEventListener('click', handleCreateList);
    bindCreateInputEnter();
  }

  async function requireLogin(res) {
    if (res && res.status === 401) {
      alert('로그인 후 이용할 수 있습니다.');
      window.location.href = '/html/login.html';
      return true;
    }
    return false;
  }

  async function fetchLists() {
    const res = await fetch('/api/bookmarks/lists');
    if (await requireLogin(res)) return [];
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.message || '폴더를 불러오지 못했습니다.');
    return data.lists || [];
  }

  async function fetchPostMembership(postId) {
    const res = await fetch(`/api/posts/${encodeURIComponent(postId)}/bookmarks`);
    if (await requireLogin(res)) return [];
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.message || '북마크 정보를 불러오지 못했습니다.');
    return data.lists || [];
  }

  function renderLists(lists, selectedIds = new Set()) {
    if (!listContainer) return;
    if (!lists.length) {
      listContainer.innerHTML = '<div class="gls-text-muted gls-text-small">아직 폴더가 없습니다. 아래에서 새 폴더를 만들어주세요.</div>';
      return;
    }

    listContainer.innerHTML = '';
    lists.forEach((list) => {
      const item = document.createElement('label');
      item.className = 'list-group-item gls-flex gls-items-center gls-gap-2';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.className = 'gls-check-input';
      input.checked = selectedIds.has(list.id);
      input.addEventListener('change', () => toggleMembership(list.id, input.checked));
      item.appendChild(input);
      const span = document.createElement('span');
      span.textContent = list.name;
      item.appendChild(span);
      listContainer.appendChild(item);
    });
  }

  async function toggleMembership(listId, shouldContain) {
    if (!currentPostId) return;
    try {
      const url = `/api/bookmarks/lists/${encodeURIComponent(listId)}/items${
        shouldContain ? '' : '/' + encodeURIComponent(currentPostId)
      }`;
      const res = await fetch(url, {
        method: shouldContain ? 'POST' : 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: shouldContain
          ? JSON.stringify({ postId: currentPostId })
          : undefined,
      });
      if (await requireLogin(res)) return;
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || '북마크 업데이트에 실패했습니다.');
      }
      statusText.textContent = '북마크가 업데이트되었습니다.';
    } catch (e) {
      console.error(e);
      alert(e.message || '북마크 처리 중 오류가 발생했습니다.');
    }
  }

  async function handleCreateList() {
    const name = (createInput && createInput.value.trim()) || '';
    if (!name) return alert('폴더 이름을 입력하세요.');

    try {
      const res = await fetch('/api/bookmarks/lists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (await requireLogin(res)) return;
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.message || '폴더 생성에 실패했습니다.');
      createInput.value = '';
      await loadData();
    } catch (e) {
      console.error(e);
      alert(e.message || '폴더 생성 중 오류가 발생했습니다.');
    }
  }

  async function loadData() {
    if (!currentPostId) return;
    setStatus('불러오는 중...');
    try {
      const [lists, membership] = await Promise.all([
        fetchLists(),
        fetchPostMembership(currentPostId),
      ]);
      const selected = new Set((membership || []).filter((m) => m.contains).map((m) => m.id));
      renderLists(lists, selected);
      setStatus('북마크 폴더를 선택해주세요.');
    } catch (e) {
      console.error(e);
      setStatus('북마크 정보를 불러오지 못했습니다.');
    }
  }

  function setStatus(msg) {
    if (statusText) statusText.textContent = msg || '';
  }

  async function open(postId) {
    currentPostId = postId;
    ensureModal();
    await loadData();
    if (window.glsModal) window.glsModal.open(document.getElementById(modalId));
  }

  document.addEventListener('click', (e) => {
    const trigger = e.target.closest('.post-bookmark-toggle');
    if (!trigger) return;
    e.stopPropagation();
    const pid = trigger.getAttribute('data-post-id');
    if (pid) open(pid);
  });

  window.Glsoop = window.Glsoop || {};
  window.Glsoop.BookmarkModal = { open };
})();
