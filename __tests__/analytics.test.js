'use strict';

/**
 * __tests__/analytics.test.js
 *
 * Unit tests for analytics.js.
 * All file I/O is mocked — no disk access occurs.
 */

const fsp = require('node:fs').promises;
const crypto = require('node:crypto');

// Mock fs.promises before requiring the module under test.
jest.mock('node:fs', () => {
    const actual = jest.requireActual('node:fs');
    return {
        ...actual,
        promises: {
            readFile: jest.fn(),
            writeFile: jest.fn().mockResolvedValue(undefined),
            rename: jest.fn().mockResolvedValue(undefined),
        },
    };
});

const analytics = require('../analytics');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hashGuildId(id) {
    return crypto.createHash('sha256').update(String(id)).digest('hex').slice(0, 12);
}

beforeEach(async () => {
    // Reset internal state AND clear mock call history between tests.
    analytics._resetForTesting();
    fsp.readFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    fsp.writeFile.mockResolvedValue(undefined);
    jest.useFakeTimers();
});

afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// recordCommand
// ---------------------------------------------------------------------------

describe('recordCommand', () => {
    test('increments count for a new command', async () => {
        await analytics.recordCommand('ping');
        const stats = await analytics.getStats();
        expect(stats.commandCounts['ping']).toBe(1);
    });

    test('accumulates multiple calls for the same command', async () => {
        await analytics.recordCommand('ping');
        await analytics.recordCommand('ping');
        await analytics.recordCommand('ping');
        const stats = await analytics.getStats();
        expect(stats.commandCounts['ping']).toBe(3);
    });

    test('tracks different commands independently', async () => {
        await analytics.recordCommand('ping');
        await analytics.recordCommand('quote');
        await analytics.recordCommand('library');
        const stats = await analytics.getStats();
        expect(stats.commandCounts['ping']).toBe(1);
        expect(stats.commandCounts['quote']).toBe(1);
        expect(stats.commandCounts['library']).toBe(1);
    });

    test('schedules a debounced disk write', async () => {
        await analytics.recordCommand('ping');
        expect(fsp.writeFile).not.toHaveBeenCalled(); // not yet — debounced
        expect(fsp.rename).not.toHaveBeenCalled();
        jest.runAllTimers();
        // Allow the async write callback to settle.
        await Promise.resolve();
        await Promise.resolve();
        expect(fsp.writeFile).toHaveBeenCalledTimes(1);
        expect(fsp.rename).toHaveBeenCalledTimes(1);
    });
});

// ---------------------------------------------------------------------------
// recordChat
// ---------------------------------------------------------------------------

