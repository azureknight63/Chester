'use strict';

/**
 * modelManager.test.js
 *
 * jest.resetModules() in beforeEach gives each test a clean module instance
 * (resetting the in-memory cache and the in-flight refresh lock). Because
 * resetModules invalidates top-level require() references, all mocks are
 * required inside beforeEach / each test, after the reset has run.
 */

jest.mock('axios');
jest.mock('fs');

let axios;
let fs;

function makeModel(overrides = {}) {
    return {
        id: 'vendor/model-a',
        created: 1_700_000_000,
        context_length: 8192,
        pricing: { prompt: '0', completion: '0', request: '0', image: '0' },
        architecture: { output_modalities: ['text'] },
        ...overrides,
    };
}

const MODEL_A = makeModel({ id: 'vendor/model-a', created: 1_700_000_002, context_length: 4_096 });
const MODEL_B = makeModel({ id: 'vendor/model-b', created: 1_700_000_001, context_length: 8_192 });
const MODEL_C = makeModel({ id: 'vendor/model-c', created: 1_700_000_000, context_length: 16_384 });
const PAID_MODEL = makeModel({ id: 'vendor/paid', pricing: { prompt: '0.001', completion: '0.002' } });
const IMG_MODEL = makeModel({ id: 'vendor/image', architecture: { output_modalities: ['image'] } });
const MIX_MODEL = makeModel({ id: 'vendor/mixed', architecture: { output_modalities: ['text', 'image'] } });

const envelope = (models) => ({ data: { data: models } });

beforeEach(() => {
    jest.resetModules();
    axios = require('axios');
    fs = require('fs');
    process.env.OPENROUTER_API_KEY = 'test-key';
    fs.readFileSync.mockImplementation(() => {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });
    fs.writeFileSync.mockImplementation(() => { });
    fs.renameSync.mockImplementation(() => { });
});

function load() { return require('../modelManager'); }

function mockFetches(roleplayModels, allModels) {
    axios.get
        .mockResolvedValueOnce(envelope(roleplayModels))
        .mockResolvedValueOnce(envelope(allModels));
}

describe('filtering — free models only', () => {
    test('paid model is excluded; throws when result list is empty', async () => {
        mockFetches([], [PAID_MODEL]);
        const { refreshModels } = load();
        await expect(refreshModels()).rejects.toThrow('No suitable free text-only models found.');
    });

    test('free model is included', async () => {
        mockFetches([], [MODEL_A]);
        const { refreshModels } = load();
        expect(await refreshModels()).toContain('vendor/model-a');
    });
});

describe('filtering — text-only output', () => {
    test('image-output model is excluded', async () => {
        mockFetches([], [IMG_MODEL]);
        await expect(load().refreshModels()).rejects.toThrow('No suitable free text-only models found.');
    });

    test('mixed text+image model is excluded', async () => {
        mockFetches([], [MIX_MODEL]);
        await expect(load().refreshModels()).rejects.toThrow('No suitable free text-only models found.');
    });

    test('text-only model is included', async () => {
        mockFetches([], [MODEL_A]);
        expect(await load().refreshModels()).toContain('vendor/model-a');
    });
});

describe('rankModels — sort order', () => {
    test('roleplay-tagged model sorts before a newer untagged model', async () => {
        const rp = makeModel({ id: 'vendor/rp', created: 1_000 });
        const plain = makeModel({ id: 'vendor/plain', created: 2_000 });
        axios.get
            .mockResolvedValueOnce(envelope([rp]))
            .mockResolvedValueOnce(envelope([rp, plain]));
        const result = await load().refreshModels();
        expect(result[0]).toBe('vendor/rp');
        expect(result[1]).toBe('vendor/plain');
    });

    test('among untagged models, newer created timestamp sorts first', async () => {
        mockFetches([], [MODEL_C, MODEL_A, MODEL_B]);
        expect(await load().refreshModels()).toEqual([
            'vendor/model-a', 'vendor/model-b', 'vendor/model-c',
        ]);
    });

    test('equal created: smaller context_length (faster) sorts first', async () => {
        const fast = makeModel({ id: 'vendor/fast', created: 1_000, context_length: 4_096 });
        const slow = makeModel({ id: 'vendor/slow', created: 1_000, context_length: 32_768 });
        mockFetches([], [slow, fast]);
        const result = await load().refreshModels();
        expect(result[0]).toBe('vendor/fast');
        expect(result[1]).toBe('vendor/slow');
    });

    test('equal created and context_length: model ID alphabetical tiebreaker', async () => {
        const alpha = makeModel({ id: 'vendor/alpha', created: 1_000, context_length: 8192 });
        const zulu = makeModel({ id: 'vendor/zulu', created: 1_000, context_length: 8192 });
        mockFetches([], [zulu, alpha]);
        expect((await load().refreshModels())[0]).toBe('vendor/alpha');
    });

    test('result is capped at 5 models', async () => {
        const models = Array.from({ length: 10 }, (_, i) =>
            makeModel({ id: `vendor/model-${i}`, created: i }),
        );
        mockFetches([], models);
        expect(await load().refreshModels()).toHaveLength(5);
    });
});

