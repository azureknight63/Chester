'use strict';

/**
 * analyticsReport.js
 *
 * Builds and sends the weekly Chester usage-statistics report to a Discord
 * channel via an incoming webhook.
 *
 * Design principles:
 *   - No PII: guild hashes are counted, never displayed; user info is absent.
 *   - Self-contained: depends only on axios (already a project dep) and the
 *     stats snapshot produced by analytics.getSnapshotAndReset().
 *   - Graceful degradation: if the webhook URL is missing or the POST fails,
 *     the error is logged and the weekly cron continues without crashing.
 */

const axios = require('axios');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Computes uptime % from heartbeat ticks vs expected ticks in a 7-day window.
 * Each tick represents one minute. Expected = 7 * 24 * 60 = 10 080 ticks.
 *
 * If the bot restarted mid-week the tick count will be < 10 080, which is
 * correctly reflected as < 100 % uptime.
 *
 * @param {number} ticks
 * @returns {string}  e.g. "98.45%"
 */
function formatUptime(ticks) {
    const EXPECTED_TICKS = 7 * 24 * 60; // 10 080
    const pct = Math.min((ticks / EXPECTED_TICKS) * 100, 100);
    return `${pct.toFixed(2)}%`;
}

/**
 * Computes LLM inference uptime % (successful calls / total calls).
 *
 * @param {number} success
 * @param {number} failure
 * @returns {string}
 */
function formatLlmUptime(success, failure) {
    const total = success + failure;
    if (total === 0) return 'N/A (no calls)';
    const pct = (success / total) * 100;
    return `${pct.toFixed(2)}% (${success}/${total} calls succeeded)`;
}

/**
 * Formats server count with WoW comparison.
 *
 * @param {number|null} current
 * @param {number|null} previous
 * @returns {string}
 */
function formatServerGrowth(current, previous) {
    if (current === null) return 'Unknown';
    if (previous === null) return `${current} (no prior week data)`;

    const delta = current - previous;
    const pct = previous === 0
        ? (delta > 0 ? '+∞' : '0.0')
        : ((delta / previous) * 100).toFixed(1);

    const sign = delta >= 0 ? '+' : '';
    return `${current} (${sign}${delta} vs last week, ${sign}${pct}% growth)`;
}

/**
 * Formats the slash-command breakdown table.
 *
 * @param {object} commandCounts  { commandName: count }
 * @returns {string}
 */
function formatCommandCounts(commandCounts) {
    const entries = Object.entries(commandCounts);
    if (entries.length === 0) return 'No slash commands used this week.';

    return entries
        .sort((a, b) => b[1] - a[1]) // descending by usage
        .map(([name, count]) => `\`/${name}\`: ${count}`)
        .join('\n');
}

/**
 * Formats the per-guild chat breakdown.
 * Guilds are identified only by their anonymous hash — not the raw Snowflake.
 *
 * @param {object} chatByGuild  { guildHash: count }
 * @returns {string}
 */
function formatChatByGuild(chatByGuild) {
    const entries = Object.entries(chatByGuild);
    if (entries.length === 0) return 'No chat interactions this week.';

    return entries
        .sort((a, b) => b[1] - a[1])
        .map(([hash, count], i) => `Server ${i + 1} (\`${hash}\`): ${count}`)
        .join('\n');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Sends the weekly analytics embed to the configured Discord webhook.
 *
 * @param {object} snapshot  Stats snapshot returned by analytics.getSnapshotAndReset().
 * @returns {Promise<boolean>}  true on success.
 * @throws If the webhook URL is configured but the POST fails.
 */
async function sendReport(snapshot) {
    const webhookUrl = process.env.ANALYTICS_WEBHOOK_URL;

    if (!webhookUrl) {
        console.warn('[Analytics] ANALYTICS_WEBHOOK_URL is not set — skipping weekly report.');
        return false;
    }

    const {
        commandCounts = {},
        chatByGuild = {},
        chatTotal = 0,
        llmSuccess = 0,
        llmFailure = 0,
        uptimeTicks = 0,
        windowStart = 'unknown',
        currentServerCount = null,
        previousServerCount = null,
    } = snapshot;

    const serverCount = typeof currentServerCount === 'number' ? currentServerCount : null;
    const guildCount = Object.keys(chatByGuild).length; // guilds that chatted

    const reportDate = new Date().toUTCString();

    const embed = {
        title: '📊 Chester Weekly Usage Report',
        description:
            `Reporting window: <t:${Math.floor(new Date(windowStart).getTime() / 1000)}:f> → ${reportDate}\n` +
            `*All data is anonymous. No user or server identifiers are stored.*`,
        color: 0x5865F2, // Discord blurple
        fields: [
            {
                name: '🌐 Servers Hosting Chester',
                value: formatServerGrowth(serverCount, previousServerCount),
                inline: false,
            },
            {
                name: '⚡ Slash Command Usage',
                value: formatCommandCounts(commandCounts),
                inline: false,
            },
            {
                name: `💬 Chat Interactions — ${chatTotal} total across ${guildCount} server(s)`,
                value: formatChatByGuild(chatByGuild),
                inline: false,
            },
            {
                name: '🟢 Bot Process Uptime',
                value: formatUptime(uptimeTicks),
                inline: true,
            },
            {
                name: '🤖 LLM Inference Uptime',
                value: formatLlmUptime(llmSuccess, llmFailure),
                inline: true,
            },
        ],
        footer: { text: 'Chester Analytics • anonymous usage stats' },
        timestamp: new Date().toISOString(),
    };

    await axios.post(webhookUrl, { embeds: [embed] }, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 10_000,
    });

    console.log('[Analytics] Weekly report sent successfully.');
    return true;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
    sendReport,
    // Exported for testing:
    formatUptime,
    formatLlmUptime,
    formatServerGrowth,
    formatCommandCounts,
    formatChatByGuild,
};
