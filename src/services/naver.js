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
      // 1. Find if user already has comic.naver.com open
      const tabs = await new Promise((resolve) => {
        chrome.tabs.query({ url: '*://comic.naver.com/*' }, (result) => {
          resolve(result || []);
        });
      });

      if (tabs.length > 0) {
        // Prefer mypage tab if open, otherwise the first comic.naver.com tab
        const mypageTab = tabs.find(t => t.url?.includes('/mypage')) || tabs[0];
        const extracted = await this._extractFromTab(mypageTab.id);
        if (extracted && extracted.length > 0) {
          return extracted;
        }
      }

      // 2. If no tab found or tab yielded 0 items, temporarily open mypage in background tab
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
    return new Promise((resolve, reject) => {
      chrome.tabs.create({ url, active: false }, (newTab) => {
        if (!newTab || !newTab.id) {
          reject(new Error('네이버 탭을 생성할 수 없습니다.'));
          return;
        }

        const tabId = newTab.id;
        let attempts = 0;
        const maxAttempts = 6;

        // Poll for DOM content once tab finishes loading
        const listener = (updatedTabId, changeInfo) => {
          if (updatedTabId === tabId && changeInfo.status === 'complete') {
            chrome.tabs.onUpdated.removeListener(listener);

            const interval = setInterval(async () => {
              attempts++;
              const items = await this._extractFromTab(tabId);
              
              if ((items && items.length > 0) || attempts >= maxAttempts) {
                clearInterval(interval);
                // Close the background tab
                chrome.tabs.remove(tabId, () => {});
                resolve(items || []);
              }
            }, 600);
          }
        };

        chrome.tabs.onUpdated.addListener(listener);

        // Safety timeout (10 seconds)
        setTimeout(() => {
          chrome.tabs.onUpdated.removeListener(listener);
          chrome.tabs.remove(tabId, () => {});
          resolve([]);
        }, 10000);
      });
    });
  }
};

/**
 * In-Page Extraction Function (injected into comic.naver.com tab)
 * Reads React-rendered DOM elements (Mypage recently, favorite, or main)
 */
/**
 * In-Page Extraction Function (injected into comic.naver.com tab)
 * Reads React-rendered DOM elements (Mypage recently, favorite, or main)
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

    // 2) Episode Number Extraction (Crucial!)
    let episodeNo = null;

    // Priority A: Check all links in container for detail link with 'no' param (e.g. /webtoon/detail?titleId=...&no=62)
    const detailLinks = container.querySelectorAll('a[href*="no="]');
    for (const dLink of detailLinks) {
      const dHref = dLink.getAttribute('href') || '';
      const dParams = new URLSearchParams(dHref.split('?')[1] || '');
      const parsedNo = parseInt(dParams.get('no'), 10);
      if (parsedNo && parsedNo > 0) {
        episodeNo = parsedNo;
        break;
      }
    }

    // Priority B: Subtitle or Episode text element (e.g. "62화. 제목", "62화")
    if (!episodeNo) {
      const epTextEl = container.querySelector('[class*="sub_title"], [class*="episode"], [class*="desc"], [class*="info"] span, em');
      if (epTextEl) {
        const match = epTextEl.textContent.match(/(\d+)\s*(?:화|회|장|편)/);
        if (match) {
          episodeNo = parseInt(match[1], 10);
        }
      }
    }

    // Priority C: Entire container text regex search
    if (!episodeNo) {
      const containerText = container.innerText || container.textContent || '';
      // Find patterns like "62화", "62 회", "제 62 화"
      const epMatches = [...containerText.matchAll(/(?:제\s*)?(\d+)\s*(?:화|회|장|편)/g)];
      if (epMatches.length > 0) {
        // Take the last or most prominent episode match (ignores year 2026, date numbers)
        episodeNo = parseInt(epMatches[0][1], 10);
      }
    }

    // Fallback: If still nothing, check original link 'no' or default to 1
    if (!episodeNo) {
      episodeNo = parseInt(urlParams.get('no'), 10) || 1;
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
