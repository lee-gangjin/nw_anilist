/**
 * nw_anilist - Storage Service
 * Manages Chrome local storage for authentication, mappings, and user preferences.
 */

const STORAGE_KEYS = {
  AUTH: 'nw_anilist_auth',
  MAPPINGS: 'nw_anilist_mappings',
  SETTINGS: 'nw_anilist_settings',
  RECENT_CACHE: 'nw_anilist_recent_cache',
  SYNC_HISTORY: 'nw_anilist_sync_history'
};

const DEFAULT_SETTINGS = {
  autoScrollSync: true,          // Sync when scrolling 80% in viewer
  minScrollPercent: 80,
  syncNotification: true,
  planningThreshold: 5           // 5화 이하일 때 Planning(읽을 예정)으로 등록, 6화 이상은 Reading(CURRENT)
};

/**
 * Determine AniList MediaListStatus based on episode progress
 * 5화 이하: PLANNING, 6화 이상: CURRENT
 * @param {number|string} episodeNo
 * @param {number} threshold
 * @returns {'PLANNING'|'CURRENT'}
 */
export function getMediaListStatus(episodeNo, threshold = 5) {
  return Number(episodeNo) <= threshold ? 'PLANNING' : 'CURRENT';
}


export const StorageService = {
  /**
   * Get stored authentication data (token, user info)
   */
  async getAuth() {
    return new Promise((resolve) => {
      chrome.storage.local.get([STORAGE_KEYS.AUTH], (result) => {
        resolve(result[STORAGE_KEYS.AUTH] || null);
      });
    });
  },

  /**
   * Save authentication data
   */
  async setAuth(authData) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [STORAGE_KEYS.AUTH]: authData }, () => {
        resolve(authData);
      });
    });
  },

  /**
   * Clear authentication data (logout)
   */
  async clearAuth() {
    return new Promise((resolve) => {
      chrome.storage.local.remove([STORAGE_KEYS.AUTH], () => {
        resolve();
      });
    });
  },

  /**
   * Get all webtoon-to-anilist mappings
   * Returns: { [naverTitleId]: { mediaId, title, coverImage, status } }
   */
  async getMappings() {
    return new Promise((resolve) => {
      chrome.storage.local.get([STORAGE_KEYS.MAPPINGS], (result) => {
        resolve(result[STORAGE_KEYS.MAPPINGS] || {});
      });
    });
  },

  /**
   * Save a mapping for a single webtoon
   */
  async setMapping(naverTitleId, mappingData) {
    const mappings = await this.getMappings();
    mappings[naverTitleId] = {
      ...mappingData,
      updatedAt: new Date().toISOString()
    };
    return new Promise((resolve) => {
      chrome.storage.local.set({ [STORAGE_KEYS.MAPPINGS]: mappings }, () => {
        resolve(mappings);
      });
    });
  },

  /**
   * Remove a mapping
   */
  async removeMapping(naverTitleId) {
    const mappings = await this.getMappings();
    delete mappings[naverTitleId];
    return new Promise((resolve) => {
      chrome.storage.local.set({ [STORAGE_KEYS.MAPPINGS]: mappings }, () => {
        resolve(mappings);
      });
    });
  },

  /**
   * Get user preferences / settings
   */
  async getSettings() {
    return new Promise((resolve) => {
      chrome.storage.local.get([STORAGE_KEYS.SETTINGS], (result) => {
        resolve({ ...DEFAULT_SETTINGS, ...(result[STORAGE_KEYS.SETTINGS] || {}) });
      });
    });
  },

  /**
   * Save settings
   */
  async setSettings(newSettings) {
    const current = await this.getSettings();
    const updated = { ...current, ...newSettings };
    return new Promise((resolve) => {
      chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: updated }, () => {
        resolve(updated);
      });
    });
  },

  /**
   * Get sync history
   * Returns: { [naverTitleId]: { episodeNo: number, syncedAt: string, mediaId: number } }
   */
  async getSyncHistory() {
    return new Promise((resolve) => {
      chrome.storage.local.get([STORAGE_KEYS.SYNC_HISTORY], (result) => {
        resolve(result[STORAGE_KEYS.SYNC_HISTORY] || {});
      });
    });
  },

  /**
   * Record a single synced webtoon episode
   */
  async recordSync(naverTitleId, episodeNo, mediaId) {
    const history = await this.getSyncHistory();
    history[naverTitleId] = {
      episodeNo: Number(episodeNo),
      mediaId: Number(mediaId),
      syncedAt: new Date().toISOString()
    };
    return new Promise((resolve) => {
      chrome.storage.local.set({ [STORAGE_KEYS.SYNC_HISTORY]: history }, () => {
        resolve(history);
      });
    });
  },

  /**
   * Record multiple synced webtoon episodes at once
   */
  async recordBatchSync(items) {
    const history = await this.getSyncHistory();
    const now = new Date().toISOString();
    items.forEach(item => {
      if (item.titleId && item.episodeNo) {
        history[item.titleId] = {
          episodeNo: Number(item.episodeNo),
          mediaId: item.anilistData?.mediaId || null,
          syncedAt: now
        };
      }
    });
    return new Promise((resolve) => {
      chrome.storage.local.set({ [STORAGE_KEYS.SYNC_HISTORY]: history }, () => {
        resolve(history);
      });
    });
  }
};
