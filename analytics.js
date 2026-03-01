'use strict';

/**
 * analytics.js
 *
 * Anonymous, privacy-safe usage statistics store for Chester.
 *
 * Design principles:
 *   - No PII: guild IDs are stored only as an opaque truncated hash;
 *     usernames and user IDs are never touched.
 *   - In-memory + persistent: counters live in memory and are debounced-written
 *     to ANALYTICS_FILE so a graceful restart preserves the week's data.
 *   - Weekly reset: getSnapshotAndReset() returns the current window's stats,
 *     clears counters, and records previousServerCount for WoW comparison.
 *   - Uptime tracking is process-local (resets on crash/restart); the report
 *     notes the measurement window start time.
 */

const fsp = require('node:fs').promises;
const path = require('node:path');
const crypto = require('node:crypto');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const ANALYTICS_FILE = path.join(__dirname, 'analytics_data.json');
const DEBOUNCE_MS = 2_000; // max wait before flushing to disk

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

/** @returns {object} A fresh, zeroed-out stats structure. */
function makeEmptyStats() {
    return {
        // Slash commands: { commandName: count }
        commandCounts: {},
        // Chat interactions: { guildHash: count }
        chatByGuild: {},
        // Total chat interactions across all guilds
        chatTotal: 0,
        // LLM inference outcomes
        llmSuccess: 0,
        llmFailure: 0,
        // LLM model usage: { modelId: count }
        modelCounts: {},
        // Uptime heartbeat ticks (each tick = 1 minute)
        uptimeTicks: 0,
        // Timestamp (ISO) when this window started
        windowStart: new Date().toISOString(),
        // Server count from the prior week (for WoW comparison)
        previousServerCount: null,
    };
}

let _stats = makeEmptyStats();
let _persistTimer = null;
let _initialized = false;

// ---------------------------------------------------------------------------
// Hashing (privacy)
// ---------------------------------------------------------------------------

/**
 * Returns a 12-character hex digest of the input string.
 * Used to anonymise guild IDs before storing them.
 * One-way and unlinkable to the original Snowflake.
 *
 * @param {string} value
 * @returns {string}
 */
function anonymizeId(value) {
    return crypto
        .createHash('sha256')
        .update(String(value))
        .digest('hex')
        .slice(0, 12);
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/**
 * Debounced persist — schedules a disk write DEBOUNCE_MS after the last call.
 * Multiple rapid mutations collapse into a single write.
 */
function schedulePersist() {
    if (_persistTimer) clearTimeout(_persistTimer);
    _persistTimer = setTimeout(async () => {
        _persistTimer = null;
        await _persistNow();
    }, DEBOUNCE_MS);
}

/** Immediately writes the current stats to disk atomically. */
async function _persistNow() {
    try {
        const tmpPath = ANALYTICS_FILE + '.tmp';
        await fsp.writeFile(tmpPath, JSON.stringify(_stats, null, 2), 'utf8');
        await fsp.rename(tmpPath, ANALYTICS_FILE);
    } catch (err) {
        console.error('[Analytics] Failed to persist stats:', err.message);
    }
}

/**
 * Loads stats from disk. Falls back to a fresh object if the file is missing
 * or corrupt. Called once at startup.
 */
async function _load() {
    try {
        const raw = await fsp.readFile(ANALYTICS_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        // Merge with defaults so new fields added in future versions are present.
        _stats = Object.assign(makeEmptyStats(), parsed);
    } catch {
        // File missing or corrupt — start fresh.
        _stats = makeEmptyStats();
    }
    _initialized = true;
}

// ---------------------------------------------------------------------------
// Lazy initialisation guard
// ---------------------------------------------------------------------------

let _initPromise = null;

/**
 * Ensures the store is loaded from disk before the first mutation.
 * Subsequent calls resolve immediately.
 */
async function ensureInitialized() {
    if (_initialized) return;
    if (!_initPromise) _initPromise = _load();
    await _initPromise;
}

// ---------------------------------------------------------------------------
// Public API — recording
// ---------------------------------------------------------------------------

/**
 * Records one slash command invocation.
 * @param {string} commandName
 */
async function recordCommand(commandName) {
    await ensureInitialized();
    const key = String(commandName);
    _stats.commandCounts[key] = (_stats.commandCounts[key] ?? 0) + 1;
    schedulePersist();
}

/**
 * Records one chat interaction on a guild.
 * The guild ID is anonymised before storage.
 * @param {string|null} guildId  Discord guild Snowflake (or null for DMs).
 */
async function recordChat(guildId) {
    await ensureInitialized();
    const key = guildId ? anonymizeId(guildId) : '__dm__';
    _stats.chatByGuild[key] = (_stats.chatByGuild[key] ?? 0) + 1;
    _stats.chatTotal += 1;
    schedulePersist();
}

/**
 * Records the outcome of one LLM inference call.
 * @param {boolean} success
 * @param {string|null} [modelName]  The model ID returned by llm.chat(), if known.
 */
async function recordLlmCall(success, modelName = null) {
    await ensureInitialized();
    if (success) {
        _stats.llmSuccess += 1;
    } else {
        _stats.llmFailure += 1;
    }
    if (modelName && typeof modelName === 'string') {
        _stats.modelCounts[modelName] = (_stats.modelCounts[modelName] ?? 0) + 1;
    }
    schedulePersist();
}

/**
 * Records one uptime heartbeat tick (expected: called every minute by a cron).
 */
async function recordUptimeTick() {
    await ensureInitialized();
    _stats.uptimeTicks += 1;
    schedulePersist();
}

// ---------------------------------------------------------------------------
// Public API — snapshot / reset
// ---------------------------------------------------------------------------

/**
 * Returns the current live stats object (shallow copy). For tests / health checks.
 * @returns {object}
 */
async function getStats() {
    await ensureInitialized();
    return { ..._stats };
}

/**
 * Snapshots the current week's stats, resets counters, and persists the
 * cleared state. Call this at report time (weekly cron).
 *
 * @param {number} currentServerCount  Live guild count from discord client.
 * @returns {object}  The snapshot (pre-reset) for report generation.
 */
async function getSnapshotAndReset(currentServerCount) {
    await ensureInitialized();

    const snapshot = {
        ..._stats,
        currentServerCount: typeof currentServerCount === 'number' ? currentServerCount : null,
    };

    // Reset for the next window, carrying forward previousServerCount.
    _stats = makeEmptyStats();
    _stats.previousServerCount = typeof currentServerCount === 'number' ? currentServerCount : null;

    // Flush immediately — don't wait for the debounce.
    if (_persistTimer) {
        clearTimeout(_persistTimer);
        _persistTimer = null;
    }
    await _persistNow();

    return snapshot;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
    recordCommand,
    recordChat,
    recordLlmCall,
    recordUptimeTick,
    getStats,
    getSnapshotAndReset,
    // Exported for testing only:
    _resetForTesting: () => {
        _stats = makeEmptyStats();
        _initialized = false;
        _initPromise = null;
        if (_persistTimer) { clearTimeout(_persistTimer); _persistTimer = null; }
    },
};