describe('recordChat', () => {
    test('increments total chat count', async () => {
        await analytics.recordChat('guild123');
        const stats = await analytics.getStats();
        expect(stats.chatTotal).toBe(1);
    });

    test('increments per-guild hash bucket', async () => {
        await analytics.recordChat('guild123');
        const stats = await analytics.getStats();
        const hash = hashGuildId('guild123');
        expect(stats.chatByGuild[hash]).toBe(1);
    });

    test('does NOT store the raw guild Snowflake', async () => {
        await analytics.recordChat('668868202721312798');
        const stats = await analytics.getStats();
        expect(Object.keys(stats.chatByGuild)).not.toContain('668868202721312798');
    });

    test('accumulates chats from different guilds', async () => {
        await analytics.recordChat('guild-A');
        await analytics.recordChat('guild-B');
        await analytics.recordChat('guild-A');
        const stats = await analytics.getStats();
        expect(stats.chatTotal).toBe(3);
        expect(Object.keys(stats.chatByGuild)).toHaveLength(2);
    });

    test('handles null guildId (DM) without throwing', async () => {
        await expect(analytics.recordChat(null)).resolves.not.toThrow();
        const stats = await analytics.getStats();
        expect(stats.chatByGuild['__dm__']).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// recordLlmCall
// ---------------------------------------------------------------------------

describe('recordLlmCall', () => {
    test('increments llmSuccess on true', async () => {
        await analytics.recordLlmCall(true);
        const stats = await analytics.getStats();
        expect(stats.llmSuccess).toBe(1);
        expect(stats.llmFailure).toBe(0);
    });

    test('increments llmFailure on false', async () => {
        await analytics.recordLlmCall(false);
        const stats = await analytics.getStats();
        expect(stats.llmSuccess).toBe(0);
        expect(stats.llmFailure).toBe(1);
    });

    test('accumulates mixed results correctly', async () => {
        await analytics.recordLlmCall(true, 'model-a');
        await analytics.recordLlmCall(true, 'model-a');
        await analytics.recordLlmCall(false, 'model-b');
        const stats = await analytics.getStats();
        expect(stats.llmSuccess).toBe(2);
        expect(stats.llmFailure).toBe(1);
        expect(stats.modelCounts['model-a']).toBe(2);
        expect(stats.modelCounts['model-b']).toBe(1);
    });

    test('ignores null or non-string model names', async () => {
        await analytics.recordLlmCall(true, null);
        await analytics.recordLlmCall(true, 123);
        await analytics.recordLlmCall(true);
        const stats = await analytics.getStats();
        expect(stats.llmSuccess).toBe(3);
        expect(Object.keys(stats.modelCounts)).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// recordUptimeTick
// ---------------------------------------------------------------------------

describe('recordUptimeTick', () => {
    test('increments uptimeTicks by 1 per call', async () => {
        await analytics.recordUptimeTick();
        await analytics.recordUptimeTick();
        const stats = await analytics.getStats();
        expect(stats.uptimeTicks).toBe(2);
    });
});

// ---------------------------------------------------------------------------
// getSnapshotAndReset
// ---------------------------------------------------------------------------

describe('getSnapshotAndReset', () => {
    test('returns a snapshot with correct values', async () => {
        await analytics.recordCommand('ping');
        await analytics.recordChat('guildX');
        await analytics.recordLlmCall(true, 'model-1');
        await analytics.recordUptimeTick();

        const snapshot = await analytics.getSnapshotAndReset(5);

        expect(snapshot.commandCounts['ping']).toBe(1);
        expect(snapshot.chatTotal).toBe(1);
        expect(snapshot.llmSuccess).toBe(1);
        expect(snapshot.modelCounts['model-1']).toBe(1);
        expect(snapshot.uptimeTicks).toBe(1);
        expect(snapshot.currentServerCount).toBe(5);
    });

    test('resets all counters to zero after snapshot', async () => {
        await analytics.recordCommand('ping');
        await analytics.recordChat('guildX');
        await analytics.recordLlmCall(false);

        await analytics.getSnapshotAndReset(3);
        const stats = await analytics.getStats();

        expect(stats.commandCounts).toEqual({});
        expect(stats.chatByGuild).toEqual({});
        expect(stats.chatTotal).toBe(0);
        expect(stats.llmSuccess).toBe(0);
        expect(stats.llmFailure).toBe(0);
        expect(stats.uptimeTicks).toBe(0);
    });

    test('carries currentServerCount as previousServerCount into next window', async () => {
        await analytics.getSnapshotAndReset(7);
        const stats = await analytics.getStats();
        expect(stats.previousServerCount).toBe(7);
    });

    test('persists immediately (not debounced) after a reset', async () => {
        await analytics.getSnapshotAndReset(2);
        expect(fsp.writeFile).toHaveBeenCalled();
        expect(fsp.rename).toHaveBeenCalled();
    });

    test('snapshot previousServerCount reflects prior week value', async () => {
        // First week ends with 4 servers.
        await analytics.getSnapshotAndReset(4);
        // Second week — check snapshot records 4 as previousServerCount.
        const snapshot2 = await analytics.getSnapshotAndReset(6);
        expect(snapshot2.previousServerCount).toBe(4);
    });

    test('handles null currentServerCount gracefully', async () => {
        const snapshot = await analytics.getSnapshotAndReset(null);
        expect(snapshot.currentServerCount).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// Persistence — load from disk
// ---------------------------------------------------------------------------

describe('Persistence: loading from disk', () => {
    test('merges saved data into state on first access', async () => {
        // Simulate a persisted file from a previous run.
        const saved = {
            commandCounts: { daily: 3 },
            chatByGuild: { abc123def456: 5 },
            chatTotal: 5,
            llmSuccess: 10,
            llmFailure: 2,
            uptimeTicks: 500,
            windowStart: '2026-02-21T00:00:00.000Z',
            previousServerCount: 2,
        };
        fsp.readFile.mockResolvedValue(JSON.stringify(saved));

        const stats = await analytics.getStats();
        expect(stats.commandCounts['daily']).toBe(3);
        expect(stats.chatTotal).toBe(5);
        expect(stats.llmSuccess).toBe(10);
        expect(stats.previousServerCount).toBe(2);
    });

    test('falls back to fresh state if file is missing', async () => {
        fsp.readFile.mockRejectedValue(new Error('ENOENT'));
        const stats = await analytics.getStats();
        expect(stats.chatTotal).toBe(0);
        expect(stats.commandCounts).toEqual({});
    });

    test('falls back to fresh state if file content is corrupt JSON', async () => {
        fsp.readFile.mockResolvedValue('{ bad json }}}');
        const stats = await analytics.getStats();
        expect(stats.chatTotal).toBe(0);
    });
});
