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
function inPageExtractor() {
  const items = [];

  // Check if page redirected to login
  if (document.body.innerText.includes('로그인이 필요합니다') || window.location.href.includes('nidlogin.login')) {
    return [];
  }

  // Support list view, card view, and poster grids
  const candidateElements = document.querySelectorAll('li, div[class*="Poster"], div[class*="item"], div[class*="Card"], tr');

  candidateElements.forEach(el => {
    // Look for link with titleId
    const link = el.querySelector('a[href*="titleId"]');
    if (!link) return;

    const href = link.getAttribute('href') || '';
    const urlParams = new URLSearchParams(href.split('?')[1] || '');
    const titleId = urlParams.get('titleId');
    const no = urlParams.get('no') || '1';

    if (!titleId) return;

    // Avoid duplicates
    if (items.some(it => it.titleId === titleId)) return;

    // Title Name
    const titleEl = el.querySelector('[class*="title"], [class*="name"], strong, h3, h4, .tit');
    let titleName = titleEl ? titleEl.textContent.trim() : '';

    if (!titleName) {
      // Try link title or text
      titleName = link.getAttribute('title') || link.textContent.trim();
    }
    // Clean UP badge text (e.g. "UP 시한부 천재가 살아남는 법")
    titleName = titleName.replace(/^UP\s*/, '').replace(/NEW\s*/, '').trim();

    if (!titleName || titleName.length < 2) return;

    // Episode Number
    let episodeNo = parseInt(no, 10) || 1;
    const wholeText = el.textContent || '';
    const epMatch = wholeText.match(/(?:제\s*)?(\d+)\s*(?:화|회|장|편)/);
    if (epMatch) {
      episodeNo = parseInt(epMatch[1], 10);
    }

    // Completion & Hiatus status
    const isCompleted = wholeText.includes('완결') || el.querySelector('[class*="complete"]') !== null;
    const isHiatus = wholeText.includes('휴재') || el.querySelector('[class*="rest"], [class*="hiatus"]') !== null;

    // Poster Image
    const imgEl = el.querySelector('img');
    const thumbnail = imgEl ? (imgEl.src || imgEl.getAttribute('data-src') || '') : '';

    items.push({
      titleId,
      titleName,
      episodeNo,
      episodeTitle: '',
      isCompleted,
      isHiatus,
      thumbnail
    });
  });

  return items;
}
