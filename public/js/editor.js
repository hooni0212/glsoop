// public/js/editor.js

document.addEventListener('DOMContentLoaded', async () => {
  // 🔢 본문 최대 글자 수
  const MAX_CONTENT_LENGTH = 200;

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
        ['link', 'blockquote'],
        ['clean'],
      ],
    },
  });

  const titleInput = document.getElementById('postTitle');
  const saveBtn = document.getElementById('saveBtn');
  const hashtagsInput = document.getElementById('postHashtags'); // ✅ 해시태그 입력

  // ✅ 미리보기 요소
  const previewTitleEl = document.getElementById('previewTitle');
  const previewContentEl = document.getElementById('previewContent');

  // ✅ 남은 글자 수 표시 요소 (에디터 박스 오른쪽 아래)
  const charCounterEl = document.getElementById('charCounter');

  if (!titleInput || !saveBtn) {
    console.error('postTitle 또는 saveBtn 요소를 찾을 수 없습니다.');
    return;
  }

  // ✅ 글 길이에 따라 카드 안 글꼴 크기 자동 조절
  function autoAdjustQuoteFont(el) {
    if (!el) return;

    const text = el.innerText.trim();
    const len = text.length;

    let fontSize = 1.6;

    if (len > 140) {
      fontSize = 1.1;
    } else if (len > 100) {
      fontSize = 1.2;
    } else if (len > 70) {
      fontSize = 1.3;
    } else if (len > 40) {
      fontSize = 1.4;
    } else {
      fontSize = 1.6;
    }

    if (fontSize < 1.1) fontSize = 1.1;

    el.style.fontSize = fontSize + 'rem';
    el.style.lineHeight = Math.min(fontSize + 0.4, 2.0);
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

  // ✅ 미리보기 업데이트 함수
  function updatePreview() {
    const title = titleInput.value.trim();
    const contentHtml = quill.root.innerHTML.trim();
    const plainText = quill.getText().trim();

    if (previewTitleEl) {
      previewTitleEl.textContent = title || '제목 미리보기';
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

        // 서버에서 hashtags를 내려줄 경우 인풋에 반영
        if (hashtagsInput) {
          hashtagsInput.value = post.hashtags || '';
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
    const hashtagsRaw = hashtagsInput ? hashtagsInput.value.trim() : ''; // ✅ 해시태그 값

    if (!title) {
      alert('제목을 입력해주세요.');
      return;
    }

    if (!plainText) {
      alert('내용을 입력해주세요.');
      return;
    }

    if (length > MAX_CONTENT_LENGTH) {
      alert(`본문은 최대 ${MAX_CONTENT_LENGTH}자까지 입력할 수 있어요.`);
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
        alert(data.message || '글 저장에 실패했습니다.');
        return;
      }

      alert(isEditMode ? '글이 수정되었습니다!' : '글이 저장되었습니다!');
      window.location.href = '/html/mypage.html';
    } catch (e) {
      console.error(e);
      alert('글 저장 중 오류가 발생했습니다.');
    }
  });
});
