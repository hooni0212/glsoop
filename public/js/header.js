// public/js/header.js
// 상단 공통 헤더(네비게이션 바) 스크립트
// - 로그인 여부에 따라 "로그인/회원가입" 또는 "내 이름/마이페이지/글쓰기/로그아웃" 표시
// - 로그아웃 버튼 동작 처리

document.addEventListener('DOMContentLoaded', () => {
  // 페이지가 로드되면 헤더 상태(로그인/로그아웃)를 먼저 갱신
  ensureGrowthNavLink();
  buildAccountMenus();
  updateHeader();

  setupMobileNavCloseBehavior();
});

function ensureGrowthNavLink() {
  const afterNavLists = document.querySelectorAll('.after-login');
  afterNavLists.forEach((list) => {
    if (list.querySelector('.nav-growth-link')) return;

    const li = document.createElement('li');
    li.className = 'nav-item';
    const link = document.createElement('a');
    link.href = '/html/growth.html';
    link.className = 'nav-link nav-growth-link';
    link.textContent = '성장';
    li.appendChild(link);

    const mypageLink = list.querySelector('a[href="/html/mypage.html"]');
    if (mypageLink && mypageLink.parentElement?.parentElement === list) {
      mypageLink.parentElement.insertAdjacentElement('afterend', li);
    } else {
      list.insertBefore(li, list.querySelector('li:nth-child(3)') || null);
    }
  });
}

/**
 * 헤더 영역에 로그인 상태 반영
 * - /api/me로 사용자 정보를 요청
 *   - 성공(200, data.ok=true) → 로그인 상태로 판단
 *   - 실패(401 등) 또는 data.ok=false → 비로그인 상태로 판단
 * - .before-login 요소: 로그인 전 메뉴(로그인/회원가입)
 * - .after-login 요소: 로그인 후 메뉴(닉네임/마이페이지/글쓰기/로그아웃)
 */
async function updateHeader() {
  // 로그인 전/후 메뉴 그룹들을 모두 가져옴 (페이지마다 여러 개 있을 수 있음)
  const beforeEls = document.querySelectorAll('.before-login');
  const afterEls = document.querySelectorAll('.after-login');

  try {
    const res = await fetch('/api/me', { cache: 'no-store' });

    // HTTP 레벨에서 실패하면 "로그인 안 된 상태"로 처리
    if (!res.ok) {
      // 로그인 안 된 상태: before-login 보이기, after-login 숨기기
      beforeEls.forEach((el) => (el.style.display = 'flex'));
      afterEls.forEach((el) => (el.style.display = 'none'));
      applyAccountName('');
      closeAccountMenu();
      return;
    }

    const data = await res.json();

    if (data.ok) {
      // 로그인 상태
      // - 로그인 전 메뉴 숨기고
      // - 로그인 후 메뉴 보이기
      beforeEls.forEach((el) => (el.style.display = 'none'));
      afterEls.forEach((el) => (el.style.display = 'flex'));

      // 상단 계정 UI에 사용자 이름 표시 (예: "홍길동님")
      applyAccountName(data.name || '');
    } else {
      // 응답은 200이지만 data.ok가 false → 로그인 실패로 간주
      beforeEls.forEach((el) => (el.style.display = 'flex'));
      afterEls.forEach((el) => (el.style.display = 'none'));
      applyAccountName('');
      closeAccountMenu();
    }
  } catch (e) {
    // 네트워크 에러 등 예외 발생 시에도 안전하게 "비로그인" 상태로 표시
    console.error(e);
    beforeEls.forEach((el) => (el.style.display = 'flex'));
    afterEls.forEach((el) => (el.style.display = 'none'));
    applyAccountName('');
    closeAccountMenu();
  }
}

/**
 * 헤더 우측 계정 메뉴 생성 & 이벤트 바인딩
 * - 기존 navUserName / logout 버튼을 제거한 뒤, account-pill + 메뉴/모바일 블록을 삽입
 */
