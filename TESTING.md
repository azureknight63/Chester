# Chester Bot - Testing Guide

## Setup

Jest has been configured for unit testing Chester Bot utilities.

### Installation

```bash
npm install
```

### Running Tests

Run all tests:
```bash
npm test
```

Run tests with coverage report:
```bash
npm run test:coverage
```

## Test Coverage

Current target: **70% coverage** across:
- Branches
- Functions
- Lines
- Statements

### Test Files

- `__tests__/utils.test.js` - Tests for utility functions (cleanMessageContent, splitMessageBySentence, validateAIInput, removeService)

## Tested Functions

### cleanMessageContent(messageContent)
- Removes `<think>` tags
- Removes angle brackets
- Removes Context patterns
- Removes curly braces
- Handles JSON arrays and objects
- Gracefully handles non-string input
- Handles empty/whitespace input

### splitMessageBySentence(text, maxLength = 2000)
- Splits long messages at sentence boundaries
- Respects custom max length
- Handles newline delimiters
- Input validation for type checking
- Preserves sentence structure
- Gracefully handles edge cases

### validateAIInput(instructions, prompt)
- Validates instructions is non-empty string
- Validates prompt is non-empty array
- Validates all prompt messages are non-empty strings
- Throws descriptive errors

### removeService(availableServices, serviceName)
- Removes service from array
- Handles non-existent services
- Returns new array (doesn't mutate original)
- Handles empty arrays

## Architecture

The code has been refactored into testable modules:

- **utils.js** - Pure utility functions exported for testing
- **chester.js** - Main Discord bot (uses utils)
- **__tests__/utils.test.js** - Comprehensive test suite

## Coverage Strategy

Tests are organized by:
1. **Unit tests** - Individual function behavior
2. **Edge case tests** - Boundary conditions and error handling
3. **Integration tests** - Functions working together
4. **Regex pattern tests** - Validation of compiled regex patterns

## Continuous Integration

To run tests as part of CI/CD:

```bash
npm run test:coverage
```

The Jest config enforces 70% coverage threshold. Tests will fail if coverage drops below this.

## Future Testing

When testable Discord/API code is extracted, additional test suites should be created:
- `__tests__/api.test.js` - API integration tests
- `__tests__/discord.test.js` - Discord event handling tests
- `__tests__/services.test.js` - LLM service tests
