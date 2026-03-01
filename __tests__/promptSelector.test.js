'use strict';

describe('promptSelector', () => {
    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    test('returns a string from the configured prompts', () => {
        jest.mock('../prompts.json', () => ({
            character_reinforcement_prompts: [
                { id: 1, prompt: "Prompt A" },
                { id: 2, prompt: "Prompt B" }
            ]
        }));

        const { getRandomPrompt } = require('../promptSelector');
        const prompt = getRandomPrompt();

        expect(["Prompt A", "Prompt B"]).toContain(prompt);
    });

    test('returns a fallback prompt if character_reinforcement_prompts is empty', () => {
        jest.mock('../prompts.json', () => ({
            character_reinforcement_prompts: []
        }));

        const { getRandomPrompt, FALLBACK_PROMPT } = require('../promptSelector');
        const prompt = getRandomPrompt();

        expect(prompt).toBe(FALLBACK_PROMPT);
    });

    test('returns a fallback prompt if character_reinforcement_prompts is completely missing', () => {
        jest.mock('../prompts.json', () => ({}));

        const { getRandomPrompt, FALLBACK_PROMPT } = require('../promptSelector');
        const prompt = getRandomPrompt();

        expect(prompt).toBe(FALLBACK_PROMPT);
    });

    test('returns a fallback prompt if prompts.json is completely missing/unrequireable', () => {
        jest.mock('../prompts.json', () => {
            throw new Error("File not found module");
        });

        // suppress console.error for this specific test
        jest.spyOn(console, 'error').mockImplementation(() => { });

        const { getRandomPrompt, FALLBACK_PROMPT } = require('../promptSelector');
        const prompt = getRandomPrompt();

        expect(prompt).toBe(FALLBACK_PROMPT);

        console.error.mockRestore();
    });

    test('returns a fallback prompt if the selected prompt item is malformed', () => {
        jest.mock('../prompts.json', () => ({
            character_reinforcement_prompts: [
                { id: 1, missing_prompt_key: "Oops" }
            ]
        }));
        const { getRandomPrompt, FALLBACK_PROMPT } = require('../promptSelector');
        const prompt = getRandomPrompt();

        expect(prompt).toBe(FALLBACK_PROMPT);
    });

    test('returns a fallback prompt if character_reinforcement_prompts is not an array', () => {
        jest.mock('../prompts.json', () => ({
            character_reinforcement_prompts: "I am a string, not an array!"
        }));
        const { getRandomPrompt, FALLBACK_PROMPT } = require('../promptSelector');
        const prompt = getRandomPrompt();

        expect(prompt).toBe(FALLBACK_PROMPT);
    });

    test('calls Math.random to select a prompt', () => {
        jest.mock('../prompts.json', () => ({
            character_reinforcement_prompts: [
                { id: 1, prompt: "Prompt A" },
                { id: 2, prompt: "Prompt B" },
                { id: 3, prompt: "Prompt C" }
            ]
        }));

        const originalRandom = Math.random;
        Math.random = jest.fn(() => 0.6); // Will select index 1 (Math.floor(0.6 * 3) = 1) -> Prompt B

        const { getRandomPrompt } = require('../promptSelector');
        const prompt = getRandomPrompt();

        expect(Math.random).toHaveBeenCalled();
        expect(prompt).toBe("Prompt B");

        Math.random = originalRandom; // Restore
    });
});
