/**
 * nw_anilist - AniList GraphQL API Service
 */

const ANILIST_GRAPHQL_ENDPOINT = 'https://graphql.anilist.co';

// Public OAuth Client ID for nw_anilist extension (Implicit Grant flow)
export const ANILIST_CLIENT_ID = '24536';
export const ANILIST_AUTH_URL = `https://anilist.co/api/v2/oauth/authorize?client_id=${ANILIST_CLIENT_ID}&response_type=token`;

export const AniListService = {
  /**
   * Execute GraphQL request
   */
  async request(query, variables = {}, token = null) {
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    try {
      const response = await fetch(ANILIST_GRAPHQL_ENDPOINT, {
        method: 'POST',
        headers,
        body: JSON.stringify({ query, variables })
      });

      const json = await response.json();
      if (json.errors && json.errors.length > 0) {
        throw new Error(json.errors[0].message || 'AniList API Error');
      }
      return json.data;
    } catch (err) {
      console.error('[AniListService] GraphQL Error:', err);
      throw err;
    }
  },

  /**
   * Verify token and fetch current user profile
   */
  async getViewer(token) {
    const query = `
      query {
        Viewer {
          id
          name
          avatar {
            large
            medium
          }
          options {
            titleLanguage
          }
        }
      }
    `;
    const data = await this.request(query, {}, token);
    return data.Viewer;
  },

  /**
   * Search Manga / Manhwa by Korean, Romaji or English title
   */
  async searchManga(searchTitle, perPage = 8) {
    const query = `
      query ($search: String, $perPage: Int) {
        Page(page: 1, perPage: $perPage) {
          media(search: $search, type: MANGA, sort: [SEARCH_MATCH, POPULARITY_DESC]) {
            id
            title {
              userPreferred
              romaji
              english
              native
            }
            coverImage {
              large
              medium
            }
            format
            status
            chapters
            countryOfOrigin
            synonyms
            averageScore
          }
        }
      }
    `;

    const data = await this.request(query, { search: searchTitle, perPage });
    return data?.Page?.media || [];
  },

  /**
   * Fetch current user's manga collection
   */
  async getUserMangaList(userId, token) {
    const query = `
      query ($userId: Int) {
        MediaListCollection(userId: $userId, type: MANGA) {
          lists {
            name
            isCustomList
            status
            entries {
              id
              mediaId
              status
              progress
              media {
                id
                chapters
                status
                title {
                  userPreferred
                  native
                  romaji
                }
              }
            }
          }
        }
      }
    `;

    const data = await this.request(query, { userId }, token);
    const lists = data?.MediaListCollection?.lists || [];
    
    // Map entries by mediaId for fast lookup: { [mediaId]: entry }
    const entriesMap = {};
    for (const list of lists) {
      if (list.entries) {
        for (const entry of list.entries) {
          entriesMap[entry.mediaId] = entry;
        }
      }
    }
    return entriesMap;
  },

  /**
   * Update or Add an entry in AniList MediaList
   * @param {Object} params - { mediaId, progress, status }
   * @param {string} token
   */
  async saveMediaListEntry({ mediaId, progress, status = 'CURRENT' }, token) {
    const query = `
      mutation ($mediaId: Int, $progress: Int, $status: MediaListStatus) {
        SaveMediaListEntry(mediaId: $mediaId, progress: $progress, status: $status) {
          id
          mediaId
          status
          progress
          updatedAt
        }
      }
    `;

    const variables = {
      mediaId: Number(mediaId),
      progress: Number(progress),
      status: status
    };

    const data = await this.request(query, variables, token);
    return data?.SaveMediaListEntry;
  }
};
