/**
 * Utility functions for Chester bot
 * These are extracted for easier testing
 */

// Cached regex patterns for performance
const REGEX_THINK_TAGS = /<think>[\s\S]*?<\/think>/gi;
const REGEX_ANGLE_BRACKETS = /[<>]/g;
const REGEX_CONTEXT_PATTERN = /Context: [^:]+:/g;
const REGEX_CURLY_BRACES = /[{}]/g;
const REGEX_SENTENCE_SPLIT = /[^.!?\n]+[.!?\n]+/g;

/**
 * Clean message content by removing think tags, angle brackets, context patterns, and curly braces
 * @param {string} messageContent - The content to clean
 * @returns {string} The cleaned content
 */
function cleanMessageContent(messageContent) {
	// Input validation
	if (typeof messageContent !== 'string') {
		return String(messageContent);
	}
	if (messageContent.trim() === '') {
		return '';
	}

	// Remove <think> tags and angle brackets.
	let content = messageContent.replace(REGEX_THINK_TAGS, '')
		.replace(REGEX_ANGLE_BRACKETS, '');

	if (content.trim().startsWith('[') && content.trim().endsWith(']')) {
		try {
			let list = JSON.parse(content);
			if (Array.isArray(list)) {
				if (list.length === 0) {
					content = '';
				} else if (list.length === 1) {
					content = String(list[0]) + '.';
				} else {
					const sentence = list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1] + '.';
					content = sentence;
				}
			}
		} catch (error) {
			// Leave content unchanged if parsing fails.
		}
	}

	try {
		const parsed = JSON.parse(content);
		if (parsed && typeof parsed === 'object') {
			// Use the first element if it's an array or the first value if it's an object.
			if (Array.isArray(parsed)) {
				// If the first element has an "author" key and there's a second element, use that.
				if (
					parsed.length > 1 &&
					parsed[0] !== null &&
					typeof parsed[0] === 'object' &&
					Object.prototype.hasOwnProperty.call(parsed[0], 'author')
				) {
					content = parsed[1];
				} else {
					content = parsed[0];
				}
			} else {
				const entries = Object.entries(parsed);
				// If the first entry's key is "author" and there's another entry, take the next one.
				if (entries.length > 1 && entries[0][0] === 'author') {
					content = entries[1][1];
				} else {
					content = entries[0][1];
				}
			}
			if (typeof content !== 'string') {
				content = String(content);
			}
		}
	} catch (err) {
		// Not valid JSON, leave content as-is.
	}

	// Remove substrings matching the pattern "Context: xxxxx:"
	content = content.replace(REGEX_CONTEXT_PATTERN, '');

	// Remove curly braces.
	return content.replace(REGEX_CURLY_BRACES, '');
}

/**
 * Split long messages at sentence boundaries
 * @param {string} text - The text to split
 * @param {number} maxLength - Maximum length per message (default 2000)
 * @returns {string[]} Array of message chunks
 */
function splitMessageBySentence(text, maxLength = 2000) {
	// Input validation
	if (typeof text !== 'string') {
		throw new Error('Text must be a string.');
	}
	if (typeof maxLength !== 'number' || maxLength < 1) {
		throw new Error('Max length must be a positive number.');
	}
	if (text.trim() === '') {
		return [''];
	}

	if (text.length <= maxLength) {
		return [text];
	}

	const messages = [];
	let currentMessage = '';

	// Split by sentences using common sentence delimiters
	const sentences = text.match(REGEX_SENTENCE_SPLIT) || [text];

	for (const sentence of sentences) {
		// If adding this sentence would exceed the limit and we have content, start a new message
		if ((currentMessage + sentence).length > maxLength && currentMessage.length > 0) {
			messages.push(currentMessage.trim());
			currentMessage = sentence;
		} else {
			currentMessage += sentence;
		}
	}

	// Add any remaining content
	if (currentMessage.trim().length > 0) {
		messages.push(currentMessage.trim());
	}

	return messages;
}

/**
 * Validate AI service input (instructions and prompt)
 * @param {string} instructions - System instructions
 * @param {string[]} prompt - Array of prompt messages
 * @throws {Error} If validation fails
 */
function validateAIInput(instructions, prompt) {
	if (!instructions || typeof instructions !== 'string') {
		throw new Error('Instructions must be a non-empty string.');
	}
	if (!prompt || !Array.isArray(prompt) || prompt.length === 0) {
		throw new Error('Prompt must be a non-empty array.');
	}
	if (prompt.some(msg => typeof msg !== 'string' || msg.trim() === '')) {
		throw new Error('All prompt messages must be non-empty strings.');
	}
}

/**
 * Remove a service from available services
 * @param {string[]} availableServices - Current array of available services
 * @param {string} serviceName - Name of service to remove
 * @returns {string[]} Updated array of available services
 */
function removeService(availableServices, serviceName) {
	return availableServices.filter(s => s !== serviceName);
}

module.exports = {
	cleanMessageContent,
	splitMessageBySentence,
	validateAIInput,
	removeService,
	REGEX_THINK_TAGS,
	REGEX_ANGLE_BRACKETS,
	REGEX_CONTEXT_PATTERN,
	REGEX_CURLY_BRACES,
	REGEX_SENTENCE_SPLIT
};
