import { describe, expect, test } from '@jest/globals';

import { generationErrorBody } from '../src/util.js';

describe('generationErrorBody', () => {
    test('keeps the error message where both generate clients read it', () => {
        const error = new Error('request to https://example.test/generate failed, reason: socket hang up');

        expect(generationErrorBody(error)).toEqual({
            error: { message: error.message },
            response: error.message,
        });
    });

    test('falls back to a generic message when there is none', () => {
        expect(generationErrorBody({})).toEqual({
            error: { message: 'Unknown error occurred' },
            response: 'Unknown error occurred',
        });
    });
});
