/**
 * llm.js
 *
 * LLM inference helper for Chester.
 *
 * Model selection strategy:
 *   1. Load the cached free-model list (refreshed daily by modelManager).
 *   2. Attempt inference with each model in order (best-fit first).
 *   3. If every model in the list fails, fall back to FALLBACK_MODEL.
 *   4. Throw only if the fallback also fails.
 *
 * The daily refresh cron is registered here so this module is the single
 * entry point for all LLM concerns.
 */

'use strict';

const axios = require('axios');
const cron = require('node-cron');
const { getFreeModels, refreshModels } = require('./modelManager');

// ---------------------------------------------------------------------------
// Config defaults — read lazily at call time so dotenv has already run.
// See createClient() comment for the full rationale.
// ---------------------------------------------------------------------------

const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';

// ---------------------------------------------------------------------------
// HTTP client factory
// ---------------------------------------------------------------------------

/**
 * Builds an axios instance with a freshly-read API key and timeout.
 * Called per-request (rather than once at module load) so that:
 *   - dotenv is guaranteed to have run before any env vars are read;
 *   - a missing key produces a clear error immediately rather than sending
 *     "Bearer undefined" silently;
 *   - env-var overrides (timeout, fallback model) take effect without restart.
 *
 * The instance is lightweight (no connection pooling state) so per-request
 * creation has negligible overhead.
 */
function createClient() {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error('OPENROUTER_API_KEY is not set in the environment.');

  const timeout = parseInt(process.env.LLM_TIMEOUT_MS ?? '30000', 10);

  return axios.create({
    timeout,
    headers: {
      Authorization: `Bearer ${key}`,
      'HTTP-Referer': 'https://github.com/azureknight63/Chester',
      'X-Title': 'Chester',
      'Content-Type': 'application/json',
    },
  });
}

// ---------------------------------------------------------------------------
// Daily model refresh (midnight UTC)
// ---------------------------------------------------------------------------

cron.schedule('0 0 * * *', async () => {
  try {
    await refreshModels();
  } catch (err) {
    console.error('[LLM] Daily model refresh failed:', err.message);
  }
}, { timezone: 'UTC' });

// ---------------------------------------------------------------------------
// Core inference
// ---------------------------------------------------------------------------

/**
 * Sends a single chat completion request to one model.
 *
 * @param {string}   model       OpenRouter model ID.
 * @param {object[]} messages    OpenAI-style messages array.
 * @param {object}   [opts]      Optional parameter overrides.
 * @param {number}   [opts.max_tokens]
 * @param {number}   [opts.temperature]
 * @returns {Promise<string>}    The assistant's reply text.
 * @throws On HTTP errors, rate-limits, or empty/missing content.
 */
async function callModel(model, messages, opts = {}) {
  // Read defaults lazily so dotenv has run and env-var overrides are live.
  // Destructure known opts explicitly so the request body is predictable;
  // unknown keys are intentionally ignored to avoid sending unsupported
  // parameters that could cause API errors on some models.
  const {
    max_tokens = parseInt(process.env.LLM_MAX_TOKENS ?? '1024', 10),
    temperature = parseFloat(process.env.LLM_TEMPERATURE ?? '0.8'),
  } = opts;

  const client = createClient();
  const response = await client.post(OPENROUTER_CHAT_URL, {
    model,
    messages,
    max_tokens,
    temperature,
  });

  const choice = response.data?.choices?.[0];
  if (!choice) throw new Error(`No choices returned by model "${model}".`);

  const text = choice.message?.content?.trim();
  if (!text) throw new Error(`Empty content returned by model "${model}".`);

  return text;
}

/**
 * Runs inference with automatic waterfall fallback across the free model list.
 *
 * @param {object[]} messages  OpenAI-style messages array.
 * @param {object}   [opts]    Optional parameter overrides (see callModel).
 * @returns {Promise<{ text: string, model: string }>}
 * @throws If every model in the waterfall (including the hard fallback) fails.
 */
async function chat(messages, opts = {}) {
  // Read lazily — OPENROUTER_FALLBACK_MODEL may be set in .env.
  const fallbackModel = process.env.OPENROUTER_FALLBACK_MODEL
    ?? 'mistralai/mistral-7b-instruct:free';

  let freeModels;
  try {
    freeModels = await getFreeModels();
  } catch (err) {
    console.warn('[LLM] Could not load model list, going straight to fallback:', err.message);
    freeModels = [];
  }

  // Build the full waterfall: free list + hard fallback at the end.
  // Use a Set to deduplicate in case the fallback is already in the free list.
  const waterfall = [...new Set([...freeModels, fallbackModel])];
  const errors = [];

  for (const model of waterfall) {
    try {
      const text = await callModel(model, messages, opts);

      if (model !== freeModels[0]) {
        console.warn(`[LLM] Fell back to model: "${model}".`);
      }

      return { text, model };
    } catch (err) {
      const reason = err.response?.data?.error?.message ?? err.message;
      console.warn(`[LLM] Model "${model}" failed: ${reason}`);
      errors.push(`  ${model}: ${reason}`);
    }
  }

  throw new Error(`[LLM] All models exhausted.\n${errors.join('\n')}`);
}

// ---------------------------------------------------------------------------
// Convenience wrapper
// ---------------------------------------------------------------------------

/**
 * Sends a single user message with an optional system prompt.
 * Returns the assistant's reply text directly.
 *
 * Renamed from `prompt` (which shadows a JS built-in) to `ask`.
 *
 * @param {string} userMessage
 * @param {string} [systemPrompt]
 * @param {object} [opts]
 * @returns {Promise<string>}
 */
async function ask(userMessage, systemPrompt = null, opts = {}) {
  const messages = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  messages.push({ role: 'user', content: userMessage });

  const { text } = await chat(messages, opts);
  return text;
}

module.exports = { chat, ask, refreshModels };
