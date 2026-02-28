'use strict';

/**
 * __tests__/analyticsReport.test.js
 *
 * Unit tests for analyticsReport.js.
 * axios is mocked — no network calls are made.
 */

jest.mock('axios');

const axios = require('axios');
const {
    sendReport,
    formatUptime,
    formatLlmUptime,
    formatServerGrowth,
    formatCommandCounts,
    formatChatByGuild,
} = require('../analyticsReport');

// ---------------------------------------------------------------------------
// Shared test snapshot
// ---------------------------------------------------------------------------

function makeSnapshot(overrides = {}) {
    return {
        commandCounts: { ping: 10, quote: 5, library: 2 },
        chatByGuild: { abc123def456: 8, fedcba987654: 3 },
        chatTotal: 11,
        llmSuccess: 95,
        llmFailure: 5,
        uptimeTicks: 9_500,
        windowStart: '2026-02-21T09:00:00.000Z',
        currentServerCount: 7,
        previousServerCount: 5,
        ...overrides,
    };
}

beforeEach(() => {
    delete process.env.ANALYTICS_WEBHOOK_URL;
    jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// formatUptime
// ---------------------------------------------------------------------------

describe('formatUptime', () => {
    test('returns 100% for full 10080 ticks', () => {
        expect(formatUptime(10_080)).toBe('100.00%');
    });

    test('caps at 100% even if ticks exceed expected', () => {
        expect(formatUptime(20_000)).toBe('100.00%');
    });

    test('returns ~94.25% for 9500 ticks', () => {
        const result = formatUptime(9_500);
        expect(result).toMatch(/^94\.\d+%$/);
    });

    test('returns 0% for zero ticks', () => {
        expect(formatUptime(0)).toBe('0.00%');
    });
});

// ---------------------------------------------------------------------------
// formatLlmUptime
// ---------------------------------------------------------------------------

describe('formatLlmUptime', () => {
    test('returns 95% for 95 success / 5 failure', () => {
        const result = formatLlmUptime(95, 5);
        expect(result).toContain('95.00%');
        expect(result).toContain('95/100');
    });

    test('returns N/A when no calls were made', () => {
        expect(formatLlmUptime(0, 0)).toBe('N/A (no calls)');
    });

    test('returns 100% for all successes', () => {
        expect(formatLlmUptime(50, 0)).toContain('100.00%');
    });

    test('returns 0% for all failures', () => {
        expect(formatLlmUptime(0, 10)).toContain('0.00%');
    });
});

// ---------------------------------------------------------------------------
// formatServerGrowth
// ---------------------------------------------------------------------------

describe('formatServerGrowth', () => {
    test('shows positive growth correctly', () => {
        const result = formatServerGrowth(7, 5);
        expect(result).toContain('7');
        expect(result).toContain('+2');
        expect(result).toContain('+40.0%');
    });

    test('shows zero growth correctly', () => {
        const result = formatServerGrowth(5, 5);
        expect(result).toContain('5');
        expect(result).toContain('+0');
        expect(result).toContain('+0.0%');
    });

    test('shows negative growth correctly', () => {
        const result = formatServerGrowth(3, 5);
        expect(result).toContain('3');
        expect(result).toContain('-2');
    });

    test('returns "Unknown" when current is null', () => {
        expect(formatServerGrowth(null, 5)).toBe('Unknown');
    });

    test('returns no-prior-data note when previous is null', () => {
        const result = formatServerGrowth(5, null);
        expect(result).toContain('5');
        expect(result).toContain('no prior week data');
    });

    test('handles zero-to-some growth with +∞', () => {
        const result = formatServerGrowth(3, 0);
        expect(result).toContain('+∞');
    });
});

// ---------------------------------------------------------------------------
// formatCommandCounts
// ---------------------------------------------------------------------------

describe('formatCommandCounts', () => {
    test('returns sorted list with /name: count format', () => {
        const result = formatCommandCounts({ ping: 10, quote: 5, library: 2 });
        expect(result).toContain('/ping');
        expect(result).toContain('10');
        // Highest count should appear first.
        const pingIndex = result.indexOf('/ping');
        const libraryIndex = result.indexOf('/library');
        expect(pingIndex).toBeLessThan(libraryIndex);
    });

    test('returns fallback message when no commands were used', () => {
        expect(formatCommandCounts({})).toBe('No slash commands used this week.');
    });
});

// ---------------------------------------------------------------------------
// formatChatByGuild
// ---------------------------------------------------------------------------

describe('formatChatByGuild', () => {
    test('displays anonymous "Server N (hash): count" format', () => {
        const result = formatChatByGuild({ abc123def456: 8, fedcba987654: 3 });
        expect(result).toContain('Server 1');
        expect(result).toContain('Server 2');
        expect(result).toContain('abc123def456');
        expect(result).toContain('8');
    });

    test('does NOT contain raw numeric guild snowflakes', () => {
        // Hashes should look like hex strings, not 18-digit snowflakes.
        const result = formatChatByGuild({ abc123def456: 1 });
        expect(result).not.toMatch(/\d{17,}/); // no 17+ digit numbers
    });

    test('returns fallback message when no chat interactions occurred', () => {
        expect(formatChatByGuild({})).toBe('No chat interactions this week.');
    });

    test('sorts by count descending', () => {
        const result = formatChatByGuild({ lowHash: 1, highHash: 99 });
        const indexLow = result.indexOf('lowHash');
        const indexHigh = result.indexOf('highHash');
        expect(indexHigh).toBeLessThan(indexLow);
    });
});

// ---------------------------------------------------------------------------
// sendReport
// ---------------------------------------------------------------------------

describe('sendReport', () => {
    test('returns false and warns when webhook URL is not set', async () => {
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => { });
        const result = await sendReport(makeSnapshot());
        expect(result).toBe(false);
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('ANALYTICS_WEBHOOK_URL'));
        expect(axios.post).not.toHaveBeenCalled();
        warnSpy.mockRestore();
    });

    test('POSTs to the webhook URL when configured', async () => {
        process.env.ANALYTICS_WEBHOOK_URL = 'https://discord.com/api/webhooks/test/token';
        axios.post.mockResolvedValue({ status: 204 });

        const result = await sendReport(makeSnapshot());

        expect(result).toBe(true);
        expect(axios.post).toHaveBeenCalledTimes(1);
        expect(axios.post.mock.calls[0][0]).toBe('https://discord.com/api/webhooks/test/token');
    });

    test('payload contains an embeds array with one embed', async () => {
        process.env.ANALYTICS_WEBHOOK_URL = 'https://discord.com/api/webhooks/test/token';
        axios.post.mockResolvedValue({ status: 204 });

        await sendReport(makeSnapshot());

        const payload = axios.post.mock.calls[0][1];
        expect(payload).toHaveProperty('embeds');
        expect(Array.isArray(payload.embeds)).toBe(true);
        expect(payload.embeds).toHaveLength(1);
    });

    test('embed contains all required fields', async () => {
        process.env.ANALYTICS_WEBHOOK_URL = 'https://discord.com/api/webhooks/test/token';
        axios.post.mockResolvedValue({ status: 204 });

        await sendReport(makeSnapshot());

        const embed = axios.post.mock.calls[0][1].embeds[0];
        const fieldNames = embed.fields.map(f => f.name);

        expect(fieldNames.some(n => n.includes('Server'))).toBe(true);
        expect(fieldNames.some(n => n.includes('Slash Command'))).toBe(true);
        expect(fieldNames.some(n => n.includes('Chat'))).toBe(true);
        expect(fieldNames.some(n => n.includes('Uptime'))).toBe(true);
        expect(fieldNames.some(n => n.includes('LLM'))).toBe(true);
    });

    test('embed contains no raw guild Snowflakes (no 17+ digit numbers)', async () => {
        process.env.ANALYTICS_WEBHOOK_URL = 'https://discord.com/api/webhooks/test/token';
        axios.post.mockResolvedValue({ status: 204 });

        await sendReport(makeSnapshot());

        const payload = JSON.stringify(axios.post.mock.calls[0][1]);
        expect(payload).not.toMatch(/\b\d{17,}\b/);
    });

    test('throws when axios.post rejects', async () => {
        process.env.ANALYTICS_WEBHOOK_URL = 'https://discord.com/api/webhooks/test/token';
        axios.post.mockRejectedValue(new Error('Network error'));

        await expect(sendReport(makeSnapshot())).rejects.toThrow('Network error');
    });

    test('handles snapshot with zero activity gracefully', async () => {
        process.env.ANALYTICS_WEBHOOK_URL = 'https://discord.com/api/webhooks/test/token';
        axios.post.mockResolvedValue({ status: 204 });

        const emptySnapshot = makeSnapshot({
            commandCounts: {},
            chatByGuild: {},
            chatTotal: 0,
            llmSuccess: 0,
            llmFailure: 0,
            uptimeTicks: 0,
        });

        await expect(sendReport(emptySnapshot)).resolves.toBe(true);
    });
});
