const ProfileCustomize = (() => {
  const MAX_SHOWCASE_BADGES = 6;
  const STICKER_SLOTS = [
    { key: 'tl', label: '왼쪽 위' },
    { key: 'tr', label: '오른쪽 위' },
    { key: 'br', label: '오른쪽 아래' },
  ];
  const state = {
    name: '나의 글숲',
    inventory: { badges: [], stickers: [], backgrounds: [] },
    saved: null,
    selection: null,
    saving: false,
  };

  function cloneProfile(profile) {
    return {
      primary_badge_key: profile?.primary_badge_key || null,
      profile_background_key: profile?.profile_background_key || null,
      showcase_badge_keys: Array.isArray(profile?.showcase_badge_keys)
        ? [...profile.showcase_badge_keys]
        : [],
      header_stickers: Array.isArray(profile?.header_stickers)
        ? profile.header_stickers.map((item) => ({ slot: item.slot, key: item.key }))
        : [],
    };
  }

  function init() {
    document.getElementById('profileCustomizeEditor')?.addEventListener('click', onEditorClick);
    document.getElementById('profileCustomizeSave')?.addEventListener('click', save);
    load();
  }

  async function load() {
    const editor = document.getElementById('profileCustomizeEditor');
    try {
      const [meResponse, cosmeticsResponse] = await Promise.all([
        fetch('/api/me', { cache: 'no-store' }),
        fetch('/api/cosmetics/me', { cache: 'no-store' }),
      ]);
      if (meResponse.status === 401 || cosmeticsResponse.status === 401) {
        window.location.href = `/html/login.html?next=${encodeURIComponent('/profile-customize')}`;
        return;
      }
      const me = await meResponse.json().catch(() => ({}));
      const cosmetics = await cosmeticsResponse.json().catch(() => ({}));
      if (!cosmeticsResponse.ok || !cosmetics.ok) {
        throw new Error(cosmetics.message || '프로필 꾸미기 정보를 불러오지 못했습니다.');
      }

      state.name = (me.nickname || me.name || '나의 글숲').trim();
      state.inventory = {
        badges: Array.isArray(cosmetics.inventory?.badges) ? cosmetics.inventory.badges : [],
        stickers: Array.isArray(cosmetics.inventory?.stickers) ? cosmetics.inventory.stickers : [],
        backgrounds: Array.isArray(cosmetics.inventory?.backgrounds) ? cosmetics.inventory.backgrounds : [],
      };
      state.saved = cloneProfile(cosmetics.profile);
      state.selection = cloneProfile(cosmetics.profile);
      render();
    } catch (error) {
      if (editor) editor.innerHTML = `<p class="profile-customize-state is-error">${escapeHtml(error.message || '프로필 꾸미기 정보를 불러오지 못했습니다.')}</p>`;
    } finally {
      editor?.setAttribute('aria-busy', 'false');
    }
  }

  function render() {
    renderPreview();
    renderEditor();
    syncSaveDock();
  }

  function renderPreview() {
    const mount = document.getElementById('profileCustomizePreview');
    if (!mount || !state.selection) return;
    const background = findItem('backgrounds', state.selection.profile_background_key);
    const primary = findItem('badges', state.selection.primary_badge_key);
    const showcase = state.selection.showcase_badge_keys
      .map((key) => findItem('badges', key))
      .filter(Boolean);
    const stickers = state.selection.header_stickers
      .map((entry) => ({ ...entry, item: findItem('stickers', entry.key) }))
      .filter((entry) => entry.item);
    const palette = backgroundPalette(background?.key);

    mount.innerHTML = `
      <div class="profile-preview-card" style="--preview-bg:${palette[0]};--preview-border:${palette[1]};--preview-accent:${palette[2]}">
        <div class="profile-preview-lines" aria-hidden="true"></div>
        ${stickers.map((entry) => `<span class="profile-preview-sticker is-${entry.slot}">${escapeHtml(entry.item.icon_emoji || '✨')}</span>`).join('')}
        <p class="profile-preview-kicker">작가의 글숲</p>
        <div class="profile-preview-name">
          <span class="profile-preview-avatar">${escapeHtml(state.name.slice(0, 1) || '글')}</span>
          <strong>${escapeHtml(state.name)}</strong>
          ${primary ? `<span title="${escapeHtml(primary.name)}">${escapeHtml(primary.icon_emoji || '🏅')}</span>` : ''}
        </div>
        <p class="profile-preview-copy">마음에 남은 문장을 천천히 기록하고 있습니다.</p>
        <div class="profile-preview-showcase">
          ${showcase.map((badge) => `<span title="${escapeHtml(badge.name)}">${escapeHtml(badge.icon_emoji || '🏅')}</span>`).join('')}
        </div>
        <div class="profile-preview-meta"><span>글 0</span><span>공감 0</span><span>팔로워 0</span></div>
      </div>
      <p class="profile-preview-background-name">${escapeHtml(background?.name || '기본 종이 배경')}</p>
    `;
  }

  function renderEditor() {
    const mount = document.getElementById('profileCustomizeEditor');
    if (!mount || !state.selection) return;
    mount.innerHTML = `
      ${renderSection('프로필 배경', '작가 카드 전체 분위기를 정합니다.', renderBackgrounds())}
      ${renderSection('대표 배지', '이름 옆에 표시할 배지 하나를 고릅니다.', renderPrimaryBadges())}
      ${renderSection(`표시 배지 ${state.selection.showcase_badge_keys.length}/${MAX_SHOWCASE_BADGES}`, '프로필 아래에 최대 6개까지 보여줍니다.', renderShowcaseBadges())}
      ${renderSection('헤더 스티커', '프로필 카드의 세 위치에 장식을 놓습니다.', renderStickerSlots())}
    `;
  }

  function renderSection(title, description, content) {
    return `
      <section class="profile-option-section">
        <div class="profile-option-section__head"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(description)}</p></div>
        ${content}
      </section>
    `;
  }

  function renderBackgrounds() {
    return `<div class="profile-option-grid is-background">${state.inventory.backgrounds.map((item) => optionButton(item, 'background', state.selection.profile_background_key === item.key)).join('') || emptyInventory()}</div>`;
  }

  function renderPrimaryBadges() {
    const none = optionButton({ key: '', name: '배지 없음', icon_emoji: '−', rarity: 'common' }, 'primary', !state.selection.primary_badge_key);
    return `<div class="profile-option-grid">${none}${state.inventory.badges.map((item) => optionButton(item, 'primary', state.selection.primary_badge_key === item.key)).join('')}</div>`;
  }

  function renderShowcaseBadges() {
    return `<div class="profile-option-grid">${state.inventory.badges.map((item) => optionButton(item, 'showcase', state.selection.showcase_badge_keys.includes(item.key))).join('') || emptyInventory()}</div>`;
  }

  function renderStickerSlots() {
    return STICKER_SLOTS.map((slot) => {
      const selected = state.selection.header_stickers.find((item) => item.slot === slot.key)?.key || '';
      const none = optionButton({ key: '', name: '사용 안 함', icon_emoji: '−', rarity: 'common' }, 'sticker', !selected, slot.key);
      return `
        <div class="profile-sticker-slot">
          <h3>${slot.label}</h3>
          <div class="profile-option-grid is-sticker">${none}${state.inventory.stickers.map((item) => optionButton(item, 'sticker', selected === item.key, slot.key)).join('')}</div>
        </div>
      `;
    }).join('');
  }

  function optionButton(item, action, selected, slot = '') {
    const palette = action === 'background' ? backgroundPalette(item.key) : null;
    const swatch = palette
      ? `<span class="profile-option-swatch" style="--swatch-a:${palette[0]};--swatch-b:${palette[1]}"></span>`
      : `<span class="profile-option-emoji">${escapeHtml(item.icon_emoji || '🏅')}</span>`;
    return `
      <button type="button" class="profile-option${selected ? ' is-selected' : ''}" data-profile-action="${action}" data-profile-key="${escapeHtml(item.key)}"${slot ? ` data-profile-slot="${slot}"` : ''} aria-pressed="${selected ? 'true' : 'false'}">
        ${swatch}
        <span class="profile-option-copy"><strong>${escapeHtml(item.name || item.key)}</strong><small>${escapeHtml(rarityLabel(item.rarity))}</small></span>
        <span class="profile-option-check" aria-hidden="true">✓</span>
      </button>
    `;
  }

  function emptyInventory() {
    return '<p class="profile-customize-empty">아직 사용할 수 있는 아이템이 없습니다.</p>';
  }

  function onEditorClick(event) {
    const button = event.target.closest('[data-profile-action]');
    if (!button || !state.selection) return;
    const action = button.dataset.profileAction;
    const key = button.dataset.profileKey || null;
    if (action === 'background') state.selection.profile_background_key = key;
    if (action === 'primary') state.selection.primary_badge_key = key;
    if (action === 'showcase') {
      const current = state.selection.showcase_badge_keys;
      if (current.includes(key)) {
        state.selection.showcase_badge_keys = current.filter((item) => item !== key);
      } else if (current.length < MAX_SHOWCASE_BADGES) {
        state.selection.showcase_badge_keys = [...current, key];
      } else {
        alert(`표시 배지는 최대 ${MAX_SHOWCASE_BADGES}개까지 선택할 수 있습니다.`);
      }
    }
    if (action === 'sticker') {
      const slot = button.dataset.profileSlot;
      state.selection.header_stickers = state.selection.header_stickers.filter((item) => item.slot !== slot);
      if (key) state.selection.header_stickers.push({ slot, key });
    }
    render();
  }

  async function save() {
    if (!isDirty() || state.saving) return;
    state.saving = true;
    syncSaveDock();
    try {
      const res = await fetch('/api/me/profile-cosmetics', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state.selection),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.message || '프로필을 저장하지 못했습니다.');
      state.saved = cloneProfile(state.selection);
      syncSaveDock('프로필에 바로 반영되었습니다.');
    } catch (error) {
      alert(error.message || '프로필을 저장하지 못했습니다.');
    } finally {
      state.saving = false;
      syncSaveDock();
    }
  }

  function syncSaveDock(savedHint) {
    const button = document.getElementById('profileCustomizeSave');
    const label = document.getElementById('profileCustomizeSaveState');
    const hint = document.getElementById('profileCustomizeSaveHint');
    const dirty = isDirty();
    if (button) {
      button.disabled = state.saving || !dirty;
      button.textContent = state.saving ? '저장 중...' : dirty ? '변경사항 저장' : '저장됨';
    }
    if (label) label.textContent = state.saving ? '저장 중' : dirty ? '변경사항 있음' : '저장됨';
    if (hint) hint.textContent = savedHint || (dirty ? '저장하면 작가 프로필에 바로 반영됩니다.' : '프로필 카드가 최신 상태입니다.');
  }

  function isDirty() {
    return Boolean(state.saved && state.selection && JSON.stringify(state.saved) !== JSON.stringify(state.selection));
  }

  function findItem(group, key) {
    return state.inventory[group].find((item) => item.key === key) || null;
  }

  function backgroundPalette(key) {
    if (key === 'background_writer_grove') return ['#EAF5EE', '#C7E3D0', '#2F7250'];
    if (key === 'background_deep_forest') return ['#DCEFE5', '#8DBB9E', '#215E43'];
    if (key === 'background_prompt_letters') return ['#FFF1E8', '#E8F0FF', '#8A5B4B'];
    return ['#F8F5EC', '#E8F1E8', '#5D6F5C'];
  }

  function rarityLabel(value) {
    if (value === 'epic') return '에픽';
    if (value === 'rare') return '레어';
    return '일반';
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', ProfileCustomize.init);
