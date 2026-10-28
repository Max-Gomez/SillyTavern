import { test, expect } from '@playwright/test';
import { testSetup } from './frontent-test-utils.js';

const GENERATE_URL = '**/api/backends/chat-completions/generate';

/**
 * Builds an SSE body out of JSON chunks, terminated with [DONE].
 * @param {object[]} chunks
 * @returns {string}
 */
function toEventStream(chunks) {
    return chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n';
}

/**
 * Sends a chat completion request through the client and returns the warning toasts it produced.
 * @param {import('@playwright/test').Page} page
 * @param {object} params
 * @param {object|object[]} params.body Mocked backend response (array means a streamed response)
 * @returns {Promise<{ text: string, toasts: string[] }>}
 */
async function generateWithMockedBackend(page, { body }) {
    const stream = Array.isArray(body);
    await page.route(GENERATE_URL, route => route.fulfill(stream
        ? { status: 200, contentType: 'text/event-stream', body: toEventStream(body) }
        : { status: 200, contentType: 'application/json', body: JSON.stringify(body) },
    ));

    try {
        return await page.evaluate(async (stream) => {
            const { sendOpenAIRequest } = await import('./scripts/openai.js');
            const ctx = window.SillyTavern.getContext();

            document.querySelectorAll('#toast-container .toast').forEach(toast => toast.remove());
            ctx.chatCompletionSettings.stream_openai = stream;

            const messages = [{ role: 'user', content: 'Hello' }];
            const result = await sendOpenAIRequest('normal', messages, null);
            let text = '';
            if (typeof result === 'function') {
                for await (const chunk of result()) {
                    text = chunk.text;
                }
            } else {
                text = result?.choices?.[0]?.message?.content ?? '';
            }

            const toasts = [...document.querySelectorAll('#toast-container .toast-warning')]
                .map(toast => toast.textContent.trim());
            return { text, toasts };
        }, stream);
    } finally {
        await page.unroute(GENERATE_URL);
    }
}

test.describe('Chat Completion finish reason notice', () => {
    test.beforeEach(testSetup.awaitST);

    test.beforeEach(async ({ page }) => {
        // A fresh account runs onboarding on load: dismiss its popups so toasts land in the page.
        await page.evaluate(async () => {
            const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
            for (let i = 0; i < 10; i++) {
                const okButton = document.querySelector('.popup:popover-open .popup-button-ok, dialog[open] .popup-button-ok');
                if (!okButton) break;
                okButton.click();
                await delay(300);
            }
        });
    });

    test('shows no notice when the reply finished normally', async ({ page }) => {
        const result = await generateWithMockedBackend(page, {
            body: { choices: [{ index: 0, message: { role: 'assistant', content: 'Full reply.' }, finish_reason: 'stop' }] },
        });

        expect(result.text).toBe('Full reply.');
        expect(result.toasts).toEqual([]);
    });

    test('warns when a non-streamed reply hit the length limit', async ({ page }) => {
        const result = await generateWithMockedBackend(page, {
            body: { choices: [{ index: 0, message: { role: 'assistant', content: 'Truncated' }, finish_reason: 'length' }] },
        });

        expect(result.text).toBe('Truncated');
        expect(result.toasts).toHaveLength(1);
        expect(result.toasts[0]).toContain('maximum response length');
    });

    test('warns when a Google-style reply hit the length limit', async ({ page }) => {
        const result = await generateWithMockedBackend(page, {
            body: { choices: [{ message: { content: 'Truncated' }, finish_reason: 'MAX_TOKENS' }] },
        });

        expect(result.toasts).toHaveLength(1);
        expect(result.toasts[0]).toContain('maximum response length');
    });

    test('warns when a reply was stopped by a content filter', async ({ page }) => {
        const result = await generateWithMockedBackend(page, {
            body: { choices: [{ index: 0, message: { role: 'assistant', content: '' }, finish_reason: 'content_filter' }] },
        });

        expect(result.toasts).toHaveLength(1);
        expect(result.toasts[0]).toContain('content filter');
        expect(result.toasts[0]).toContain('content_filter');
    });

    test('warns once when a streamed reply hit the length limit', async ({ page }) => {
        const result = await generateWithMockedBackend(page, {
            body: [
                { choices: [{ index: 0, delta: { role: 'assistant', content: 'Hel' }, finish_reason: null }] },
                { choices: [{ index: 0, delta: { content: 'lo' }, finish_reason: null }] },
                { choices: [{ index: 0, delta: {}, finish_reason: 'length' }] },
                { choices: [{ index: 0, delta: {}, finish_reason: 'length' }] },
            ],
        });

        expect(result.text).toBe('Hello');
        expect(result.toasts).toHaveLength(1);
        expect(result.toasts[0]).toContain('maximum response length');
    });

    test('shows no notice when a streamed reply finished normally', async ({ page }) => {
        const result = await generateWithMockedBackend(page, {
            body: [
                { choices: [{ index: 0, delta: { role: 'assistant', content: 'Hello' }, finish_reason: null }] },
                { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
            ],
        });

        expect(result.text).toBe('Hello');
        expect(result.toasts).toEqual([]);
    });
});
