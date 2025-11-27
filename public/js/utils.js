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
  