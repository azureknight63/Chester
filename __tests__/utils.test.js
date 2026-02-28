const {
	cleanMessageContent,
	splitMessageBySentence,
	validateAIInput,
	removeService,
	REGEX_THINK_TAGS,
	REGEX_ANGLE_BRACKETS,
	REGEX_CONTEXT_PATTERN,
	REGEX_CURLY_BRACES,
	REGEX_SENTENCE_SPLIT
} = require('../utils');

describe('cleanMessageContent', () => {
	test('should remove <think> tags', () => {
		const input = 'Hello <think>reasoning</think> world';
		const result = cleanMessageContent(input);
		expect(result).not.toContain('<think>');
		expect(result).toContain('Hello');
		expect(result).toContain('world');
	});

	test('should remove angle brackets', () => {
		const input = 'Hello <world>';
		const result = cleanMessageContent(input);
		expect(result).not.toContain('<');
		expect(result).not.toContain('>');
	});

	test('should remove Context patterns', () => {
		const input = 'Message Context: user: content here';
		const result = cleanMessageContent(input);
		expect(result).not.toContain('Context:');
	});

	test('should remove curly braces', () => {
		const input = 'Hello {world}';
		const result = cleanMessageContent(input);
		expect(result).not.toContain('{');
		expect(result).not.toContain('}');
	});

	test('should handle single element array', () => {
		const input = '["single"]';
		const result = cleanMessageContent(input);
		expect(result).toContain('single');
	});

	test('should handle two element array', () => {
		const input = '["first", "second"]';
		const result = cleanMessageContent(input);
		expect(result).toContain('first');
		expect(result).toContain('second');
	});

	test('should handle object JSON with author key', () => {
		const input = '{"author": "Chester", "message": "Hello"}';
		const result = cleanMessageContent(input);
		expect(result).toContain('Hello');
	});

	test('should handle object JSON without author key', () => {
		const input = '{"content": "Hello world"}';
		const result = cleanMessageContent(input);
		expect(result).toContain('Hello world');
	});

	test('should handle single-entry object', () => {
		const input = '{"key": "value"}';
		const result = cleanMessageContent(input);
		expect(result).toContain('value');
	});

	test('should handle non-string input', () => {
		const result = cleanMessageContent(123);
		expect(typeof result).toBe('string');
		expect(result).toBe('123');
	});

	test('should return empty string for empty input', () => {
		const result = cleanMessageContent('');
		expect(result).toBe('');
	});

	test('should handle whitespace-only input', () => {
		const result = cleanMessageContent('   ');
		expect(result).toBe('');
	});

	test('should handle complex nested content', () => {
		const input = 'Start <think>deep reasoning here</think> middle <angle> end {braces}';
		const result = cleanMessageContent(input);
		expect(result).not.toContain('<think>');
		expect(result).not.toContain('</think>');
		expect(result).not.toContain('<');
		expect(result).not.toContain('>');
		expect(result).not.toContain('{');
		expect(result).not.toContain('}');
	});

	test('should preserve valid content', () => {
		const input = 'This is a valid message without special chars';
		const result = cleanMessageContent(input);
		expect(result).toContain('This is a valid message without special chars');
	});

	test('should handle invalid JSON gracefully', () => {
		const input = '[invalid json}';
		const result = cleanMessageContent(input);
		expect(result).toBeTruthy();
	});

	test('should handle empty array', () => {
		const input = '[]';
		const result = cleanMessageContent(input);
		expect(result).toBe('');
	});
});

describe('splitMessageBySentence', () => {
	test('should return single message if under limit', () => {
		const input = 'Hello world.';
		const result = splitMessageBySentence(input);
		expect(result).toHaveLength(1);
		expect(result[0]).toBe(input);
	});

	test('should split long messages at sentence boundaries', () => {
		const input = 'First sentence. Second sentence. Third sentence.';
		const result = splitMessageBySentence(input, 20);
		expect(result.length).toBeGreaterThan(1);
		result.forEach(msg => {
			expect(msg.length).toBeLessThanOrEqual(20);
		});
	});

	test('should respect custom max length with sentences', () => {
		const input = 'First sentence. ' + 'Next sentence. '.repeat(500);
		const result = splitMessageBySentence(input, 100);
		result.forEach(msg => {
			expect(msg.length).toBeLessThanOrEqual(100);
		});
	});

	test('should handle newline delimiters', () => {
		const input = 'Line one\nLine two\nLine three';
		const result = splitMessageBySentence(input, 20);
		expect(result.length).toBeGreaterThanOrEqual(1);
	});

	test('should throw error for non-string input', () => {
		expect(() => splitMessageBySentence(123)).toThrow('Text must be a string.');
	});

	test('should throw error for invalid max length', () => {
		expect(() => splitMessageBySentence('text', -5)).toThrow('Max length must be a positive number.');
		expect(() => splitMessageBySentence('text', 0)).toThrow('Max length must be a positive number.');
	});

	test('should handle empty string gracefully', () => {
		const result = splitMessageBySentence('');
		expect(result).toEqual(['']);
	});

	test('should handle whitespace-only string', () => {
		const result = splitMessageBySentence('   ');
		expect(result).toEqual(['']);
	});

	test('should preserve sentence structure', () => {
		const input = 'First! Second? Third.';
		const result = splitMessageBySentence(input, 50);
		const joined = result.join('');
		expect(joined).toContain('First!');
		expect(joined).toContain('Second?');
		expect(joined).toContain('Third.');
	});

	test('should not split within sentences unless necessary', () => {
		const input = 'This is one very long sentence that goes on and on without any punctuation.';
		const result = splitMessageBySentence(input, 2000);
		expect(result.length).toBe(1);
	});
});

