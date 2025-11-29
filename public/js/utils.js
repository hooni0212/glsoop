// public/js/utils.js
// 글숲 프론트 공통 유틸 함수 모음

/**
 * 글 길이에 따라 quote-card 안 폰트 크기 자동 조절
 * - el.innerText 길이를 보고 rem 단위로 폰트 크기를 조정
 */
function autoAdjustQuoteFont(el) {
    if (!el) return;
  
    const text = el.innerText.trim();
    const len = text.length;
  
    let fontSize = 1.6; // 기본
  
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
  
  /**
   * 이메일 마스킹: 앞 3글자만 노출 + 나머지는 *
   * 예) abcdef@naver.com → abc*** 
   */
  function maskEmail(email) {
    if (!email) return '';
  
    const atIndex = email.indexOf('@');
    const localPart = atIndex === -1 ? email : email.slice(0, atIndex);
    const len = localPart.length;
  
    if (len === 0) return '';
  
    const visibleLen = Math.min(3, len);
    const visible = localPart.slice(0, visibleLen);
    const hiddenCount = len - visibleLen;
    const stars = hiddenCount > 0 ? '*'.repeat(hiddenCount) : '';
  
    return visible + stars;
  }
  
  /**
   * HTML 이스케이프 (XSS 방지용)
   */
  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  
/**
 * ISO 날짜 문자열(또는 Date 객체)을
 * 브라우저 로컬 시간 기준 "YYYY-MM-DD HH:MM" 형식으로 바꿔주는 함수
 * 한국에서 보면 자동으로 KST 기준으로 표시됨.
 */
/**
 * DB/서버에서 온 날짜를 한국 시간 기준 "YYYY-MM-DD HH:MM"으로 포맷하는 함수
 * - ISO 문자열(예: "2025-11-29T11:26:00.000Z")도 처리
 * - SQLite CURRENT_TIMESTAMP ("2025-11-29 11:26:00")도 "UTC"라고 가정해서 처리
 */
function formatKoreanDateTime(value) {
  if (!value) return '';

  let date;

  if (typeof value === 'string') {
    // ISO 형식(대충 T 또는 Z가 들어간 경우)은 그냥 Date에 맡김
    if (value.includes('T') || value.endsWith('Z') || value.match(/\dZ$/)) {
      date = new Date(value);
    } else {
      // "YYYY-MM-DD HH:MM[:SS]" 형식 → UTC로 직접 파싱
      const m = value.match(
        /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/
      );
      if (m) {
        const year = Number(m[1]);
        const month = Number(m[2]) - 1; // 0 기반
        const day = Number(m[3]);
        const hour = Number(m[4]);
        const minute = Number(m[5]);
        const second = m[6] ? Number(m[6]) : 0;

        // ✅ UTC 타임스탬프로 생성
        const utcMs = Date.UTC(year, month, day, hour, minute, second);
        date = new Date(utcMs); // 이 Date에서 getHours() 등은 로컬(KST) 기준으로 나옴
      } else {
        // 형식이 애매하면 그냥 Date에 맡김
        date = new Date(value);
      }
    }
  } else {
    // Date 객체나 숫자(timestamp)인 경우
    date = new Date(value);
  }

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');

  return `${y}-${m}-${d} ${h}:${min}`;
}

  
  /**
   * 글 content 맨 앞의 폰트 메타 <!--FONT:serif|sans|hand-->를 분리
   * - cleanHtml: 실제 렌더링할 내용
   * - fontKey: 'serif' | 'sans' | 'hand' | null
   */
  function extractFontFromContent(html) {
    if (!html) {
      return { cleanHtml: '', fontKey: null };
    }
  
    const str = String(html);
    const m = str.match(/^<!--FONT:(serif|sans|hand)-->/);
    if (!m) {
      return { cleanHtml: str, fontKey: null };
    }
  
    const cleanHtml = str.replace(m[0], '').trim();
    const fontKey = m[1];
    return { cleanHtml, fontKey };
  }
  