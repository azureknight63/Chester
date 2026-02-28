/**
 * modelManager.js
 *
 * Retrieves up to 5 free, text-output models from OpenRouter daily and
 * caches them to disk. Models are sorted by:
 *   1. Roleplay / character suitability (tagged category)
 *   2. Popularity proxy   (recency — newer = more actively maintained/used)
 *   3. Speed proxy        (smaller context window = lighter model = faster)
 *   4. Efficiency         (stable tiebreaker via model ID)
 *
 * Exports:
 *   getFreeModels()    — returns the in-memory list, hydrating from disk or
 *                        network as needed (at most one fetch per 24 h)
 *   refreshModels()    — forces a fresh network fetch and rewrites the cache
 *   clearMemoryCache() — resets the in-memory cache (useful for testing)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const axios = require('axios');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const CACHE_FILE = path.join(__dirname, '.model_cache.json');
const MAX_MODELS = 5;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const FETCH_TIMEOUT_MS = 10_000;
const ROLEPLAY_CATEGORY = 'roleplay';

// ---------------------------------------------------------------------------
// OpenRouter request config
// ---------------------------------------------------------------------------

/**
 * Builds axios request config with a freshly-read API key.
 * Reading lazily (rather than at module load) ensures dotenv has had time to
 * populate process.env, and gives a clear error if the key is ever absent
 * rather than silently sending "Bearer undefined".
 *
 * @param {object} params  Optional query-string parameters.
 */
function buildRequestConfig(params = {}) {
    const key = process.env.OPENROUTER_API_KEY;
    if (!key) throw new Error('OPENROUTER_API_KEY is not set in the environment.');

    return {
        params,
        timeout: FETCH_TIMEOUT_MS,
        headers: {
            Authorization: `Bearer ${key}`,
            'HTTP-Referer': 'https://github.com/azureknight63/Chester',
            'X-Title': 'Chester',
        },
    };
}

// ---------------------------------------------------------------------------
// Model filtering helpers
// ---------------------------------------------------------------------------

/**
 * Returns true if prompt AND completion pricing are both zero.
 * parseFloat(undefined) === NaN, and NaN === 0 is false, so models
 * with missing pricing fields are correctly treated as non-free.
 */
function isFreeModel(model) {
    const { prompt, completion } = model.pricing ?? {};
    return parseFloat(prompt) === 0 && parseFloat(completion) === 0;
}

