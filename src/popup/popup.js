/**
 * nw_anilist - Popup Controller
 */

import { StorageService, getMediaListStatus } from '../services/storage.js';
import { AniListService, ANILIST_AUTH_URL } from '../services/anilist.js';
import { NaverWebtoonService } from '../services/naver.js';

// Application State
const state = {
  auth: null,
  settings: null,
  mappings: {},
  syncHistory: {}, // { [naverTitleId]: { episodeNo, syncedAt, mediaId } }
  scannedItems: [], // { titleId, titleName, episodeNo, episodeTitle, isCompleted, isHiatus, thumbnail, anilistData: { mediaId, title, currentProgress, status }, selected }
  activeSearchItem: null // item currently being manually searched/matched
};

// DOM Elements
const elements = {
  // Auth
  btnLogin: document.getElementById('btnLogin'),
  userInfo: document.getElementById('userInfo'),
  userAvatar: document.getElementById('userAvatar'),
  userName: document.getElementById('userName'),
  btnLogout: document.getElementById('btnLogout'),
  authNotice: document.getElementById('authNotice'),
  btnOpenAuthUrl: document.getElementById('btnOpenAuthUrl'),
  btnEnterToken: document.getElementById('btnEnterToken'),
  tokenModal: document.getElementById('tokenModal'),
  btnCloseTokenModal: document.getElementById('btnCloseTokenModal'),
  inputToken: document.getElementById('inputToken'),
  btnSaveToken: document.getElementById('btnSaveToken'),
  tokenError: document.getElementById('tokenError'),

  // Actions
  btnScanRecent: document.getElementById('btnScanRecent'),
  scanStatus: document.getElementById('scanStatus'),
  statusMessage: document.getElementById('statusMessage'),

  // Results
  emptyState: document.getElementById('emptyState'),
  resultsSection: document.getElementById('resultsSection'),
  chkSelectAll: document.getElementById('chkSelectAll'),
  selectedCount: document.getElementById('selectedCount'),
  totalCount: document.getElementById('totalCount'),
  webtoonList: document.getElementById('webtoonList'),
  bottomBar: document.getElementById('bottomBar'),
  btnBatchSync: document.getElementById('btnBatchSync'),
  btnBatchSyncText: document.getElementById('btnBatchSyncText'),

  // Search Modal
  searchModal: document.getElementById('searchModal'),
  btnCloseSearchModal: document.getElementById('btnCloseSearchModal'),
  searchTargetNaverTitle: document.getElementById('searchTargetNaverTitle'),
  inputSearchQuery: document.getElementById('inputSearchQuery'),
  btnExecuteSearch: document.getElementById('btnExecuteSearch'),
  searchLoading: document.getElementById('searchLoading'),
  searchResultsList: document.getElementById('searchResultsList'),

  // Toast
  toast: document.getElementById('toastNotification')
};

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  await loadInitialState();
  setupEventListeners();
});

async function loadInitialState() {
  state.auth = await StorageService.getAuth();
  state.settings = await StorageService.getSettings();
  state.mappings = await StorageService.getMappings();
  state.syncHistory = await StorageService.getSyncHistory();

  // Render Auth State
  updateAuthUI();
}

function updateAuthUI() {
  if (state.auth && state.auth.user) {
    elements.btnLogin.classList.add('hidden');
    elements.userInfo.classList.remove('hidden');
    elements.userAvatar.src = state.auth.user.avatar?.medium || '';
    elements.userName.textContent = state.auth.user.name || 'User';
    elements.authNotice.classList.add('hidden');
  } else {
    elements.btnLogin.classList.remove('hidden');
    elements.userInfo.classList.add('hidden');
    elements.authNotice.classList.remove('hidden');
  }
}

function setupEventListeners() {
  // Auth Triggers
  elements.btnLogin.addEventListener('click', () => openTokenModal());
  elements.btnEnterToken.addEventListener('click', () => openTokenModal());
  elements.btnOpenAuthUrl.addEventListener('click', () => {
    chrome.tabs.create({ url: ANILIST_AUTH_URL });
  });

  elements.btnCloseTokenModal.addEventListener('click', () => closeTokenModal());
  elements.btnSaveToken.addEventListener('click', handleSaveToken);

  elements.btnLogout.addEventListener('click', async () => {
    await StorageService.clearAuth();
    state.auth = null;
    updateAuthUI();
    showToast('AniList 연동이 해제되었습니다.');
  });

  // Scan Recent Button
  elements.btnScanRecent.addEventListener('click', handleScanRecent);

  // Select All
  elements.chkSelectAll.addEventListener('change', (e) => {
    const isChecked = e.target.checked;
    state.scannedItems.forEach(item => {
      if (item.anilistData && item.anilistData.mediaId) {
        item.selected = isChecked;
      }
    });
    renderWebtoonList();
  });

  // Batch Sync Action
  elements.btnBatchSync.addEventListener('click', handleBatchSync);

  // Search Modal
  elements.btnCloseSearchModal.addEventListener('click', () => {
    elements.searchModal.classList.add('hidden');
  });
  elements.btnExecuteSearch.addEventListener('click', handleExecuteSearch);
  elements.inputSearchQuery.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleExecuteSearch();
  });
}