describe('validateAIInput', () => {
	test('should accept valid input', () => {
		const instructions = 'You are helpful.';
		const prompt = ['Hello', 'How are you?'];
		expect(() => validateAIInput(instructions, prompt)).not.toThrow();
	});

	test('should throw error for empty instructions', () => {
		expect(() => validateAIInput('', ['test'])).toThrow('Instructions must be a non-empty string.');
	});

	test('should throw error for null instructions', () => {
		expect(() => validateAIInput(null, ['test'])).toThrow('Instructions must be a non-empty string.');
	});

	test('should throw error for non-string instructions', () => {
		expect(() => validateAIInput(123, ['test'])).toThrow('Instructions must be a non-empty string.');
	});

	test('should throw error for empty prompt array', () => {
		expect(() => validateAIInput('Instructions', [])).toThrow('Prompt must be a non-empty array.');
	});

	test('should throw error for null prompt', () => {
		expect(() => validateAIInput('Instructions', null)).toThrow('Prompt must be a non-empty array.');
	});

	test('should throw error for non-array prompt', () => {
		expect(() => validateAIInput('Instructions', 'not array')).toThrow('Prompt must be a non-empty array.');
	});

	test('should throw error for empty prompt message', () => {
		expect(() => validateAIInput('Instructions', ['Hello', ''])).toThrow('All prompt messages must be non-empty strings.');
	});

	test('should throw error for non-string prompt message', () => {
		expect(() => validateAIInput('Instructions', ['Hello', 123])).toThrow('All prompt messages must be non-empty strings.');
	});

	test('should throw error for whitespace-only prompt message', () => {
		expect(() => validateAIInput('Instructions', ['Hello', '   '])).toThrow('All prompt messages must be non-empty strings.');
	});
});

describe('removeService', () => {
	test('should remove service from array', () => {
		const services = ['service1', 'service2', 'service3'];
		const result = removeService(services, 'service2');
		expect(result).not.toContain('service2');
		expect(result).toContain('service1');
		expect(result).toContain('service3');
	});

	test('should handle removing non-existent service', () => {
		const services = ['service1', 'service2'];
		const result = removeService(services, 'service3');
		expect(result).toEqual(['service1', 'service2']);
	});

	test('should handle empty array', () => {
		const services = [];
		const result = removeService(services, 'service1');
		expect(result).toEqual([]);
	});

	test('should return new array', () => {
		const services = ['service1', 'service2'];
		const result = removeService(services, 'service1');
		expect(result).not.toBe(services);
	});

	test('should remove all occurrences of service', () => {
		const services = ['service1', 'service2', 'service1'];
		const result = removeService(services, 'service1');
		expect(result).toEqual(['service2']);
	});
});

describe('Regex patterns', () => {
	test('REGEX_THINK_TAGS should match think tags', () => {
		const text = 'Hello <think>reasoning</think> world';
		expect(text.match(REGEX_THINK_TAGS)).toBeTruthy();
	});

	test('REGEX_ANGLE_BRACKETS should match angle brackets', () => {
		const text = 'Hello <world>';
		expect(text.match(REGEX_ANGLE_BRACKETS)).toBeTruthy();
	});

	test('REGEX_CONTEXT_PATTERN should match context pattern', () => {
		const text = 'Context: user:';
		expect(text.match(REGEX_CONTEXT_PATTERN)).toBeTruthy();
	});

	test('REGEX_CURLY_BRACES should match curly braces', () => {
		const text = 'Hello {world}';
		expect(text.match(REGEX_CURLY_BRACES)).toBeTruthy();
	});

	test('REGEX_SENTENCE_SPLIT should split on sentence boundaries', () => {
		const text = 'First sentence. Second sentence! Third sentence?';
		const matches = text.match(REGEX_SENTENCE_SPLIT);
		expect(matches).toBeTruthy();
		expect(matches.length).toBeGreaterThanOrEqual(3);
	});
});

describe('Integration tests', () => {
	test('should handle full message cleanup and split', () => {
		const input = 'Start <think>reasoning</think> middle. ' + 'Next sentence. '.repeat(100);
		const cleaned = cleanMessageContent(input);
		const split = splitMessageBySentence(cleaned, 2000);
		
		split.forEach(msg => {
			expect(msg.length).toBeLessThanOrEqual(2000);
			expect(msg).not.toContain('<think>');
			expect(msg).not.toContain('>');
		});
	});

	test('should handle validation before cleanup', () => {
		const instructions = 'Be helpful';
		const prompt = ['Hello world'];
		expect(() => validateAIInput(instructions, prompt)).not.toThrow();
		
		const cleaned = cleanMessageContent(prompt[0]);
		expect(typeof cleaned).toBe('string');
	});
});
