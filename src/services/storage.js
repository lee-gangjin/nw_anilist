/**
 * nw_anilist - Storage Service
 * Manages Chrome local storage for authentication, mappings, and user preferences.
 */

const STORAGE_KEYS = {
  AUTH: 'nw_anilist_auth',
  MAPPINGS: 'nw_anilist_mappings',
  SETTINGS: 'nw_anilist_settings',
  RECENT_CACHE: 'nw_anilist_recent_cache'
};

const DEFAULT_SETTINGS = {
  completedHandling: 'COMPLETED', // 'COMPLETED' or 'CURRENT'
  hiatusHandling: 'COMPLETED',    // 'COMPLETED' or 'PAUSED' or 'CURRENT'
  autoScrollSync: true,          // Sync when scrolling 80% in viewer
  minScrollPercent: 80,
  syncNotification: true
};

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
  }
};