/** Returns true if the model emits only plain text (no images, audio, etc.). */
function isTextOnly(model) {
    const out = model.architecture?.output_modalities ?? [];
    return out.length > 0 && out.every(mod => mod === 'text');
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

/**
 * Fetches raw model objects from OpenRouter, optionally filtered by category.
 *
 * @param {string|null} category  OpenRouter category slug, or null for all.
 * @returns {Promise<object[]>}   Raw model objects.
 */
async function fetchModels(category = null) {
    const params = category ? { category } : {};
    const response = await axios.get(
        'https://openrouter.ai/api/v1/models',
        buildRequestConfig(params),
    );
    return response.data?.data ?? [];
}

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

/**
 * Filters to free text-only models, deduplicates, ranks, and returns the
 * top MAX_MODELS IDs.
 *
 * Sorting priority:
 *   1. Roleplay-tagged first       (rpIds membership)
 *   2. Recency (created DESC)      — popularity proxy
 *   3. Context length (ASC)        — speed proxy (smaller = faster)
 *   4. Model ID (ASC)              — stable tiebreaker
 *
 * @param {object[]}    models  Raw model objects from the API.
 * @param {Set<string>} rpIds   IDs returned by the roleplay category query.
 * @returns {string[]}          Ordered list of model ID strings.
 */
function rankModels(models, rpIds) {
    const seen = new Set();

    return models
        .filter(m => {
            if (!m?.id) return false;
            if (!isFreeModel(m)) return false;
            if (!isTextOnly(m)) return false;
            if (seen.has(m.id)) return false;
            seen.add(m.id);
            return true;
        })
        .sort((a, b) => {
            // 1. Roleplay-tagged first
            const rpDiff = (rpIds.has(b.id) ? 1 : 0) - (rpIds.has(a.id) ? 1 : 0);
            if (rpDiff !== 0) return rpDiff;

            // 2. Popularity proxy: newer models first
            const createdDiff = (b.created ?? 0) - (a.created ?? 0);
            if (createdDiff !== 0) return createdDiff;

            // 3. Speed proxy: smaller context window first
            const ctxDiff = (a.context_length ?? Infinity) - (b.context_length ?? Infinity);
            if (ctxDiff !== 0) return ctxDiff;

            // 4. Stable tiebreaker
            return a.id.localeCompare(b.id);
        })
        .slice(0, MAX_MODELS)
        .map(m => m.id);
}

// ---------------------------------------------------------------------------
// Cache — disk persistence
// ---------------------------------------------------------------------------

function readCache() {
    try {
        // Single syscall; ENOENT is caught below alongside parse errors.
        const raw = fs.readFileSync(CACHE_FILE, 'utf8');
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

/**
 * Persists the model list atomically: writes to a temp file then renames.
 * This prevents a corrupt cache if the process is killed mid-write.
 */
function writeCache(models) {
    const payload = JSON.stringify({ fetchedAt: Date.now(), models }, null, 2);
    const tmp = `${CACHE_FILE}.tmp`;
    try {
        fs.writeFileSync(tmp, payload, 'utf8');
        fs.renameSync(tmp, CACHE_FILE);
    } catch (err) {
        // Non-fatal — the in-memory list remains valid for this session.
        console.error('[ModelManager] Failed to write model cache:', err.message);
    }
}

/**
 * Returns true when the cache is structurally valid, has not expired, and
 * contains only non-empty strings — preventing a tampered or truncated file
 * from injecting bad values into inference calls.
 */
function isCacheValid(cache) {
    if (!cache) return false;
    if (typeof cache.fetchedAt !== 'number') return false;
    if (!Array.isArray(cache.models) || cache.models.length === 0) return false;
    if (!cache.models.every(m => typeof m === 'string' && m.length > 0)) return false;
    return Date.now() - cache.fetchedAt < CACHE_TTL_MS;
}

// ---------------------------------------------------------------------------
// In-memory cache — avoids repeated disk reads on each inference call
// ---------------------------------------------------------------------------

/** @type {string[] | null} */
let _memoryCache = null;

// ---------------------------------------------------------------------------
// Refresh lock — prevents concurrent fetches when multiple callers race on a
// stale cache. All concurrent callers share the same in-flight Promise.
// ---------------------------------------------------------------------------

/** @type {Promise<string[]> | null} */
let _refreshInFlight = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Forces a fresh fetch from OpenRouter, ranks results, persists to disk,
 * updates the in-memory cache, and returns the ordered model ID list.
 *
 * Concurrent calls are coalesced — only one network fetch runs at a time.
 *
 * @returns {Promise<string[]>}
 */
async function refreshModels() {
    if (_refreshInFlight) return _refreshInFlight;

    _refreshInFlight = (async () => {
        console.log('[ModelManager] Fetching free models from OpenRouter…');

        const [roleplayRaw, allRaw] = await Promise.all([
            fetchModels(ROLEPLAY_CATEGORY).catch(err => {
                console.warn(
                    '[ModelManager] Roleplay-category fetch failed, continuing without it:',
                    err.message,
                );
                return [];
            }),
            // If the broad fetch fails there is nothing to rank — propagate.
            fetchModels(),
        ]);

        const rpIds = new Set(roleplayRaw.map(m => m.id));
        // Roleplay results lead the merged array so deduplication in rankModels
        // always retains the roleplay copy when IDs overlap.
        const merged = [...roleplayRaw, ...allRaw];
        const ranked = rankModels(merged, rpIds);

        if (ranked.length === 0) {
            throw new Error('[ModelManager] No suitable free text-only models found.');
        }

        writeCache(ranked);
        _memoryCache = ranked;
        console.log('[ModelManager] Model list refreshed:', ranked);
        return ranked;
    })().finally(() => {
        _refreshInFlight = null;
    });

    return _refreshInFlight;
}

/**
 * Returns the ordered list of free model IDs, consulting (in order):
 *   1. In-memory cache  — no I/O
 *   2. Disk cache       — single file read, fully validated
 *   3. OpenRouter API   — network fetch, updates both caches
 *
 * @returns {Promise<string[]>}
 */
async function getFreeModels() {
    if (_memoryCache) return _memoryCache;

    const disk = readCache();
    if (isCacheValid(disk)) {
        _memoryCache = disk.models;
        return disk.models;
    }

    return refreshModels();
}

/**
 * Clears the in-memory cache, forcing the next getFreeModels() call to
 * re-validate against disk or refetch from the network.
 * Primarily useful in tests.
 */
function clearMemoryCache() {
    _memoryCache = null;
}

module.exports = { getFreeModels, refreshModels, clearMemoryCache };