function openTokenModal() {
  elements.tokenError.classList.add('hidden');
  elements.inputToken.value = '';
  elements.tokenModal.classList.remove('hidden');
}

function closeTokenModal() {
  elements.tokenModal.classList.add('hidden');
}

async function handleSaveToken() {
  let rawToken = elements.inputToken.value.trim();
  if (!rawToken) {
    showTokenError('토큰을 입력해주세요.');
    return;
  }

  // Handle URL fragment if user pasted the entire redirect URL
  if (rawToken.includes('access_token=')) {
    const match = rawToken.match(/access_token=([^&]+)/);
    if (match) {
      rawToken = match[1];
    }
  }

  elements.btnSaveToken.disabled = true;
  elements.btnSaveToken.textContent = '인증 확인 중...';

  try {
    const user = await AniListService.getViewer(rawToken);
    const authData = { token: rawToken, user };
    await StorageService.setAuth(authData);
    state.auth = authData;

    updateAuthUI();
    closeTokenModal();
    showToast(`반갑습니다, ${user.name}님! 연동되었습니다.`);
  } catch (err) {
    showTokenError('유효하지 않은 토큰입니다. 다시 확인해주세요.');
  } finally {
    elements.btnSaveToken.disabled = false;
    elements.btnSaveToken.textContent = '연결 완료';
  }
}

function showTokenError(msg) {
  elements.tokenError.textContent = msg;
  elements.tokenError.classList.remove('hidden');
}

/**
 * Handle scan recent webtoons from Naver
 */
async function handleScanRecent() {
  if (!state.auth || !state.auth.token) {
    showToast('먼저 AniList 계정을 연동해 주세요.');
    openTokenModal();
    return;
  }

  setLoadingStatus(true, '네이버 최근 본 웹툰 기록을 조회하는 중...');

  try {
    const recentWebtoons = await NaverWebtoonService.fetchRecentWebtoons();

    if (!recentWebtoons || recentWebtoons.length === 0) {
      setLoadingStatus(false);
      showToast('최근 감상한 웹툰이 없거나 네이버 로그인이 필요합니다.');
      return;
    }

    setLoadingStatus(true, 'AniList 보관함과 비교 대조 중...');

    // Fetch user's current AniList Manga collection & latest sync history
    const userMangaMap = await AniListService.getUserMangaList(state.auth.user.id, state.auth.token);
    state.mappings = await StorageService.getMappings();
    state.syncHistory = await StorageService.getSyncHistory();

    const processedList = [];

    for (let i = 0; i < recentWebtoons.length; i++) {
      const item = recentWebtoons[i];
      let mapping = state.mappings[item.titleId];
      let anilistData = null;

      // Auto-search if no mapping exists yet (rate limited smoothly)
      if (!mapping) {
        setLoadingStatus(true, `AniList 작품 매칭 중 (${i + 1}/${recentWebtoons.length}): ${item.titleName}`);
        try {
          const results = await AniListService.searchManga(item.titleName, 1);
          if (results && results.length > 0) {
            const top = results[0];
            mapping = {
              mediaId: top.id,
              anilistTitle: top.title.userPreferred || top.title.native || top.title.romaji,
              coverImage: top.coverImage?.medium
            };
            // Cache auto-mapping
            await StorageService.setMapping(item.titleId, mapping);
            state.mappings[item.titleId] = mapping;
          }
          // Throttle searches to stay well under AniList's 90 req/min limit
          await new Promise(r => setTimeout(r, 700));
        } catch (e) {
          console.warn('Auto search skipped/rate limited for', item.titleName, e);
          // Don't crash, let user manually match later
          await new Promise(r => setTimeout(r, 1000));
        }
      }

      if (mapping) {
        const alEntry = userMangaMap[mapping.mediaId];
        anilistData = {
          mediaId: mapping.mediaId,
          title: mapping.anilistTitle,
          coverImage: mapping.coverImage,
          currentProgress: alEntry ? (alEntry.progress || 0) : 0,
          currentStatus: alEntry ? alEntry.status : 'NOT_IN_LIST'
        };
      }

      // Check against Local Sync History & AniList State
      const historyRecord = state.syncHistory[item.titleId];
      const lastSyncedEp = historyRecord ? Number(historyRecord.episodeNo) : 0;
      const currentAL = anilistData ? Number(anilistData.currentProgress) : 0;
      const currentStatus = anilistData ? anilistData.currentStatus : 'NOT_IN_LIST';

      const threshold = state.settings?.planningThreshold || 5;
      const targetStatus = getMediaListStatus(item.episodeNo, threshold);

      // Has this exact episode (or newer) and matching status already been synced?
      const isStatusMatch = currentStatus === targetStatus;
      const isAlreadySyncedInAniList = isStatusMatch && currentAL >= item.episodeNo;
      const isAlreadySyncedLocally = isStatusMatch && lastSyncedEp >= item.episodeNo;
      const isUnchanged = (isAlreadySyncedInAniList || isAlreadySyncedLocally) && currentStatus !== 'NOT_IN_LIST';

      const needsSync = !isUnchanged;

      processedList.push({
        ...item,
        anilistData,
        lastSyncedEp,
        needsSync,
        selected: Boolean(mapping && needsSync) // Unchanged items are deselected by default
      });
    }

    state.scannedItems = processedList;
    setLoadingStatus(false);
    renderWebtoonList();

    showToast(`${processedList.length}개의 최근 본 웹툰을 스캔했습니다.`);
  } catch (err) {
    setLoadingStatus(false);
    console.error('Scan error:', err);
    if (err.message === 'NEEDS_LOGIN') {
      showToast('네이버 로그인이 필요합니다. 네이버 웹툰에 먼저 로그인해주세요.');
    } else {
      showToast('불러오기 실패: ' + err.message);
    }
  }
}

