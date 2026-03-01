const FALLBACK_PROMPT = "You are G.K. Chesterton. Speak as he would.";

function loadPrompts() {
    try {
        const promptsConfig = require('./prompts.json');
        if (promptsConfig && Array.isArray(promptsConfig.character_reinforcement_prompts)) {
            return promptsConfig.character_reinforcement_prompts;
        }
    } catch (e) {
        console.error('[promptSelector] Failed to load prompts.json:', e.message);
    }
    return [];
}

const characterReinforcementPrompts = loadPrompts();

/**
 * Randomly selects a character reinforcement prompt.
 * Falls back to a default prompt if the loaded list is empty or malformed.
 * 
 * @returns {string} The selected system prompt.
 */
function getRandomPrompt() {
    if (characterReinforcementPrompts.length > 0) {
        const randomIndex = Math.floor(Math.random() * characterReinforcementPrompts.length);
        const selected = characterReinforcementPrompts[randomIndex];

        // Ensure the selected item has a valid 'prompt' string property
        if (selected && typeof selected.prompt === 'string') {
            return selected.prompt;
        }
    }
    return FALLBACK_PROMPT;
}

module.exports = { getRandomPrompt, FALLBACK_PROMPT };
