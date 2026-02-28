'use strict';

/**
 * llm.test.js
 *
 * resetModules in beforeEach gives each test a clean module instance.
 * All mocks are re-required inside beforeEach (after the reset) so
 * mock.mockResolvedValue() calls actually affect the module under test.
 */

jest.mock('axios');
jest.mock('node-cron', () => ({ schedule: jest.fn() }));
jest.mock('../modelManager');

let axios;
let cron;
let modelManager;

const FREE_MODELS = ['vendor/roleplay-model', 'vendor/general-model'];
const FALLBACK_MODEL = 'mistralai/mistral-7b-instruct:free';

const chatOk = (text) => ({
    data: { choices: [{ message: { content: text } }] },
});

const apiErr = (message, status = 429) => {
    const err = new Error(message);
    err.response = { status, data: { error: { message } } };
    return err;
};

function mockClient(postFn) {
    const instance = { post: postFn };
    axios.create.mockReturnValue(instance);
    return instance;
}

function load() { return require('../llm'); }

beforeEach(() => {
    jest.resetModules();
    axios = require('axios');
    cron = require('node-cron');
    modelManager = require('../modelManager');
    process.env.OPENROUTER_API_KEY = 'test-key';
    process.env.OPENROUTER_FALLBACK_MODEL = FALLBACK_MODEL;
    modelManager.getFreeModels.mockResolvedValue([...FREE_MODELS]);
});

describe('daily refresh cron', () => {
    test('registers a midnight UTC cron job when the module is loaded', () => {
        load();
        expect(cron.schedule).toHaveBeenCalledWith(
            '0 0 * * *',
            expect.any(Function),
            { timezone: 'UTC' },
        );
    });
});

describe('security — missing API key', () => {
    test('throws clearly instead of sending "Bearer undefined"', async () => {
        delete process.env.OPENROUTER_API_KEY;
        axios.create.mockImplementation(() => {
            throw new Error('OPENROUTER_API_KEY is not set in the environment.');
        });
        const { chat } = load();
        await expect(chat([{ role: 'user', content: 'hi' }]))
            .rejects.toThrow('OPENROUTER_API_KEY is not set');
    });
});

describe('callModel — request body', () => {
    test('uses default max_tokens (1024) and temperature (0.8) when opts not supplied', async () => {
        const post = jest.fn().mockResolvedValue(chatOk('hello'));
        mockClient(post);
        await load().chat([{ role: 'user', content: 'hi' }]);
        const body = post.mock.calls[0][1];
        expect(body.max_tokens).toBe(1024);
        expect(body.temperature).toBe(0.8);
    });

    test('opts.max_tokens and opts.temperature override defaults', async () => {
        const post = jest.fn().mockResolvedValue(chatOk('hello'));
        mockClient(post);
        await load().chat([{ role: 'user', content: 'hi' }], { max_tokens: 256, temperature: 0.3 });
        const body = post.mock.calls[0][1];
        expect(body.max_tokens).toBe(256);
        expect(body.temperature).toBe(0.3);
    });

    test('unknown opts keys are NOT forwarded to the request body', async () => {
        const post = jest.fn().mockResolvedValue(chatOk('hello'));
        mockClient(post);
        await load().chat([{ role: 'user', content: 'hi' }], { stream: true, unsupported: 'x' });
        const body = post.mock.calls[0][1];
        expect(body.stream).toBeUndefined();
        expect(body.unsupported).toBeUndefined();
    });

    test('messages array is forwarded to the API unchanged', async () => {
        const messages = [
            { role: 'system', content: 'Be Chester.' },
            { role: 'user', content: 'Hello.' },
        ];
        const post = jest.fn().mockResolvedValue(chatOk('Indeed.'));
        mockClient(post);
        await load().chat(messages);
        expect(post.mock.calls[0][1].messages).toEqual(messages);
    });
});

describe('callModel — response validation', () => {
    test('empty choices array causes waterfall to exhaust and throw', async () => {
        const post = jest.fn().mockResolvedValue({ data: { choices: [] } });
        mockClient(post);
        await expect(load().chat([{ role: 'user', content: 'hi' }]))
            .rejects.toThrow('All models exhausted');
    });

    test('whitespace-only content causes waterfall to exhaust and throw', async () => {
        const post = jest.fn().mockResolvedValue({
            data: { choices: [{ message: { content: '   ' } }] },
        });
        mockClient(post);
        await expect(load().chat([{ role: 'user', content: 'hi' }]))
            .rejects.toThrow('All models exhausted');
    });
});

