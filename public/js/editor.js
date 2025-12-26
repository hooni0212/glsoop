// public/js/editor.js
// 글쓰기(에디터) 페이지 스크립트
// - 로그인 확인
// - Quill 에디터 초기화 + 글자 수 제한(200자)
// - 해시태그 입력 → 칩(Chip) UI 관리
// - 미리보기 카드(제목/본문/폰트/태그) 실시간 반영
// - 새 글 작성 / 기존 글 수정(POST / PUT) 처리

document.addEventListener('DOMContentLoaded', async () => {
  // 🔢 본문 최대 글자 수
  const MAX_CONTENT_LENGTH = 200;

  // 해시태그 칩용 내부 리스트
  // ex) ['힐링', '위로']
  let hashtagList = [];

// 1. 로그인 상태 확인
try {
  // 브라우저 캐시 사용 금지: 304 방지
  const res = await fetch('/api/me', { cache: 'no-store' });

  // 진짜 로그아웃 상태
  if (res.status === 401) {
    alert('로그인이 필요한 기능입니다.');
    window.location.href = '/html/login.html';
    return;
  }

  // 그 외의 이상한 상태(500, 304 등)도 일단 에러로 처리
  if (!res.ok) {
    console.error('로그인 확인 실패:', res.status, res.statusText);
    alert('로그인 상태를 확인하는 중 오류가 발생했습니다.');
    window.location.href = '/html/login.html';
    return;
  }

  // 200이면 통과 (필요하면 여기서 사용자 정보 사용 가능)
  // const me = await res.json();

} catch (e) {
  console.error(e);
  alert('로그인 상태를 확인하는 중 오류가 발생했습니다.');
  window.location.href = '/html/login.html';
  return;
}


  // 2. Quill 에디터 초기화
  const quill = new Quill('#editor', {
    theme: 'snow',
    placeholder: '여기에 오늘의 문장을 적어 보세요.', // 에디터 안 안내 문구
    modules: {
      // 툴바 구성
      toolbar: [
        [{ header: [1, 2, false] }],
        ['bold', 'italic', 'underline', 'strike'],
        [{ list: 'ordered' }, { list: 'bullet' }],
        [
          { align: '' },
          { align: 'center' },
          { align: 'right' },
          { align: 'justify' },
        ],
        ['blockquote'],
        ['clean'],
      ],
    },
    // ✅ 정렬 정보도 포맷으로 저장되도록 formats 지정
    formats: [
      'header',
      'bold',
      'italic',
      'underline',
      'strike',
      'list',
      'bullet',
      'blockquote',
      'align', // ⬅ 이 줄 덕분에 ql-align-* 클래스가 실제 포맷으로 반영됨
    ],
  });

  // DOM 요소들 가져오기
  const titleInput = document.getElementById('postTitle');      // 제목 입력
  const saveBtn = document.getElementById('saveBtn');           // 저장 버튼
  const hashtagsInput = document.getElementById('postHashtags'); // ✅ 해시태그 입력 인풋

  // ✅ 미리보기 요소
  const previewTitleEl = document.getElementById('previewTitle');     // 미리보기 제목
  const previewContentEl = document.getElementById('previewContent'); // 미리보기 본문(quote-card)
  const previewMetaEl = document.getElementById('previewMeta');       // 미리보기 하단 메타(폰트/태그)
  const previewMoreBtn = document.getElementById('previewMoreBtn');   // 더보기 토글(에디터에선 미사용)

  // ✅ 남은 글자 수 표시 요소 (에디터 박스 오른쪽 아래)
  const charCounterEl = document.getElementById('charCounter');

  // ✅ 폰트 선택 요소 (select)
  const fontSelectEl = document.getElementById('fontSelect');
  const categorySelectEl = document.getElementById('categorySelect');

  // 에디터 상단 에러 영역 (Bootstrap alert 등)
  const editorAlertEl = document.getElementById('editorAlert');

  // 폰트 키 → 실제 font-family 매핑
  const FONT_MAP = {
    serif: "'Nanum Myeongjo','Noto Serif KR',serif",
    sans: "'Noto Sans KR',system-ui,-apple-system,BlinkMacSystemFont,sans-serif",
    hand: "'Nanum Pen Script',cursive",
  };

  // 폰트 키 → 사용자에게 보여줄 라벨
  const FONT_LABEL_MAP = {
    serif: '감성 명조체',
    sans: '담백한 고딕체',
    hand: '손글씨 느낌',
  };

  /**
   * ✅ 에디터 + 미리보기 카드에 폰트 적용
   * - select에서 폰트 변경 시 호출
   * - quill.root와 미리보기 quote-card의 클래스에 반영
   */
  function applyEditorFont(fontKey) {
    const key = FONT_MAP[fontKey] ? fontKey : 'serif';
    const fontFamily = FONT_MAP[key];

    // 1) Quill 에디터 내부 텍스트 폰트 변경
    if (quill && quill.root) {
      quill.root.style.fontFamily = fontFamily;
    }

    // 2) 미리보기 카드 폰트 (quote-card에 클래스 붙이기)
    if (previewContentEl) {
      previewContentEl.classList.remove(
        'quote-font-serif',
        'quote-font-sans',
        'quote-font-hand'
      );
      previewContentEl.classList.add('quote-font-' + key);
    }

    // 폰트 라벨 등 미리보기 메타도 갱신
    updatePreviewMeta();
  }

  // 폰트 선택 변경 시 적용
  if (fontSelectEl) {
    fontSelectEl.addEventListener('change', (e) => {
      applyEditorFont(e.target.value);
    });

    // 페이지 처음 열릴 때 select의 기본값대로 폰트 적용
    applyEditorFont(fontSelectEl.value || 'serif');
  } else {
    // 혹시라도 요소 못 찾았을 때를 대비한 기본 적용
    applyEditorFont('serif');
  }

  // 필수 요소 확인
  if (!titleInput || !saveBtn) {
    console.error('postTitle 또는 saveBtn 요소를 찾을 수 없습니다.');
    return;
  }

  /* -----------------------
     해시태그 칩 유틸 함수들
  ------------------------ */

  // 해시태그 칩들을 담을 컨테이너 (인풋 아래에 붙임)
  let hashtagChipContainer = null;
  if (hashtagsInput) {
    hashtagChipContainer = document.createElement('div');
    hashtagChipContainer.id = 'hashtagChips';
    hashtagChipContainer.className = 'gls-flex gls-flex-wrap';
    // 인풋 바로 아래에 붙이기
    hashtagsInput.insertAdjacentElement('afterend', hashtagChipContainer);
  }

  /**
   * 입력된 태그 문자열을 정규화
   * - 앞뒤 공백 제거 후, 해시태그(#)가 필수인 경우 처리
   * - requireHash가 true일 때는 '#'으로 시작하고 1글자 이상이어야 인식
   * - 허용되지 않으면 '' 반환
   */
  function normalizeTag(raw, requireHash = true) {
    if (!raw) return '';
    let t = String(raw).trim();
    if (!t) return '';

    if (requireHash) {
      if (!t.startsWith('#')) return '';
      t = t.slice(1);
      if (!t.trim()) return '';
    } else {
      if (t.startsWith('#')) {
        t = t.slice(1);
      }
    }

    return t;
  }

  /**
   * 내부 리스트(hashtagList)를 기반으로
   * 해시태그 입력 인풋의 값을 동기화
   * - "#힐링 #위로" 형식으로 채워줌
   */
  function syncHashtagInputFromList() {
    if (!hashtagsInput) return;
    if (!hashtagList.length) {
      // 칩이 없으면 기존 값 그대로 유지 (사용자가 직접 쓴 것 남겨두기)
      return;
    }
    const value = hashtagList.map((t) => '#' + t).join(' ');
    hashtagsInput.value = value;
  }

  /**
   * hashtagList를 기반으로 칩 UI 렌더링
   * - 각 태그마다 "칩 + X 버튼" 추가
   */
  function renderHashtagChips() {
    if (!hashtagChipContainer) return;

    if (!hashtagList.length) {
      hashtagChipContainer.innerHTML = '';
      return;
    }

    hashtagChipContainer.innerHTML = hashtagList
      .map(
        (t) => `
        <span class="hashtag-chip">
          #${escapeHtml(t)}
          <button type="button" class="hashtag-chip-remove" data-tag="${escapeHtml(
            t
          )}">×</button>
        </span>
      `
      )
      .join('');

    // 각 칩의 X 버튼(삭제 버튼)에 이벤트 등록
    hashtagChipContainer
      .querySelectorAll('.hashtag-chip-remove')
      .forEach((btn) => {
        btn.addEventListener('click', () => {
          const tag = btn.getAttribute('data-tag');
          if (!tag) return;
          // 리스트에서 해당 태그 제거
          hashtagList = hashtagList.filter((t) => t !== tag);
          syncHashtagInputFromList();
          renderHashtagChips();
          updatePreviewMeta();
        });
      });
  }

  /**
   * 새 태그 추가
   * - 정규화하고, 중복 아니면 리스트에 push
   * - 인풋 및 칩 UI 동기화
   */
  function addTag(raw, { requireHash = true } = {}) {
    const t = normalizeTag(raw, requireHash);
    if (!t) return false;
    if (hashtagList.includes(t)) return false; // 중복 태그 방지
    hashtagList.push(t);
    syncHashtagInputFromList();
    renderHashtagChips();
    updatePreviewMeta();
    return true;
  }

  /**
   * 해시태그 인풋의 텍스트를 hashtagList로 파싱
   * - 공백/쉼표 기준으로 split
   * - normalizeTag 후 중복 제거
   */
  function parseHashtagInputToList(requireHash = true) {
    if (!hashtagsInput) return;
    const raw = hashtagsInput.value || '';
    if (!raw.trim()) {
      hashtagList = [];
      renderHashtagChips();
      updatePreviewMeta();
      return;
    }

    const tokens = raw
      .split(/[,\s]+/)
      .map((t) => normalizeTag(t, requireHash))
      .filter((t) => t.length > 0);

    // 중복 제거를 위해 Set 사용
    hashtagList = Array.from(new Set(tokens));
    syncHashtagInputFromList();
    renderHashtagChips();
    updatePreviewMeta();
  }

  function commitHashtagInput({ requireHash = true, clearInput = false } = {}) {
    if (!hashtagsInput) return;
    const raw = hashtagsInput.value || '';
    if (!raw.trim()) return;

    const tokens = raw.split(/[,\s]+/).filter(Boolean);
    let added = false;

    tokens.forEach((token) => {
      added = addTag(token, { requireHash }) || added;
    });

    if (!added) {
      // 유효한 태그가 없었으면 입력값만 정리
      if (clearInput) hashtagsInput.value = '';
      return;
    }

    if (clearInput) {
      hashtagsInput.value = '';
    } else {
      syncHashtagInputFromList();
    }
  }

  // 인풋에서 Enter/스페이스/쉼표/Tab을 누를 때 태그 추가 시도
  if (hashtagsInput) {
    let isComposingTag = false;

    hashtagsInput.addEventListener('compositionstart', () => {
      isComposingTag = true;
    });

    hashtagsInput.addEventListener('compositionend', () => {
      isComposingTag = false;
    });

    hashtagsInput.addEventListener('keydown', (e) => {
      if (isComposingTag) return;
      if (['Enter', ' ', ',', 'Tab'].includes(e.key)) {
        const val = hashtagsInput.value;
        const parts = val.split(/[,\s]+/);
        const last = parts[parts.length - 1];
        if (last && last.trim().length > 0) {
          e.preventDefault(); // 기본 줄바꿈 등 막기
          commitHashtagInput({ clearInput: true });
        }
      }
    });

    // 포커스를 잃을 때 인풋 전체를 파싱해서 리스트/칩 반영
    hashtagsInput.addEventListener('blur', () => {
      commitHashtagInput({ clearInput: true });
    });
  }

  /**
   * ✅ 남은 글자 수 업데이트 함수
   * - 형식: (남은 글자수)/200
   * - 30자 이하 남았을 때는 빨간색으로 경고
   */
  function updateCharCounter(currentLength) {
    if (!charCounterEl) return;

    const remaining = Math.max(0, MAX_CONTENT_LENGTH - currentLength);
    charCounterEl.textContent = `${remaining}/${MAX_CONTENT_LENGTH}`;

    // 30자 이하 남았을 때 빨간색
    if (remaining <= 30) {
      charCounterEl.classList.remove('gls-text-muted');
      charCounterEl.classList.add('text-danger');
    } else {
      charCounterEl.classList.remove('text-danger');
      charCounterEl.classList.add('gls-text-muted');
    }
  }

  /**
   * 미리보기 하단 폰트/태그 메타 영역 업데이트
   * - 폰트 셀렉트 값 기준으로 폰트 라벨 표시
   * - hashtagList 또는 인풋값을 기반으로 태그 표시
   */
  function updatePreviewMeta() {
    if (!previewMetaEl) return;

    const fontKey = fontSelectEl ? fontSelectEl.value || 'serif' : 'serif';
    const fontLabel = FONT_LABEL_MAP[fontKey] || '감성 명조체';

    let tagsText = '';
    if (hashtagList.length > 0) {
      tagsText = hashtagList.map((t) => `#${t}`).join(' ');
    } else if (hashtagsInput && hashtagsInput.value.trim()) {
      tagsText = hashtagsInput.value.trim();
    }

    let html = `<span class="me-2">폰트: ${escapeHtml(fontLabel)}</span>`;
    if (tagsText) {
      html += `<span class="gls-text-muted">태그: ${escapeHtml(tagsText)}</span>`;
    }

    previewMetaEl.innerHTML = html;
  }

  /**
   * ✅ 미리보기 전체 업데이트
   * - 제목, 본문, 폰트, 태그 모두 반영
   */
  function updatePreview() {
    const title = titleInput.value.trim();
    const contentHtml = quill.root.innerHTML.trim();
    const plainText = quill.getText().trim();
  
    // 제목 미리보기
    if (previewTitleEl) {
      previewTitleEl.textContent = title || '여기에 글 제목이 미리 보여요';
    }
  
    // 본문 미리보기
    if (previewContentEl) {
      if (!plainText) {
        // 아무 내용도 없으면 안내 문구
        previewContentEl.innerHTML =
          '여기에 오늘의 문장을 적어 보시면, 이 카드에서 바로 미리 볼 수 있어요.';
      } else {
        // 사용자가 작성한 HTML(Quill output) 반영 (XSS 방지)
        previewContentEl.innerHTML = sanitizePostHtml(contentHtml);
      }
  
      // 내용 길이에 따라 폰트 크기 자동 조절
      autoAdjustQuoteFont(previewContentEl);

      // 에디터에서는 페이드/더보기 없이 안정적인 카드 높이만 유지
    }
  
    // 하단 메타 갱신
    updatePreviewMeta();
  }


  // 3. 수정 모드인지 확인 (URL ?postId=...)
  const params = new URLSearchParams(window.location.search);
  const postId = params.get('postId');      // 수정할 글 ID
  let isEditMode = !!postId;               // postId가 있으면 수정 모드

  if (isEditMode) {
    // 수정 모드 → 기존 글 내용 불러오기
    try {
      const res = await fetch(`/api/posts/${postId}/edit`);
      const data = await res.json();

      if (!res.ok || !data.ok) {
        alert(data.message || '글 정보를 불러오지 못했습니다.');
        isEditMode = false; // 실패 시 새 글 모드로 전환
      } else {
        const post = data.post;
        // 제목/본문/폰트 세팅
        titleInput.value = post.title || '';

        // 글 내용에 숨겨진 폰트 메타 태그가 있으면 파싱해서 select/에디터에 반영
        const { cleanHtml, fontKey } = extractFontFromContent(post.content || '');
        const resolvedFontKey = fontKey || 'serif';

        if (fontSelectEl) {
          fontSelectEl.value = resolvedFontKey;
        }

        applyEditorFont(resolvedFontKey);
        quill.root.innerHTML = sanitizePostHtml(cleanHtml || '');

        if (categorySelectEl) {
          categorySelectEl.value = post.category || 'short';
        }

        // 서버에서 hashtags를 내려줄 경우, 인풋/칩에 반영
        if (hashtagsInput) {
          if (Array.isArray(post.hashtags)) {
            // 배열이면 그대로 normalize해서 리스트에 넣기
            hashtagList = [];
            post.hashtags.forEach((tag) => addTag(tag, { requireHash: false }));
          } else if (post.hashtags) {
            // 문자열이면 인풋에 넣고, 파싱해서 칩 생성
            hashtagsInput.value = post.hashtags;
            parseHashtagInputToList(false);
          }
        }

        // 글자 수/미리보기 초기 상태 갱신
        const plainText = quill.getText().trim();
        updateCharCounter(plainText.length);
        updatePreview();
      }
    } catch (e) {
      console.error(e);
      alert('글 정보를 불러오는 중 오류가 발생했습니다.');
      isEditMode = false;
    }
  } else {
    // 새 글 모드 → 초기 미리보기 & 글자 수 표시
    updateCharCounter(0); // 200/200
    updatePreview();
  }

  // ✅ 제목 입력 시마다 미리보기 갱신
  titleInput.addEventListener('input', updatePreview);

  // ✅ 본문 입력 제한 + 미리보기/글자 수 갱신
  let isAdjusting = false; // 프로그램적 수정 중인지 플래그
  quill.on('text-change', (delta, oldDelta, source) => {
    if (isAdjusting) return;

    // 프로그램으로 내용 세팅할 때(초기 로드 등)는 제한 없이 바로 갱신
    if (source !== 'user') {
      const plainText = quill.getText().trim();
      updateCharCounter(plainText.length);
      updatePreview();
      return;
    }

    const plainText = quill.getText().trim();
    const length = plainText.length;

    // 최대 글자 수 초과 시 롤백
    if (length > MAX_CONTENT_LENGTH) {
      alert(`본문은 최대 ${MAX_CONTENT_LENGTH}자까지 입력할 수 있어요.`);

      // 마지막 입력 이전 상태로 되돌리기
      isAdjusting = true;
      quill.setContents(oldDelta);
      isAdjusting = false;

      const revertedText = quill.getText().trim();
      updateCharCounter(revertedText.length);
      updatePreview();
      return;
    }

    // 정상 범위면 그냥 카운터/미리보기 갱신
    updateCharCounter(length);
    updatePreview();
  });

  // 4. 저장 버튼 클릭 시
  saveBtn.addEventListener('click', async () => {
    const title = titleInput.value.trim();         // 제목(텍스트)
    const contentHtml = quill.root.innerHTML.trim(); // 본문(HTML)
    const selectedFontKey = fontSelectEl ? fontSelectEl.value || 'serif' : 'serif';
    const selectedCategory = categorySelectEl ? categorySelectEl.value : '';
    const fontMetaPrefix = `<!--FONT:${selectedFontKey}-->`;
    const contentWithFontMeta = fontMetaPrefix + contentHtml;
    const plainText = quill.getText().trim();      // 본문(plain text)
    const length = plainText.length;

    // 칩 → 인풋 동기화 한 번 더 (혹시 남아있는 텍스트 반영)
    syncHashtagInputFromList();
    const hashtagsRaw = hashtagsInput ? hashtagsInput.value.trim() : '';

    // 에러 영역 초기화
    if (editorAlertEl) {
      editorAlertEl.classList.add('gls-hidden');
      editorAlertEl.textContent = '';
    }

    // 간단한 검증들
    if (!title) {
      showEditorError('제목을 입력해주세요.');
      return;
    }

    if (!plainText) {
      showEditorError('내용을 입력해주세요.');
      return;
    }

    if (!selectedCategory) {
      showEditorError('카테고리를 선택해주세요.');
      return;
    }

    if (length > MAX_CONTENT_LENGTH) {
      showEditorError(`본문은 최대 ${MAX_CONTENT_LENGTH}자까지 입력할 수 있어요.`);
      return;
    }

    try {
      let url = '/api/posts';
      let method = 'POST';

      // 수정 모드라면 PUT /api/posts/:id로 전송
      if (isEditMode && postId) {
        url = `/api/posts/${postId}`;
        method = 'PUT';
      }

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          content: contentWithFontMeta,
          hashtags: hashtagsRaw, // ✅ 서버로 해시태그 문자열 함께 전송
          category: selectedCategory,
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.ok) {
        showEditorError(data.message || '글 저장에 실패했습니다.');
        return;
      }

      // 성공 알림 후 마이페이지로 이동
      alert(isEditMode ? '글이 수정되었습니다!' : '글이 저장되었습니다!');
      window.location.href = '/html/mypage.html';
    } catch (e) {
      console.error(e);
      showEditorError('글 저장 중 오류가 발생했습니다.');
    }
  });

  /**
   * 에디터 상단 에러 표시 함수
   * - editorAlertEl이 있으면 거기에 보여주고
   * - 없으면 단순 alert로 대체
   */
  function showEditorError(msg) {
    if (!editorAlertEl) {
      alert(msg);
      return;
    }
    editorAlertEl.textContent = msg;
    editorAlertEl.classList.remove('gls-hidden');

    // 에러 영역이 보이도록 살짝 위로 스크롤
    window.scrollTo({ top: editorAlertEl.offsetTop - 140, behavior: 'smooth' });
  }
});
