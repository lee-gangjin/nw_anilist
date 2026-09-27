/**
 * nw_anilist - Naver Webtoon Parser Service
 * Fetches and parses recently read webtoons and viewer metadata from comic.naver.com
 */

export const NaverWebtoonService = {
  /**
   * Fetch user's recently read webtoon list from comic.naver.com
   * Uses browser's active session cookie (credentials: 'include')
   */
  async fetchRecentWebtoons() {
    try {
      // Fetch the recent webtoon mypage
      const response = await fetch('https://comic.naver.com/mypage/recentWebtoon', {
        method: 'GET',
        credentials: 'include',
        headers: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        }
      });

      if (!response.ok) {
        throw new Error(`네이버 응답 오류 (HTTP ${response.status})`);
      }

      const html = await response.text();

      // Check if user is logged into Naver
      if (html.includes('로그인이 필요합니다') || html.includes('nid.naver.com/nidlogin.login')) {
        throw new Error('NEEDS_LOGIN');
      }

      // 1. Try Next.js __NEXT_DATA__ JSON extraction (fastest, most reliable)
      const nextDataMatch = html.match(/<script\s+id="__NEXT_DATA__"\s+type="application\/json">([\s\S]*?)<\/script>/);
      if (nextDataMatch && nextDataMatch[1]) {
        try {
          const nextData = JSON.parse(nextDataMatch[1]);
          const recentList = this._extractFromNextData(nextData);
          if (recentList && recentList.length > 0) {
            return recentList;
          }
        } catch (e) {
          console.warn('[NaverWebtoonService] Failed to parse __NEXT_DATA__, falling back to DOM parsing', e);
        }
      }

      // 2. Fallback to DOM parsing
      return this._parseRecentFromHtml(html);
    } catch (err) {
      console.error('[NaverWebtoonService] fetchRecentWebtoons error:', err);
      throw err;
    }
  },

  /**
   * Extract webtoon list from __NEXT_DATA__ state
   */
  _extractFromNextData(nextData) {
    const pageProps = nextData?.props?.pageProps;
    if (!pageProps) return null;

    // Search common Next.js pageProps structures for webtoon array
    const candidates = [
      pageProps.recentWebtoonList,
      pageProps.recentList,
      pageProps.webtoonList,
      pageProps.data?.recentList,
      pageProps.dehydratedState?.queries?.[0]?.state?.data?.recentList
    ];

    let list = candidates.find(arr => Array.isArray(arr) && arr.length > 0);

    // If deeply nested in queries
    if (!list && pageProps.dehydratedState?.queries) {
      for (const q of pageProps.dehydratedState.queries) {
        const d = q?.state?.data;
        if (Array.isArray(d)) {
          list = d;
          break;
        } else if (Array.isArray(d?.itemList)) {
          list = d.itemList;
          break;
        } else if (Array.isArray(d?.recentList)) {
          list = d.recentList;
          break;
        }
      }
    }

    if (!list) return null;

    return list.map(item => this._normalizeWebtoonItem(item)).filter(Boolean);
  },

  /**
   * Normalize an item into a unified schema
   */
  _normalizeWebtoonItem(item) {
    if (!item) return null;

    const titleId = String(item.titleId || item.id || '');
    if (!titleId) return null;

    const titleName = (item.titleName || item.title || '').trim();
    
    // Episode number extraction
    let episodeNo = item.no || item.articleNo || item.episodeNo || 0;
    const epSubtitle = item.subtitle || item.episodeTitle || item.articleTitle || '';

    // If episodeNo is missing or raw article index, try extracting real chapter number from subtitle
    if (epSubtitle) {
      const match = epSubtitle.match(/(?:제\s*)?(\d+)\s*(?:화|회|장|편)/);
      if (match) {
        episodeNo = parseInt(match[1], 10);
      }
    }

    // Determine completion & hiatus status
    const isCompleted = Boolean(
      item.finished || 
      item.webtoonType === 'COMPLETE' || 
      item.publishDescription?.includes('완결') ||
      item.status === 'COMPLETED'
    );

    const isHiatus = Boolean(
      item.rest || 
      item.publishDescription?.includes('휴재') ||
      item.status === 'HIATUS'
    );

    const thumbnail = item.thumbnailUrl || item.posterUrl || item.imgUrl || '';

    return {
      titleId,
      titleName,
      episodeNo: Number(episodeNo) || 1,
      episodeTitle: epSubtitle,
      isCompleted,
      isHiatus,
      thumbnail
    };
  },

  /**
   * Fallback DOM parser for recent webtoons HTML
   */
  _parseRecentFromHtml(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const items = [];

    // Query list items
    const elements = doc.querySelectorAll('li[class*="EpisodeListList__item"], li[class*="item"], div[class*="Poster__poster"]');

    elements.forEach(el => {
      const link = el.querySelector('a[href*="titleId"]');
      if (!link) return;

      const href = link.getAttribute('href') || '';
      const urlParams = new URLSearchParams(href.split('?')[1] || '');
      const titleId = urlParams.get('titleId');
      const no = urlParams.get('no') || '1';

      if (!titleId) return;

      const titleEl = el.querySelector('[class*="title"], strong, h3, .name');
      const titleName = titleEl ? titleEl.textContent.trim() : '';

      const epEl = el.querySelector('[class*="sub_title"], [class*="desc"], .text');
      const epText = epEl ? epEl.textContent.trim() : '';

      let episodeNo = parseInt(no, 10);
      const epMatch = epText.match(/(?:제\s*)?(\d+)\s*(?:화|회|장|편)/);
      if (epMatch) {
        episodeNo = parseInt(epMatch[1], 10);
      }

      const isCompleted = el.textContent.includes('완결');
      const isHiatus = el.textContent.includes('휴재');

      const imgEl = el.querySelector('img');
      const thumbnail = imgEl ? (imgEl.src || imgEl.getAttribute('data-src') || '') : '';

      if (titleName) {
        items.push({
          titleId,
          titleName,
          episodeNo,
          episodeTitle: epText,
          isCompleted,
          isHiatus,
          thumbnail
        });
      }
    });

    return items;
  },

  /**
   * Parse metadata directly from viewer page
   */
  parseViewerPage(doc, location) {
    const urlParams = new URLSearchParams(location.search);
    const titleId = urlParams.get('titleId');
    const no = parseInt(urlParams.get('no') || '1', 10);

    if (!titleId) return null;

    // Title from page
    const ogTitle = doc.querySelector('meta[property="og:title"]')?.content || '';
    let webtoonTitle = ogTitle;

    // Typical format: "제목 - 150화 서브타이틀"
    if (webtoonTitle.includes(' - ')) {
      webtoonTitle = webtoonTitle.split(' - ')[0].trim();
    }

    if (!webtoonTitle) {
      const titleEl = doc.querySelector('.EpisodeNavigation__title--...', 'h2', '.comic_title');
      if (titleEl) webtoonTitle = titleEl.textContent.trim();
    }

    // Episode title & real chapter number
    let episodeNo = no;
    const epSubtitleEl = doc.querySelector('.EpisodeNavigation__sub_title--...', '.tit_sub', 'h3');
    const epSubtitle = epSubtitleEl ? epSubtitleEl.textContent.trim() : '';

    const match = (epSubtitle || ogTitle).match(/(?:제\s*)?(\d+)\s*(?:화|회|장|편)/);
    if (match) {
      episodeNo = parseInt(match[1], 10);
    }

    return {
      titleId,
      webtoonTitle: webtoonTitle || '웹툰',
      episodeNo,
      episodeTitle: epSubtitle
    };
  }
};
