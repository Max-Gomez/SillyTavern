import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, jest, test } from '@jest/globals';

const fetchMock = jest.fn();
jest.unstable_mockModule('node-fetch', () => ({ default: fetchMock }));

describe('NanoGPT Claude caching at depth', () => {
    /** @type {import('node:http').Server} */
    let server;
    let baseUrl;
    let tempDir;

    beforeAll(async () => {
        process.env.SILLYTAVERN_CLAUDE_CACHINGATDEPTH = '2';
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'st-nanogpt-'));
        const { default: express } = await import('express');
        const { setConfigFilePath } = await import('../src/util.js');
        setConfigFilePath('../default/config.yaml');
        const { writeSecret, SECRET_KEYS } = await import('../src/endpoints/secrets.js');
        writeSecret({ root: tempDir }, SECRET_KEYS.NANOGPT, 'test-key');
        const { router } = await import('../src/endpoints/backends/chat-completions.js');
        const app = express();
        app.use(express.json());
        app.use((req, _res, next) => {
            req.user = { directories: { root: tempDir } };
            next();
        });
        app.use(router);
        server = app.listen(0, '127.0.0.1');
        await new Promise(resolve => server.once('listening', resolve));
        const address = server.address();
        baseUrl = `http://127.0.0.1:${address.port}`;
    });

    afterAll(async () => {
        delete process.env.SILLYTAVERN_CLAUDE_CACHINGATDEPTH;
        if (server) {
            await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        }
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    beforeEach(() => {
        fetchMock.mockReset();
        fetchMock.mockResolvedValue({ ok: true, json: async () => ({ choices: [] }) });
    });

    async function generate(model) {
        const response = await fetch(`${baseUrl}/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_completion_source: 'nanogpt',
                model,
                stream: false,
                messages: [
                    { role: 'system', content: 'System prompt' },
                    { role: 'user', content: 'A' },
                    { role: 'assistant', content: 'B' },
                    { role: 'user', content: 'C' },
                    { role: 'assistant', content: 'D' },
                    { role: 'user', content: 'E' },
                ],
            }),
        });
        expect(response.status).toBe(200);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, config] = fetchMock.mock.calls[0];
        return { url, body: JSON.parse(config.body) };
    }

    test('adds cache_control markers at the configured depth for Claude models', async () => {
        const { url, body } = await generate('claude-sonnet-4-5');

        expect(url).toBe('https://nano-gpt.com/api/v1/chat/completions');
        expect(body.messages).toEqual([
            { role: 'system', content: 'System prompt' },
            { role: 'user', content: [{ type: 'text', text: 'A', cache_control: { type: 'ephemeral', ttl: '5m' } }] },
            { role: 'assistant', content: 'B' },
            { role: 'user', content: [{ type: 'text', text: 'C', cache_control: { type: 'ephemeral', ttl: '5m' } }] },
            { role: 'assistant', content: 'D' },
            { role: 'user', content: 'E' },
        ]);
    });

    test('leaves messages untouched for non-Claude models', async () => {
        const { body } = await generate('gpt-4o');

        expect(body.messages.every(message => typeof message.content === 'string')).toBe(true);
    });
});