describe('chat() — waterfall fallback', () => {
    test('returns text and model name from the first successful call', async () => {
        const post = jest.fn().mockResolvedValue(chatOk('Great reply.'));
        mockClient(post);
        const result = await load().chat([{ role: 'user', content: 'hi' }]);
        expect(result.text).toBe('Great reply.');
        expect(result.model).toBe(FREE_MODELS[0]);
        expect(post).toHaveBeenCalledTimes(1);
    });

    test('falls back to second free model when first fails', async () => {
        const post = jest.fn()
            .mockRejectedValueOnce(apiErr('rate limited'))
            .mockResolvedValueOnce(chatOk('Second reply.'));
        mockClient(post);
        const result = await load().chat([{ role: 'user', content: 'hi' }]);
        expect(result.text).toBe('Second reply.');
        expect(result.model).toBe(FREE_MODELS[1]);
        expect(post).toHaveBeenCalledTimes(2);
    });

    test('falls back to FALLBACK_MODEL when all free models fail', async () => {
        const post = jest.fn()
            .mockRejectedValueOnce(apiErr('offline'))
            .mockRejectedValueOnce(apiErr('offline'))
            .mockResolvedValueOnce(chatOk('Fallback.'));
        mockClient(post);
        const result = await load().chat([{ role: 'user', content: 'hi' }]);
        expect(result.model).toBe(FALLBACK_MODEL);
        expect(post).toHaveBeenCalledTimes(3);
    });

    test('throws when every model including the hard fallback fails', async () => {
        const post = jest.fn().mockRejectedValue(apiErr('total outage'));
        mockClient(post);
        await expect(load().chat([{ role: 'user', content: 'hi' }]))
            .rejects.toThrow('All models exhausted');
    });

    test('fallback model is not called twice when already in the free list', async () => {
        modelManager.getFreeModels.mockResolvedValue([FREE_MODELS[0], FALLBACK_MODEL]);
        const post = jest.fn()
            .mockRejectedValueOnce(apiErr('offline'))
            .mockResolvedValueOnce(chatOk('ok'));
        mockClient(post);
        await load().chat([{ role: 'user', content: 'hi' }]);
        expect(post).toHaveBeenCalledTimes(2);
    });

    test('goes straight to FALLBACK_MODEL when getFreeModels throws', async () => {
        modelManager.getFreeModels.mockRejectedValue(new Error('cache and network down'));
        const post = jest.fn().mockResolvedValue(chatOk('Emergency reply.'));
        mockClient(post);
        const result = await load().chat([{ role: 'user', content: 'hi' }]);
        expect(result.model).toBe(FALLBACK_MODEL);
        expect(post).toHaveBeenCalledTimes(1);
    });
});

describe('ask()', () => {
    test('returns a plain string, not the {text, model} object', async () => {
        const post = jest.fn().mockResolvedValue(chatOk('Chester speaks.'));
        mockClient(post);
        const result = await load().ask('Hello.');
        expect(typeof result).toBe('string');
        expect(result).toBe('Chester speaks.');
    });

    test('prepends a system message when systemPrompt is provided', async () => {
        const post = jest.fn().mockResolvedValue(chatOk('Reply.'));
        mockClient(post);
        await load().ask('user message', 'You are Chesterton.');
        const { messages } = post.mock.calls[0][1];
        expect(messages[0]).toEqual({ role: 'system', content: 'You are Chesterton.' });
        expect(messages[1]).toEqual({ role: 'user', content: 'user message' });
    });

    test('omits system message when systemPrompt is null', async () => {
        const post = jest.fn().mockResolvedValue(chatOk('Reply.'));
        mockClient(post);
        await load().ask('user message', null);
        const { messages } = post.mock.calls[0][1];
        expect(messages).toHaveLength(1);
        expect(messages[0].role).toBe('user');
    });

    test('omits system message when systemPrompt is not passed', async () => {
        const post = jest.fn().mockResolvedValue(chatOk('Reply.'));
        mockClient(post);
        await load().ask('user message');
        expect(post.mock.calls[0][1].messages).toHaveLength(1);
    });

    test('forwards opts through to the underlying request body', async () => {
        const post = jest.fn().mockResolvedValue(chatOk('Reply.'));
        mockClient(post);
        await load().ask('question', null, { max_tokens: 512, temperature: 0.2 });
        const body = post.mock.calls[0][1];
        expect(body.max_tokens).toBe(512);
        expect(body.temperature).toBe(0.2);
    });
});
