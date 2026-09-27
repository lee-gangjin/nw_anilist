/**
 * nw_anilist - Viewer Content Script
 * Injected on https://comic.naver.com/webtoon/detail*
 */

(function () {
  'use strict';

  // State
  let meta = null;
  let isSynced = false;
  let isSyncing = false;
  let floatingEl = null;

  function parseCurrentViewer() {
    const urlParams = new URLSearchParams(window.location.search);
    const titleId = urlParams.get('titleId');
    const no = parseInt(urlParams.get('no') || '1', 10);

    if (!titleId) return null;

    // Get Webtoon Title
    let title = '';
    const ogTitle = document.querySelector('meta[property="og:title"]')?.content || '';
    if (ogTitle) {
      title = ogTitle.split(' - ')[0].trim();
    }
    if (!title) {
      const h2 = document.querySelector('.EpisodeNavigation__title--..., h2, .comic_title');
      if (h2) title = h2.textContent.trim();
    }

    // Try parsing chapter number from subtitle or og:title
    let episodeNo = no;
    const epMatch = (ogTitle || document.title).match(/(?:제\s*)?(\d+)\s*(?:화|회|장|편)/);
    if (epMatch) {
      episodeNo = parseInt(epMatch[1], 10);
    }

    return {
      titleId,
      episodeNo,
      webtoonTitle: title || '웹툰'
    };
  }

  function init() {
    meta = parseCurrentViewer();
    if (!meta) return;

    createFloatingBadge();
    checkMappingStatus();
    setupScrollTrigger();
  }

  function createFloatingBadge() {
    floatingEl = document.createElement('div');
    floatingEl.className = 'nw-floating-container';
    floatingEl.innerHTML = `
      <div class="nw-badge" id="nwBadge">
        <div class="nw-badge-icon">AL</div>
        <div class="nw-badge-text">
          <span class="nw-status-dot syncing" id="nwDot"></span>
          <span class="nw-badge-title" id="nwTitle">${meta.webtoonTitle}</span>
          <span class="nw-badge-ep">${meta.episodeNo}화</span>
        </div>
      </div>
    `;

    document.body.appendChild(floatingEl);

    document.getElementById('nwBadge').addEventListener('click', () => {
      // Trigger sync manually if clicked
      triggerSync(true);
    });
  }

  function checkMappingStatus() {
    chrome.runtime.sendMessage({ type: 'CHECK_MAPPING', titleId: meta.titleId }, (res) => {
      const dot = document.getElementById('nwDot');
      if (!dot) return;

      if (res && res.mapping) {
        dot.className = 'nw-status-dot';
        dot.title = `AniList 매칭됨: ${res.mapping.anilistTitle}`;
      } else {
        dot.className = 'nw-status-dot unmatched';
        dot.title = 'AniList 미매칭 (확장 프로그램 팝업에서 연결 가능)';
      }
    });
  }

  function setupScrollTrigger() {
    let scrollTimeout = null;

    window.addEventListener('scroll', () => {
      if (isSynced || isSyncing) return;

      if (scrollTimeout) clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(() => {
        const scrollTop = window.scrollY || document.documentElement.scrollTop;
        const scrollHeight = document.documentElement.scrollHeight - window.innerHeight;

        if (scrollHeight <= 0) return;

        const progressPercent = (scrollTop / scrollHeight) * 100;

        // Auto sync if user read at least 80% of the webtoon
        if (progressPercent >= 80) {
          triggerSync(false);
        }
      }, 300);
    });
  }

  function triggerSync(isManual = false) {
    if (isSyncing || (isSynced && !isManual)) return;

    isSyncing = true;
    const dot = document.getElementById('nwDot');
    if (dot) dot.className = 'nw-status-dot syncing';

    chrome.runtime.sendMessage(
      {
        type: 'SYNC_EPISODE',
        payload: {
          titleId: meta.titleId,
          episodeNo: meta.episodeNo,
          webtoonTitle: meta.webtoonTitle
        }
      },
      (response) => {
        isSyncing = false;
        if (response && response.success) {
          isSynced = true;
          if (dot) dot.className = 'nw-status-dot';
          const titleEl = document.getElementById('nwTitle');
          if (titleEl) titleEl.textContent = '✓ AniList 동기화됨';
        } else {
          if (dot) dot.className = 'nw-status-dot unmatched';
          console.warn('[nw_anilist] Sync failed:', response?.error);
        }
      }
    );
  }

  // Run on page load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