function buildAccountMenus() {
  const afterEls = document.querySelectorAll('.after-login');

  afterEls.forEach((list, index) => {
    // 이미 계정 메뉴가 세팅되어 있다면 패스
    if (list.dataset.accountMenuBuilt === 'true') return;

    // 기존 이름/로그아웃 UI 제거
    const legacyName = list.querySelector('#navUserName');
    legacyName?.closest('li')?.remove();
    const legacyLogoutButtons = list.querySelectorAll('#logoutBtn');
    legacyLogoutButtons.forEach((btn) => btn.closest('li')?.remove());

    // 참고용으로 마이페이지/글쓰기 링크를 찾아둔다 (없어도 무시)
    const mypageLink = list.querySelector('a[href="/html/mypage.html"]');
    const editorLink = list.querySelector('a[href="/html/editor.html"]');

    // 모바일용 계정 헤더 블록 추가
    const mobileAccount = document.createElement('li');
    mobileAccount.className = 'nav-item d-lg-none w-100 mobile-account-header';
    mobileAccount.innerHTML = `
      <div class="mobile-account-chip">
        <span class="mobile-avatar" data-avatar-initial aria-hidden="true">·</span>
        <div class="mobile-account-text">
          <span class="mobile-account-label">내 계정</span>
          <span class="mobile-account-name" data-account-name>로그인 필요</span>
        </div>
      </div>
    `;
    list.prepend(mobileAccount);

    // 로그아웃(모바일 리스트 하단)
    const mobileDivider = document.createElement('li');
    mobileDivider.className = 'nav-item d-lg-none mobile-menu-divider';
    mobileDivider.innerHTML = '<hr class="dropdown-divider" />';

    const mobileLogoutItem = document.createElement('li');
    mobileLogoutItem.className = 'nav-item d-lg-none';
    const mobileLogoutBtn = document.createElement('button');
    mobileLogoutBtn.type = 'button';
    mobileLogoutBtn.className = 'nav-link nav-logout-link text-start w-100';
    mobileLogoutBtn.textContent = '로그아웃';
    mobileLogoutBtn.addEventListener('click', () => {
      closeAccountMenu();
      handleLogout();
    });
    mobileLogoutItem.appendChild(mobileLogoutBtn);

    // 데스크톱 계정 버튼 + 메뉴
    const accountLi = document.createElement('li');
    accountLi.className = 'nav-item d-none d-lg-flex align-items-center position-relative nav-account-pill';

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'account-trigger';
    trigger.setAttribute('aria-haspopup', 'menu');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-label', '계정 메뉴 열기');
    trigger.innerHTML = `
      <span class="account-avatar" data-avatar-initial aria-hidden="true">·</span>
      <span class="account-text">
        <span class="account-name" data-account-name>내 계정</span>
        <span class="account-subtitle">계정 메뉴 열기</span>
      </span>
      <span class="account-caret" aria-hidden="true">▾</span>
    `;

    const menu = document.createElement('div');
    menu.className = 'account-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('hidden', '');

    const menuList = document.createElement('div');
    menuList.className = 'account-menu-list';

    const menuItems = [];
    const mypageItem = document.createElement('a');
    mypageItem.className = 'account-menu-item';
    mypageItem.href = '/html/mypage.html';
    mypageItem.setAttribute('role', 'menuitem');
    mypageItem.textContent = '마이페이지';
    menuItems.push(mypageItem);

    const editorItem = document.createElement('a');
    editorItem.className = 'account-menu-item';
    editorItem.href = '/html/editor.html';
    editorItem.setAttribute('role', 'menuitem');
    editorItem.textContent = '글쓰기';
    menuItems.push(editorItem);

    const logoutItem = document.createElement('button');
    logoutItem.type = 'button';
    logoutItem.className = 'account-menu-item account-menu-logout';
    logoutItem.setAttribute('role', 'menuitem');
    logoutItem.textContent = '로그아웃';
    logoutItem.addEventListener('click', () => {
      closeAccountMenu();
      handleLogout();
    });
    menuItems.push(logoutItem);

    menuItems.forEach((item) => {
      item.addEventListener('click', () => closeAccountMenu());
      menuList.appendChild(item);
    });

    menu.appendChild(menuList);

    trigger.addEventListener('click', () => toggleAccountMenu(menu, trigger));

    accountLi.appendChild(trigger);
    accountLi.appendChild(menu);

    list.appendChild(mobileDivider);
    list.appendChild(mobileLogoutItem);
    list.appendChild(accountLi);

    // 모바일에서 기존 메뉴 항목의 높이/패딩 통일을 위해 nav-link 클래스 보정
    [mypageLink, editorLink]
      .filter(Boolean)
      .forEach((link) => link.classList.add('nav-link-compact'));

    list.dataset.accountMenuBuilt = 'true';
  });

  document.addEventListener('click', (event) => {
    if (!currentOpenMenu) return;
    const isInsideMenu = currentOpenMenu.contains(event.target);
    const isTrigger = currentOpenTrigger?.contains(event.target);
    if (!isInsideMenu && !isTrigger) {
      closeAccountMenu();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && currentOpenMenu) {
      closeAccountMenu();
      currentOpenTrigger?.focus();
    }
  });
}

