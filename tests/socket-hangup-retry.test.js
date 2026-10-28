import { describe, expect, jest, test } from '@jest/globals';

import {
    fetchRetryingSocketHangUp,
    isSocketHangUpError,
    SOCKET_HANG_UP_ATTEMPTS,
    socketHangUpErrorBody,
} from '../src/util.js';

function hangUp(message = 'request to https://example.test/generate failed, reason: socket hang up') {
    const error = new Error(message);
    error.code = 'ECONNRESET';
    return error;
}

describe('socket hang-up retries', () => {
    test('recognizes a node socket hang-up and ignores other connection errors', () => {
        expect(isSocketHangUpError(hangUp())).toBe(true);
        expect(isSocketHangUpError(new Error('socket hang up'))).toBe(true);
        expect(isSocketHangUpError(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }))).toBe(false);
    });

    test('retries until a later attempt succeeds', async () => {
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        const fetchImpl = jest.fn()
            .mockRejectedValueOnce(hangUp())
            .mockRejectedValueOnce(hangUp())
            .mockResolvedValueOnce({ ok: true });
        const sleep = jest.fn(async () => undefined);

        const response = await fetchRetryingSocketHangUp(fetchImpl, 'https://example.test/generate', { method: 'POST' }, { sleep, delayMs: 5 });

        expect(response).toEqual({ ok: true });
        expect(fetchImpl).toHaveBeenCalledTimes(SOCKET_HANG_UP_ATTEMPTS);
        expect(sleep).toHaveBeenNthCalledWith(1, 5);
        expect(sleep).toHaveBeenNthCalledWith(2, 10);
        warnSpy.mockRestore();
    });

    test('does not retry a different error', async () => {
        const fetchImpl = jest.fn().mockRejectedValueOnce(new Error('bad request'));

        await expect(fetchRetryingSocketHangUp(fetchImpl, 'https://example.test', {}, { sleep: async () => undefined }))
            .rejects.toThrow('bad request');
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    test('does not retry after the request was aborted', async () => {
        const fetchImpl = jest.fn().mockRejectedValueOnce(hangUp());

        await expect(fetchRetryingSocketHangUp(fetchImpl, 'https://example.test', { signal: { aborted: true } }, { sleep: async () => undefined }))
            .rejects.toThrow('socket hang up');
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    test('stops after three hang-ups and keeps a message the UI can show', async () => {
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        const fetchImpl = jest.fn().mockRejectedValue(hangUp());

        await expect(fetchRetryingSocketHangUp(fetchImpl, 'https://example.test', {}, { sleep: async () => undefined, delayMs: 0 }))
            .rejects.toThrow('socket hang up');
        expect(fetchImpl).toHaveBeenCalledTimes(SOCKET_HANG_UP_ATTEMPTS);

        const body = socketHangUpErrorBody(hangUp());
        expect(body.error.message).toContain('socket hang up');
        expect(body.response).toBe(body.error.message);
        warnSpy.mockRestore();
    });
});
