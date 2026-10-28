import { describe, expect, test } from '@jest/globals';

import { generationErrorBody } from '../src/util.js';

describe('generationErrorBody', () => {
    test('keeps a socket hang-up message where generate toasts read it', () => {
        const error = new Error('request to https://example.test/generate failed, reason: socket hang up');
        error.code = 'ECONNRESET';

        expect(generationErrorBody(error)).toEqual({
            error: { message: error.message },
            response: error.message,
        });
    });

    test('leaves any other failure as { error: true }', () => {
        expect(generationErrorBody(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }))).toEqual({ error: true });
    });
});