function setupMobileNavCloseBehavior() {
  const navbarNav = document.getElementById('navbarNav');
  const toggler = document.querySelector('.navbar-toggler');

  if (!navbarNav || !toggler || typeof bootstrap === 'undefined') return;

  const collapse = bootstrap.Collapse.getOrCreateInstance(navbarNav, {
    toggle: false,
  });

  // 메뉴 항목 클릭 시 자동 닫힘
  navbarNav.querySelectorAll('a.nav-link, button.nav-link').forEach((item) => {
    item.addEventListener('click', () => {
      if (window.innerWidth < 992 && navbarNav.classList.contains('show')) {
        collapse.hide();
      }
    });
  });

  // 외부 클릭 시 닫힘
  document.addEventListener('click', (event) => {
    const isOpen = navbarNav.classList.contains('show');
    if (!isOpen) return;
    const clickedInsideNav = navbarNav.contains(event.target);
    const clickedToggler = toggler.contains(event.target);

    if (!clickedInsideNav && !clickedToggler) {
      collapse.hide();
    }
  });
}

let currentOpenMenu = null;
let currentOpenTrigger = null;

function toggleAccountMenu(menu, trigger) {
  if (currentOpenMenu && currentOpenMenu !== menu) {
    closeAccountMenu();
  }

  const willOpen = menu.hasAttribute('hidden');
  if (willOpen) {
    menu.removeAttribute('hidden');
    trigger.setAttribute('aria-expanded', 'true');
    currentOpenMenu = menu;
    currentOpenTrigger = trigger;
  } else {
    closeAccountMenu();
  }
}

function closeAccountMenu() {
  if (!currentOpenMenu || !currentOpenTrigger) return;
  currentOpenMenu.setAttribute('hidden', '');
  currentOpenTrigger.setAttribute('aria-expanded', 'false');
  currentOpenMenu = null;
  currentOpenTrigger = null;
}

function applyAccountName(name) {
  const trimmed = (name || '').trim();
  const displayName = trimmed ? `${trimmed}님` : '';
  const initial = trimmed ? trimmed[0] : '·';

  document.querySelectorAll('[data-account-name]').forEach((el) => {
    el.textContent = displayName || '로그인 필요';
  });

  document.querySelectorAll('[data-avatar-initial]').forEach((el) => {
    el.textContent = initial;
  });
}

/**
 * 로그아웃 버튼 클릭 처리
 * - POST /api/logout 호출
 * - 성공/실패와 상관 없이 마지막에는 홈(/index.html)으로 이동
 */
async function handleLogout() {
  try {
    // 서버에 로그아웃 요청 (세션/쿠키 삭제 등)
    const res = await fetch('/api/logout', { method: 'POST' });

    // JSON 파싱 실패할 수도 있으니 .catch로 빈 객체 대체
    const data = await res.json().catch(() => ({}));

    // 서버에서 내려준 메시지를 우선 사용, 없으면 기본 문구
    alert((data && data.message) || '로그아웃되었습니다.');
  } catch (e) {
    console.error(e);
    alert('로그아웃 중 오류가 발생했습니다.');
  } finally {
    // 로그아웃 후에는 항상 메인 페이지로 이동
    window.location.href = '/index.html';
  }
}