function setLoadingStatus(isLoading, message = '') {
  if (isLoading) {
    elements.scanStatus.classList.remove('hidden');
    elements.statusMessage.textContent = message;
    elements.emptyState.classList.add('hidden');
  } else {
    elements.scanStatus.classList.add('hidden');
  }
}

/**
 * Render the Webtoon Diff list (Clean single list)
 */
function renderWebtoonList() {
  if (state.scannedItems.length === 0) {
    elements.emptyState.classList.remove('hidden');
    elements.resultsSection.classList.add('hidden');
    elements.bottomBar.classList.add('hidden');
    return;
  }

  elements.emptyState.classList.add('hidden');
  elements.resultsSection.classList.remove('hidden');
  elements.bottomBar.classList.remove('hidden');

  elements.webtoonList.innerHTML = '';

  let selectedCount = 0;
  let eligibleCount = 0;

  state.scannedItems.forEach((item, masterIndex) => {
    const card = document.createElement('div');
    card.className = `webtoon-card ${!item.anilistData ? 'unmatched' : ''} ${!item.needsSync ? 'up-to-date' : ''}`.trim();

    if (item.selected) selectedCount++;
    if (item.anilistData) eligibleCount++;

    const threshold = state.settings?.planningThreshold || 5;
    const targetStatus = getMediaListStatus(item.episodeNo, threshold);
    const isPlanning = targetStatus === 'PLANNING';
    const statusLabel = isPlanning ? 'Planning' : 'Reading';
    const statusBadge = `<span class="target-status-badge ${isPlanning ? 'planning' : 'reading'}">${statusLabel}</span>`;

    // Progress Badge with direct edit button
    let progressHtml = '';
    const editBtnHtml = `<button class="btn-inline-edit-ep" data-index="${masterIndex}" title="회차 직접 수정">✏️ ${item.episodeNo}화</button>`;

    if (item.anilistData) {
      const alProg = item.anilistData.currentProgress;
      const diff = item.episodeNo - alProg;

      if (!item.needsSync) {
        progressHtml = `
          <span class="progress-pill pill-synced">
            ✓ 최신 상태 (${editBtnHtml} · ${statusLabel})
          </span>
        `;
      } else if (diff > 0) {
        progressHtml = `
          <span class="progress-pill pill-diff">
            AniList ${alProg}화 ➔ ${editBtnHtml} (+${diff}화 신규 · ${statusLabel})
          </span>
        `;
      } else if (diff < 0) {
        progressHtml = `
          <span class="progress-pill pill-diff">
            AniList ${alProg}화 ➔ ${editBtnHtml} (${diff}화 · ${statusLabel})
          </span>
        `;
      } else {
        progressHtml = `
          <span class="progress-pill pill-diff">
            상태 갱신: ${item.anilistData.currentStatus} ➔ ${statusLabel} (${editBtnHtml})
          </span>
        `;
      }
    } else {
      progressHtml = `
        <span class="progress-pill pill-synced">
          네이버 최근 본 회차: ${editBtnHtml} (${statusLabel})
        </span>
      `;
    }

    // Mapping info or Connect button
    let mappingHtml = '';
    if (item.anilistData) {
      mappingHtml = `
        <span class="matched-label" title="${item.anilistData.title}">
          ✓ ${item.anilistData.title}
        </span>
        <button class="btn-link-mapping btn-relink" data-index="${masterIndex}">변경</button>
      `;
    } else {
      mappingHtml = `
        <span style="color: #f59e0b;">AniList 매칭 필요</span>
        <button class="btn-link-mapping btn-match" data-index="${masterIndex}">+ 작품 연결</button>
      `;
    }

    card.innerHTML = `
      <div class="card-select">
        <label class="checkbox-container">
          <input type="checkbox" class="chk-item" data-index="${masterIndex}" ${item.selected ? 'checked' : ''} ${!item.anilistData ? 'disabled' : ''}>
          <span class="checkmark"></span>
        </label>
      </div>
      <img class="card-thumb" src="${item.thumbnail || item.anilistData?.coverImage || ''}" alt="Cover" onerror="this.src='https://via.placeholder.com/48x64?text=NW'">
      <div class="card-content">
        <div class="card-title-row">
          <span class="card-title" title="${item.titleName}">${item.titleName}</span>
          ${statusBadge}
        </div>
        <div class="card-progress-row">
          ${progressHtml}
        </div>
        <div class="card-mapping-row">
          ${mappingHtml}
        </div>
      </div>
    `;

    elements.webtoonList.appendChild(card);
  });

  // Update counts
  elements.selectedCount.textContent = selectedCount;
  elements.totalCount.textContent = state.scannedItems.length;
  elements.chkSelectAll.checked = eligibleCount > 0 && selectedCount === eligibleCount;

  elements.btnBatchSync.disabled = selectedCount === 0;
  elements.btnBatchSyncText.textContent = `선택한 ${selectedCount}개 웹툰 AniList에 일괄 동기화`;

  // Attach card event listeners
  document.querySelectorAll('.chk-item').forEach(chk => {
    chk.addEventListener('change', (e) => {
      const idx = parseInt(e.target.dataset.index, 10);
      state.scannedItems[idx].selected = e.target.checked;
      renderWebtoonList();
    });
  });

  document.querySelectorAll('.btn-match, .btn-relink').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const idx = parseInt(e.target.dataset.index, 10);
      openSearchModal(state.scannedItems[idx]);
    });
  });

  // Direct Episode Editing
  document.querySelectorAll('.btn-inline-edit-ep').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(e.currentTarget.dataset.index, 10);
      const item = state.scannedItems[idx];
      const input = prompt(`'${item.titleName}' 동기화할 회차 번호를 입력하세요:`, item.episodeNo);
      if (input !== null) {
        const parsed = parseInt(input.trim(), 10);
        if (!isNaN(parsed) && parsed > 0) {
          item.episodeNo = parsed;
          if (item.anilistData) {
            item.needsSync = true;
            item.selected = true;
          }
          renderWebtoonList();
          showToast(`'${item.titleName}' 회차가 ${parsed}화로 변경되었습니다.`);
        }
      }
    });
  });
}

