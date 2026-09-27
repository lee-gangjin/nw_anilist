/**
 * nw_anilist - Naver Webtoon Parser Service
 * Scans webtoon data directly from active or background comic.naver.com tabs
 * (Solves React SPA empty HTML limitation)
 */

export const NaverWebtoonService = {
  /**
   * Fetch webtoon list by scanning the open comic.naver.com tab (or launching a scan tab)
   */
  async fetchRecentWebtoons() {
    try {
      // 1. Check if user already has the exact '최근 본' tab open (comic.naver.com/mypage/recently)
      const tabs = await new Promise((resolve) => {
        chrome.tabs.query({ url: '*://comic.naver.com/mypage/recently*' }, (result) => {
          resolve(result || []);
        });
      });

      if (tabs.length > 0) {
        const extracted = await this._extractFromTab(tabs[0].id);
        if (extracted && extracted.length > 0) {
          return extracted;
        }
      }

      // 2. Always scan the official '최근 본' page via a silent background tab
      return await this._scanViaBackgroundTab('https://comic.naver.com/mypage/recently');
    } catch (err) {
      console.error('[NaverWebtoonService] fetchRecentWebtoons error:', err);
      throw err;
    }
  },

  /**
   * Extract webtoons by executing script on an existing tab
   */
  async _extractFromTab(tabId) {
    return new Promise((resolve) => {
      chrome.scripting.executeScript(
        {
          target: { tabId },
          func: inPageExtractor
        },
        (injectionResults) => {
          if (chrome.runtime.lastError || !injectionResults || !injectionResults[0]) {
            console.warn('[NaverWebtoonService] Script injection failed:', chrome.runtime.lastError);
            resolve([]);
          } else {
            resolve(injectionResults[0].result || []);
          }
        }
      );
    });
  },

  /**
   * Temporarily open a background tab, wait for React to mount, and extract DOM
   */
  async _scanViaBackgroundTab(url) {
    return new Promise((resolve) => {
      chrome.tabs.create({ url, active: false }, (newTab) => {
        if (!newTab || !newTab.id) {
          resolve([]);
          return;
        }

        const tabId = newTab.id;
        let attempts = 0;
        const maxAttempts = 12; // up to 6 seconds polling
        let isDone = false;

        const checkAndExtract = async () => {
          if (isDone) return;
          attempts++;
          const items = await this._extractFromTab(tabId);
          if (items && items.length > 0) {
            isDone = true;
            clearInterval(interval);
            chrome.tabs.remove(tabId, () => {});
            resolve(items);
          } else if (attempts >= maxAttempts) {
            isDone = true;
            clearInterval(interval);
            chrome.tabs.remove(tabId, () => {});
            resolve(items || []);
          }
        };

        // Start polling after slight delay for initial DOM/React mount
        const interval = setInterval(checkAndExtract, 500);

        // Safety timeout (8 seconds)
        setTimeout(() => {
          if (!isDone) {
            isDone = true;
            clearInterval(interval);
            chrome.tabs.remove(tabId, () => {});
            resolve([]);
          }
        }, 8000);
      });
    });
  }
};

/**
 * In-Page Extraction Function (injected into comic.naver.com tab)
 * Reads React-rendered DOM elements (Mypage recently)
 */
