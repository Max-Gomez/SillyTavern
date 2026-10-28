import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, jest, test } from '@jest/globals';

const fetchMock = jest.fn();
jest.unstable_mockModule('node-fetch', () => ({ default: fetchMock }));

const MODELS_URL = 'https://openrouter.ai/api/v1/models';
const COMPLETIONS_URL = 'https://openrouter.ai/api/v1/chat/completions';

describe('OpenRouter web search', () => {
    /** @type {import('node:http').Server} */
    let server;
    let baseUrl;
    let tempDir;

    beforeAll(async () => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'st-openrouter-'));
        const { default: express } = await import('express');
        const { setConfigFilePath } = await import('../src/util.js');
        setConfigFilePath('../default/config.yaml');
        const { writeSecret, SECRET_KEYS } = await import('../src/endpoints/secrets.js');
        writeSecret({ root: tempDir }, SECRET_KEYS.OPENROUTER, 'test-key');
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
        if (server) {
            await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        }
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    beforeEach(() => {
        fetchMock.mockReset();
        fetchMock.mockImplementation(async (url) => {
            if (url === MODELS_URL) {
                return {
                    ok: true,
                    json: async () => ({
                        data: [
                            { id: 'tools/model', supported_parameters: ['tools', 'temperature'] },
                            { id: 'plain/model', supported_parameters: ['temperature'] },
                        ],
                    }),
                };
            }
            return { ok: true, json: async () => ({ choices: [] }) };
        });
    });

    async function generate(body) {
        const response = await fetch(`${baseUrl}/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_completion_source: 'openrouter',
                stream: false,
                messages: [{ role: 'user', content: 'Hello' }],
                ...body,
            }),
        });
        expect(response.status).toBe(200);
        const completion = fetchMock.mock.calls.find(([url]) => url === COMPLETIONS_URL);
        expect(completion).toBeDefined();
        return JSON.parse(completion[1].body);
    }

    test('uses the web search server tool for models that support tools', async () => {
        const body = await generate({ model: 'tools/model', enable_web_search: true });

        expect(body.plugins).toEqual([]);
        expect(body.tools).toEqual([{ type: 'openrouter:web_search' }]);
    });

    test('keeps client function tools alongside the server tool', async () => {
        const clientTool = { type: 'function', function: { name: 'roll', parameters: {} } };
        const body = await generate({ model: 'tools/model', enable_web_search: true, tools: [clientTool], tool_choice: 'auto' });

        expect(body.tools).toEqual([clientTool, { type: 'openrouter:web_search' }]);
        expect(body.tool_choice).toBe('auto');
    });

    test('falls back to the web plugin for models without tool support', async () => {
        const body = await generate({ model: 'plain/model', enable_web_search: true });

        expect(body.plugins).toEqual([{ id: 'web' }]);
        expect(body.tools).toBeUndefined();
    });

    test('sends neither when web search is disabled', async () => {
        const body = await generate({ model: 'tools/model', enable_web_search: false });

        expect(body.plugins).toEqual([]);
        expect(body.tools).toBeUndefined();
        expect(fetchMock.mock.calls.some(([url]) => url === MODELS_URL)).toBe(false);
    });
});