/**
 * Open manual search modal for a webtoon
 */
function openSearchModal(item) {
  state.activeSearchItem = item;
  elements.searchTargetNaverTitle.textContent = item.titleName;
  elements.inputSearchQuery.value = item.titleName;
  elements.searchResultsList.innerHTML = '';
  elements.searchModal.classList.remove('hidden');

  // Trigger search immediately
  handleExecuteSearch();
}

async function handleExecuteSearch() {
  const query = elements.inputSearchQuery.value.trim();
  if (!query) return;

  elements.searchLoading.classList.remove('hidden');
  elements.searchResultsList.innerHTML = '';

  try {
    const results = await AniListService.searchManga(query, 10);
    elements.searchLoading.classList.add('hidden');

    if (!results || results.length === 0) {
      elements.searchResultsList.innerHTML = '<p class="sub-text" style="text-align:center; padding: 14px;">검색 결과가 없습니다.</p>';
      return;
    }

    results.forEach(res => {
      const itemEl = document.createElement('div');
      itemEl.className = 'search-item';

      const titlePreferred = res.title.userPreferred || res.title.native || res.title.romaji;
      const nativeTitle = res.title.native ? `(원제: ${res.title.native})` : '';
      const chaptersText = res.chapters ? `${res.chapters}화` : '연재중';

      itemEl.innerHTML = `
        <img class="search-item-thumb" src="${res.coverImage?.medium || ''}" alt="Cover">
        <div class="search-item-info">
          <div class="search-item-title">${titlePreferred}</div>
          <div class="search-item-sub">${nativeTitle} · ${chaptersText} · ${res.status || ''}</div>
        </div>
        <button class="btn-select-match" data-media-id="${res.id}">연결</button>
      `;

      itemEl.querySelector('.btn-select-match').addEventListener('click', async () => {
        await applyMapping(res);
      });

      elements.searchResultsList.appendChild(itemEl);
    });
  } catch (err) {
    elements.searchLoading.classList.add('hidden');
    elements.searchResultsList.innerHTML = `<p class="sub-text" style="color:var(--danger); text-align:center;">오류: ${err.message}</p>`;
  }
}

