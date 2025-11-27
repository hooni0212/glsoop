// public/js/editor.js

document.addEventListener('DOMContentLoaded', async () => {
  // 🔢 본문 최대 글자 수
  const MAX_CONTENT_LENGTH = 200;

  // 해시태그 칩용 내부 리스트
  let hashtagList = [];

  // 1. 로그인 상태 확인
  try {
    const res = await fetch('/api/me');
    if (!res.ok) {
      alert('로그인이 필요한 기능입니다.');
      window.location.href = '/html/login.html';
      return;
    }
  } catch (e) {
    console.error(e);
    alert('로그인 상태 확인 중 오류가 발생했습니다.');
    window.location.href = '/html/login.html';
    return;
  }

  // 2. Quill 에디터 초기화
  const quill = new Quill('#editor', {
    theme: 'snow',
    placeholder: '여기에 오늘의 문장을 적어 보세요.', // 에디터 안 안내 문구
    modules: {
      toolbar: [
        [{ header: [1, 2, false] }],
        ['bold', 'italic', 'underline', 'strike'],
        [{ list: 'ordered' }, { list: 'bullet' }],
        [{ align: '' }, { align: 'center' }, { align: 'right' }, { align: 'justify' }],
        ['link', 'blockquote'],
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
      'link',
      'blockquote',
      'align', // ⬅ 이 줄 덕분에 ql-align-* 클래스가 실제 포맷으로 반영됨
    ],
  });

  const titleInput = document.getElementById('postTitle');
  const saveBtn = document.getElementById('saveBtn');
  const hashtagsInput = document.getElementById('postHashtags'); // ✅ 해시태그 입력

  // ✅ 미리보기 요소
  const previewTitleEl = document.getElementById('previewTitle');
  const previewContentEl = document.getElementById('previewContent');
  const previewMetaEl = document.getElementById('previewMeta');

  // ✅ 남은 글자 수 표시 요소 (에디터 박스 오른쪽 아래)
  const charCounterEl = document.getElementById('charCounter');

  // ✅ 폰트 선택 요소
  const fontSelectEl = document.getElementById('fontSelect');

  // 에디터 상단 에러 영역
  const editorAlertEl = document.getElementById('editorAlert');

  // 폰트 키 → 실제 font-family 매핑
  const FONT_MAP = {
    serif: "'Nanum Myeongjo','Noto Serif KR',serif",
    sans: "'Noto Sans KR',system-ui,-apple-system,BlinkMacSystemFont,sans-serif",
    hand: "'Nanum Pen Script',cursive",
  };

  // 폰트 키 → 라벨
  const FONT_LABEL_MAP = {
    serif: '감성 명조체',
    sans: '담백한 고딕체',
    hand: '손글씨 느낌',
  };

  // ✅ 에디터 + 미리보기 카드에 폰트 적용
  function applyEditorFont(fontKey) {
    const key = FONT_MAP[fontKey] ? fontKey : 'serif';
    const fontFamily = FONT_MAP[key];

    // 1) Quill 에디터 textarea 폰트
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

    // 미리보기 메타도 업데이트
    updatePreviewMeta();
  }

  // 폰트 선택 변경 시 적용
  if (fontSelectEl) {
    fontSelectEl.addEventListener('change', (e) => {
      applyEditorFont(e.target.value);
    });

    // 페이지 처음 열릴 때 기본값 적용
    applyEditorFont(fontSelectEl.value || 'serif');
  } else {
    // 혹시라도 요소 못 찾았을 때를 대비한 기본 적용
    applyEditorFont('serif');
  }

  if (!titleInput || !saveBtn) {
    console.error('postTitle 또는 saveBtn 요소를 찾을 수 없습니다.');
    return;
  }

  /* -----------------------
     해시태그 칩 유틸 함수들
  ------------------------ */

  let hashtagChipContainer = null;
  if (hashtagsInput) {
    hashtagChipContainer = document.createElement('div');
    hashtagChipContainer.id = 'hashtagChips';
    hashtagChipContainer.className = 'd-flex flex-wrap';
    // 인풋 바로 아래에 붙이기
    hashtagsInput.insertAdjacentElement('afterend', hashtagChipContainer);
  }

  function normalizeTag(raw) {
    if (!raw) return '';
    let t = String(raw).trim();
    if (!t) return '';
    if (t.startsWith('#')) t = t.slice(1);
    return t;
  }

  function syncHashtagInputFromList() {
    if (!hashtagsInput) return;
    if (!hashtagList.length) {
      // 칩이 없으면 기존 값 그대로 유지
      return;
    }
    const value = hashtagList.map((t) => '#' + t).join(' ');
    hashtagsInput.value = value;
  }

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

    // 삭제 버튼 이벤트
    hashtagChipContainer
      .querySelectorAll('.hashtag-chip-remove')
      .forEach((btn) => {
        btn.addEventListener('click', () => {
          const tag = btn.getAttribute('data-tag');
          if (!tag) return;
          hashtagList = hashtagList.filter((t) => t !== tag);
          syncHashtagInputFromList();
          renderHashtagChips();
          updatePreviewMeta();
        });
      });
  }

  function addTag(raw) {
    const t = normalizeTag(raw);
    if (!t) return;
    if (hashtagList.includes(t)) return;
    hashtagList.push(t);
    syncHashtagInputFromList();
    renderHashtagChips();
    updatePreviewMeta();
  }

  function parseHashtagInputToList() {
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
      .map(normalizeTag)
      .filter((t) => t.length > 0);

    hashtagList = Array.from(new Set(tokens));
    syncHashtagInputFromList();
    renderHashtagChips();
    updatePreviewMeta();
  }

  // 인풋에서 Enter/쉼표/스페이스로 태그 추가
  if (hashtagsInput) {
    hashtagsInput.addEventListener('keydown', (e) => {
      if (['Enter', ' ', ',', 'Tab'].includes(e.key)) {
        const val = hashtagsInput.value;
        const parts = val.split(/[,\s]+/);
        const last = parts[parts.length - 1];
        if (last && last.trim().length > 0) {
          e.preventDefault();
          addTag(last);
        }
      }
    });

    hashtagsInput.addEventListener('blur', () => {
      parseHashtagInputToList();
    });
  }

  // ✅ 남은 글자 수 업데이트 함수
  // 표시 형식: (남은 글자수)/200
  function updateCharCounter(currentLength) {
    if (!charCounterEl) return;

    const remaining = Math.max(0, MAX_CONTENT_LENGTH - currentLength);
    charCounterEl.textContent = `${remaining}/${MAX_CONTENT_LENGTH}`;

    // 30자 이하 남았을 때 빨간색
    if (remaining <= 30) {
      charCounterEl.classList.remove('text-muted');
      charCounterEl.classList.add('text-danger');
    } else {
      charCounterEl.classList.remove('text-danger');
      charCounterEl.classList.add('text-muted');
    }
  }

  // 미리보기 하단 폰트/태그 메타
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
      html += `<span class="text-muted">태그: ${escapeHtml(tagsText)}</span>`;
    }

    previewMetaEl.innerHTML = html;
  }

  // ✅ 미리보기 업데이트 함수
  function updatePreview() {
    const title = titleInput.value.trim();
    const contentHtml = quill.root.innerHTML.trim();
    const plainText = quill.getText().trim();

    if (previewTitleEl) {
      previewTitleEl.textContent = title || '여기에 글 제목이 미리 보여요';
    }

    if (previewContentEl) {
      if (!plainText) {
        previewContentEl.innerHTML =
          '여기에 오늘의 문장을 적어 보시면, 이 카드에서 바로 미리 볼 수 있어요.';
      } else {
        previewContentEl.innerHTML = contentHtml;
      }

      autoAdjustQuoteFont(previewContentEl);
    }

    updatePreviewMeta();
  }

  // 3. 수정 모드인지 확인 (URL ?postId=...)
  const params = new URLSearchParams(window.location.search);
  const postId = params.get('postId');
  let isEditMode = !!postId;

  if (isEditMode) {
    // 수정 모드 → 기존 글 내용 불러오기
    try {
      const res = await fetch(`/api/posts/${postId}`);
      const data = await res.json();

      if (!res.ok || !data.ok) {
        alert(data.message || '글 정보를 불러오지 못했습니다.');
        isEditMode = false;
      } else {
        const post = data.post;
        titleInput.value = post.title || '';
        quill.root.innerHTML = post.content || '';

        // 서버에서 hashtags를 내려줄 경우 인풋/칩에 반영
        if (hashtagsInput) {
          if (Array.isArray(post.hashtags)) {
            hashtagList = post.hashtags
              .map(normalizeTag)
              .filter((t) => t.length > 0);
            syncHashtagInputFromList();
            renderHashtagChips();
          } else if (post.hashtags) {
            hashtagsInput.value = post.hashtags;
            parseHashtagInputToList();
          }
        }

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

  // ✅ 제목 입력 시 미리보기 갱신
  titleInput.addEventListener('input', updatePreview);

  // ✅ 본문 입력 제한 + 미리보기/글자 수 갱신
  let isAdjusting = false;
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

    updateCharCounter(length);
    updatePreview();
  });

  // 4. 저장 버튼 클릭 시
  saveBtn.addEventListener('click', async () => {
    const title = titleInput.value.trim();
    const contentHtml = quill.root.innerHTML.trim();
    const plainText = quill.getText().trim();
    const length = plainText.length;

    // 칩 → 인풋 동기화 한 번 더
    syncHashtagInputFromList();
    const hashtagsRaw = hashtagsInput ? hashtagsInput.value.trim() : '';

    // 에러 영역 초기화
    if (editorAlertEl) {
      editorAlertEl.classList.add('d-none');
      editorAlertEl.textContent = '';
    }

    if (!title) {
      showEditorError('제목을 입력해주세요.');
      return;
    }

    if (!plainText) {
      showEditorError('내용을 입력해주세요.');
      return;
    }

    if (length > MAX_CONTENT_LENGTH) {
      showEditorError(`본문은 최대 ${MAX_CONTENT_LENGTH}자까지 입력할 수 있어요.`);
      return;
    }

    try {
      let url = '/api/posts';
      let method = 'POST';

      // 수정 모드라면 PUT /api/posts/:id
      if (isEditMode && postId) {
        url = `/api/posts/${postId}`;
        method = 'PUT';
      }

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          content: contentHtml,
          hashtags: hashtagsRaw, // ✅ 서버로 해시태그 함께 전송
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.ok) {
        showEditorError(data.message || '글 저장에 실패했습니다.');
        return;
      }

      alert(isEditMode ? '글이 수정되었습니다!' : '글이 저장되었습니다!');
      window.location.href = '/html/mypage.html';
    } catch (e) {
      console.error(e);
      showEditorError('글 저장 중 오류가 발생했습니다.');
    }
  });

  function showEditorError(msg) {
    if (!editorAlertEl) {
      alert(msg);
      return;
    }
    editorAlertEl.textContent = msg;
    editorAlertEl.classList.remove('d-none');
    window.scrollTo({ top: editorAlertEl.offsetTop - 140, behavior: 'smooth' });
  }

});