describe('deduplication', () => {
    test('model appearing in both lists is included exactly once', async () => {
        axios.get
            .mockResolvedValueOnce(envelope([MODEL_A]))
            .mockResolvedValueOnce(envelope([MODEL_A, MODEL_B]));
        const result = await load().refreshModels();
        expect(result.filter(id => id === 'vendor/model-a')).toHaveLength(1);
    });
});

describe('writeCache — atomic write', () => {
    test('writes to .tmp file then renames to final cache path', async () => {
        mockFetches([], [MODEL_A]);
        await load().refreshModels();
        const tmpWrite = fs.writeFileSync.mock.calls.find(([p]) => String(p).endsWith('.tmp'));
        const renameCall = fs.renameSync.mock.calls[0];
        expect(tmpWrite).toBeDefined();
        expect(renameCall[0]).toMatch(/\.tmp$/);
        expect(renameCall[1]).toMatch(/model_cache\.json$/);
    });

    test('writeCache failure is non-fatal — refreshModels still returns results', async () => {
        fs.writeFileSync.mockImplementation(() => { throw new Error('disk full'); });
        mockFetches([], [MODEL_A]);
        expect(await load().refreshModels()).toContain('vendor/model-a');
    });
});

describe('cache — isCacheValid', () => {
    function makeCache(overrides = {}) {
        return JSON.stringify({
            fetchedAt: Date.now() - 1_000,
            models: ['vendor/model-a'],
            ...overrides,
        });
    }

    test('valid fresh cache is returned without any network calls', async () => {
        fs.readFileSync.mockReturnValue(makeCache());
        const { getFreeModels } = load();
        expect(await getFreeModels()).toEqual(['vendor/model-a']);
        expect(axios.get).not.toHaveBeenCalled();
    });

    test('expired cache triggers a network refresh', async () => {
        fs.readFileSync.mockReturnValue(makeCache({ fetchedAt: Date.now() - 25 * 60 * 60 * 1000 }));
        mockFetches([], [MODEL_A]);
        await load().getFreeModels();
        expect(axios.get).toHaveBeenCalled();
    });

    test('cache containing a non-string entry is rejected and triggers refresh', async () => {
        fs.readFileSync.mockReturnValue(makeCache({ models: [null] }));
        mockFetches([], [MODEL_A]);
        await load().getFreeModels();
        expect(axios.get).toHaveBeenCalled();
    });

    test('cache with an empty models array is rejected and triggers refresh', async () => {
        fs.readFileSync.mockReturnValue(makeCache({ models: [] }));
        mockFetches([], [MODEL_A]);
        await load().getFreeModels();
        expect(axios.get).toHaveBeenCalled();
    });

    test('corrupt JSON in cache triggers a refresh', async () => {
        fs.readFileSync.mockReturnValue('{ not valid json }');
        mockFetches([], [MODEL_A]);
        await load().getFreeModels();
        expect(axios.get).toHaveBeenCalled();
    });
});

describe('in-memory cache', () => {
    test('second getFreeModels call skips disk and network', async () => {
        mockFetches([], [MODEL_A]);
        const { getFreeModels } = load();
        await getFreeModels();
        await getFreeModels();
        expect(axios.get).toHaveBeenCalledTimes(2);
    });

    test('clearMemoryCache forces disk re-check on next call', async () => {
        fs.readFileSync
            .mockReturnValueOnce(JSON.stringify({ fetchedAt: Date.now() - 100, models: ['vendor/first'] }))
            .mockReturnValueOnce(JSON.stringify({ fetchedAt: Date.now() - 100, models: ['vendor/second'] }));
        const { getFreeModels, clearMemoryCache } = load();
        const first = await getFreeModels();
        clearMemoryCache();
        const second = await getFreeModels();
        expect(first).toEqual(['vendor/first']);
        expect(second).toEqual(['vendor/second']);
    });
});

describe('refresh lock', () => {
    test('concurrent refreshModels calls share one in-flight fetch', async () => {
        mockFetches([], [MODEL_A]);
        const { refreshModels } = load();
        const [r1, r2, r3] = await Promise.all([
            refreshModels(),
            refreshModels(),
            refreshModels(),
        ]);
        expect(r1).toEqual(r2);
        expect(r2).toEqual(r3);
        expect(axios.get).toHaveBeenCalledTimes(2);
    });
});

describe('security — missing API key', () => {
    test('throws with a clear message before making any network call', async () => {
        delete process.env.OPENROUTER_API_KEY;
        const { refreshModels } = load();
        await expect(refreshModels()).rejects.toThrow('OPENROUTER_API_KEY is not set');
        expect(axios.get).not.toHaveBeenCalled();
    });
});

describe('roleplay fetch failure — graceful degradation', () => {
    test('proceeds with all-models list when the roleplay fetch fails', async () => {
        axios.get
            .mockRejectedValueOnce(new Error('timeout'))
            .mockResolvedValueOnce(envelope([MODEL_A]));
        expect(await load().refreshModels()).toContain('vendor/model-a');
    });

    test('propagates error when the all-models fetch also fails', async () => {
        axios.get
            .mockRejectedValueOnce(new Error('timeout'))
            .mockRejectedValueOnce(new Error('503 unavailable'));
        await expect(load().refreshModels()).rejects.toThrow('503 unavailable');
    });
});