/**
 * Apply selected mapping
 */
async function applyMapping(anilistMedia) {
  if (!state.activeSearchItem) return;

  const mapping = {
    mediaId: anilistMedia.id,
    anilistTitle: anilistMedia.title.userPreferred || anilistMedia.title.native || anilistMedia.title.romaji,
    coverImage: anilistMedia.coverImage?.medium
  };

  await StorageService.setMapping(state.activeSearchItem.titleId, mapping);
  state.mappings[state.activeSearchItem.titleId] = mapping;

  state.activeSearchItem.anilistData = {
    mediaId: mapping.mediaId,
    title: mapping.anilistTitle,
    coverImage: mapping.coverImage,
    currentProgress: 0,
    currentStatus: 'NOT_IN_LIST'
  };
  state.activeSearchItem.selected = true;
  state.activeSearchItem.needsSync = true;

  elements.searchModal.classList.add('hidden');
  renderWebtoonList();
  showToast(`'${mapping.anilistTitle}' 작품과 연결되었습니다.`);
}

/**
 * Handle Batch Sync - unconditionally sync as CURRENT (Reading)
 */
async function handleBatchSync() {
  const selectedItems = state.scannedItems.filter(item => item.selected && item.anilistData?.mediaId);

  if (selectedItems.length === 0) {
    showToast('동기화할 웹툰을 선택해주세요.');
    return;
  }

  elements.btnBatchSync.disabled = true;
  let successCount = 0;
  let failCount = 0;
  const successfullySyncedItems = [];

  for (let i = 0; i < selectedItems.length; i++) {
    const item = selectedItems[i];
    elements.btnBatchSyncText.textContent = `동기화 진행 중 (${i + 1}/${selectedItems.length})...`;

    try {
      const threshold = state.settings?.planningThreshold || 5;
      const targetStatus = getMediaListStatus(item.episodeNo, threshold);

      await AniListService.saveMediaListEntry(
        {
          mediaId: item.anilistData.mediaId,
          progress: item.episodeNo,
          status: targetStatus
        },
        state.auth.token
      );

      item.anilistData.currentProgress = item.episodeNo;
      item.anilistData.currentStatus = targetStatus;
      item.lastSyncedEp = item.episodeNo;
      item.needsSync = false;
      item.selected = false;
      successfullySyncedItems.push(item);
      successCount++;

      // Rate Limit 방어: 요청 간 800ms 안전 딜레이
      await new Promise(r => setTimeout(r, 800));
    } catch (err) {
      console.error('Failed to sync item:', item.titleName, err);
      failCount++;
    }
  }

  // 성공적으로 동기화된 웹툰 목록을 로컬 스토리지에 영구 기록
  if (successfullySyncedItems.length > 0) {
    await StorageService.recordBatchSync(successfullySyncedItems);
    state.syncHistory = await StorageService.getSyncHistory();
  }

  elements.btnBatchSync.disabled = false;
  elements.btnBatchSyncText.textContent = '선택한 웹툰 AniList에 일괄 동기화';

  renderWebtoonList();

  if (failCount === 0) {
    showToast(`🎉 총 ${successCount}개 웹툰이 AniList에 성공적으로 동기화되었습니다! (5화 이하: Planning / 6화 이상: Reading)`);
  } else {
    showToast(`동기화 완료: ${successCount}개 성공, ${failCount}개 실패`);
  }
}

/**
 * Toast Helper
 */
let toastTimer = null;
function showToast(message) {
  if (toastTimer) clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.remove('hidden');

  toastTimer = setTimeout(() => {
    elements.toast.classList.add('hidden');
  }, 3200);
}
