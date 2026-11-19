/**
 * nw_anilist - Background Service Worker
 */

import { StorageService, getMediaListStatus } from '../services/storage.js';
import { AniListService } from '../services/anilist.js';

chrome.runtime.onInstalled.addListener((details) => {
  console.log('[nw_anilist] Extension installed/updated:', details.reason);
});

// Listen for messages from content scripts or popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'SYNC_EPISODE') {
    handleSingleSync(message.payload)
      .then(result => sendResponse({ success: true, result }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // Keep channel open for async response
  }

  if (message.type === 'CHECK_MAPPING') {
    StorageService.getMappings().then(mappings => {
      sendResponse({ mapping: mappings[message.titleId] || null });
    });
    return true;
  }
});

/**
 * Handle sync request from viewer content script
 */
async function handleSingleSync({ titleId, episodeNo, webtoonTitle }) {
  const auth = await StorageService.getAuth();
  if (!auth || !auth.token) {
    throw new Error('AniList 로그인이 필요합니다.');
  }

  const mappings = await StorageService.getMappings();
  let mapping = mappings[titleId];

  // If no mapping exists, attempt auto-search by Korean title
  if (!mapping) {
    const searchResults = await AniListService.searchManga(webtoonTitle, 1);
    if (searchResults && searchResults.length > 0) {
      const topMatch = searchResults[0];
      mapping = {
        mediaId: topMatch.id,
        anilistTitle: topMatch.title.userPreferred || topMatch.title.native,
        coverImage: topMatch.coverImage?.medium
      };
      await StorageService.setMapping(titleId, mapping);
    } else {
      throw new Error(`AniList에서 '${webtoonTitle}' 작품을 찾을 수 없습니다. 수동 매칭이 필요합니다.`);
    }
  }

  const settings = await StorageService.getSettings();
  const keepMaxProgress = settings.keepMaxProgress !== false;
  const numEpisodeNo = Number(episodeNo);

  // Check current AniList progress if keepMaxProgress is enabled
  if (keepMaxProgress) {
    try {
      const currentEntry = await AniListService.getMediaEntry(mapping.mediaId, auth.token);
      const currentProgress = currentEntry ? Number(currentEntry.progress || 0) : 0;

      if (currentEntry && currentProgress >= numEpisodeNo) {
        console.log(`[service_worker] Preserving max progress: Current AniList ${currentProgress} >= Viewed ${numEpisodeNo}`);
        await StorageService.recordSync(titleId, currentProgress, mapping.mediaId, true);
        return {
          mediaId: mapping.mediaId,
          title: mapping.anilistTitle,
          progress: currentProgress,
          requestedEpisode: numEpisodeNo,
          preserved: true,
          entry: currentEntry
        };
      }
    } catch (e) {
      console.warn('[service_worker] Failed to check AniList entry, falling back to local history:', e);
      const history = await StorageService.getSyncHistory();
      const localEp = history[titleId]?.episodeNo || 0;
      if (localEp >= numEpisodeNo) {
        return {
          mediaId: mapping.mediaId,
          title: mapping.anilistTitle,
          progress: localEp,
          requestedEpisode: numEpisodeNo,
          preserved: true
        };
      }
    }
  }

  const status = getMediaListStatus(numEpisodeNo, settings.planningThreshold || 5);

  // Save to AniList
  const updatedEntry = await AniListService.saveMediaListEntry(
    {
      mediaId: mapping.mediaId,
      progress: numEpisodeNo,
      status: status
    },
    auth.token
  );

  await StorageService.recordSync(titleId, numEpisodeNo, mapping.mediaId, keepMaxProgress);

  return {
    mediaId: mapping.mediaId,
    title: mapping.anilistTitle,
    progress: numEpisodeNo,
    preserved: false,
    entry: updatedEntry
  };
}