function inPageExtractor() {
  const items = [];

  // Check if page redirected to login
  if (document.body.innerText.includes('로그인이 필요합니다') || window.location.href.includes('nidlogin.login')) {
    return [];
  }

  // 1. Find all titleId links on page
  const allTitleLinks = document.querySelectorAll('a[href*="titleId"]');

  // Group by titleId using the closest card / row container
  const seenTitleIds = new Set();

  allTitleLinks.forEach(link => {
    const href = link.getAttribute('href') || '';
    const urlParams = new URLSearchParams(href.split('?')[1] || '');
    const titleId = urlParams.get('titleId');
    if (!titleId || seenTitleIds.has(titleId)) return;

    // Find the enclosing card / list item container
    const container = link.closest('li, tr, [class*="EpisodeListList__item"], [class*="item"], [class*="Card"], [class*="row"]') || link.parentElement;
    if (!container) return;

    seenTitleIds.add(titleId);

    // 1) Title Name (Clean badges like '휴재', '완결', 'UP', 'NEW')
    const titleEl = container.querySelector('[class*="title"], [class*="name"], strong, h3, h4, .tit');
    let titleName = '';

    if (titleEl) {
      // Clone element and remove badge/tag children so their text isn't concatenated
      const clone = titleEl.cloneNode(true);
      clone.querySelectorAll('[class*="badge"], [class*="rest"], [class*="hiatus"], [class*="tag"], [class*="icon"], [class*="blind"], em, i').forEach(b => b.remove());
      titleName = clone.textContent.trim();
    }

    if (!titleName) {
      titleName = link.getAttribute('title') || link.textContent.trim();
    }

    // Strip any remaining prefix text like "[휴재]", "휴재", "휴재신화급...", "UP", "NEW"
    titleName = titleName
      .replace(/^\[?(?:휴재|완결|UP|NEW|단독|독점|무료|15|18|19|컷툰|스마트툰)\]?\s*/gi, '')
      .replace(/^(?:휴재|완결|UP|NEW)\s*/gi, '')
      .replace(/^(?:휴재|완결|UP|NEW)(?=[가-힣A-Za-z0-9])/gi, '')
      .trim();

    if (!titleName || titleName.length < 2) return;

    // 2) Episode Number Extraction (Robust & Precise)
    let episodeNo = null;

    // Priority 1: Check detail links that match THIS titleId (e.g. /webtoon/detail?titleId=790713&no=62)
    const detailLinks = container.querySelectorAll(`a[href*="titleId=${titleId}"][href*="no="]`);
    for (const dLink of detailLinks) {
      const dHref = dLink.getAttribute('href') || '';
      const dParams = new URLSearchParams(dHref.split('?')[1] || '');
      const parsedNo = parseInt(dParams.get('no'), 10);
      if (parsedNo && parsedNo > 0) {
        episodeNo = parsedNo;
        break;
      }
    }

    // Priority 2: In Mypage Favorite table, episode count is rendered in its own cell/column (e.g. 136, 324)
    if (!episodeNo) {
      const cells = container.querySelectorAll('td, span, div, em, p');
      for (const cell of cells) {
        // Skip elements that contain children, only inspect leaf or short text
        if (cell.children.length === 0) {
          const cellText = cell.textContent.trim();
          // Check if exactly a pure number between 1 and 9999 (matches 136, 324)
          // Exclude dates like 26.09.23 or times
          if (/^\d{1,4}$/.test(cellText)) {
            const num = parseInt(cellText, 10);
            if (num > 0) {
              episodeNo = num;
              break;
            }
          }
        }
      }
    }

    // Priority 3: Subtitle or Episode text element with '화' (e.g. "62화. 제목", "62화")
    if (!episodeNo) {
      const epTextEl = container.querySelector('[class*="sub_title"], [class*="episode"], [class*="desc"], [class*="info"] span, em');
      if (epTextEl) {
        const match = epTextEl.textContent.match(/(\d+)\s*(?:화|회|장|편)/);
        if (match) {
          episodeNo = parseInt(match[1], 10);
        }
      }
    }

    // Priority 4: Regex search for "XX화" in container, safely ignoring author names (like Q10) and dates
    if (!episodeNo) {
      const containerText = container.innerText || container.textContent || '';
      // Explicitly match digits followed by '화/회/장/편'
      const epMatches = [...containerText.matchAll(/(\d+)\s*(?:화|회|장|편)/g)];
      if (epMatches.length > 0) {
        episodeNo = parseInt(epMatches[0][1], 10);
      }
    }

    // Fallback: Default to 1
    if (!episodeNo) {
      episodeNo = 1;
    }

    // 3) Completion & Hiatus status
    const wholeText = container.textContent || '';
    const isCompleted = wholeText.includes('완결') || container.querySelector('[class*="complete"]') !== null;
    const isHiatus = wholeText.includes('휴재') || container.querySelector('[class*="rest"], [class*="hiatus"]') !== null;

    // 4) Poster Image
    const imgEl = container.querySelector('img');
    const thumbnail = imgEl ? (imgEl.src || imgEl.getAttribute('data-src') || '') : '';

    items.push({
      titleId,
      titleName,
      episodeNo: Number(episodeNo),
      episodeTitle: '',
      isCompleted,
      isHiatus,
      thumbnail
    });
  });

  return items;
}
