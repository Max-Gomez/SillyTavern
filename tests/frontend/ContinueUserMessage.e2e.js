import { test, expect } from '@playwright/test';
import { testSetup } from './frontent-test-utils.js';

/**
 * Runs cleanUpMessage with a sequence-based instruct template (modelled on Gemma 4)
 * and a chat whose last message is either a user or a character message.
 * Restores the original instruct settings and chat afterwards.
 * @param {import('@playwright/test').Page} page
 * @param {object} params
 * @param {string} params.getMessage Raw text returned by the backend
 * @param {boolean} params.isContinue Whether the generation is a continuation
 * @param {boolean} params.lastIsUser Whether the last chat message is a user message
 * @returns {Promise<string>} Cleaned up message
 */
async function cleanUpWithInstruct(page, { getMessage, isContinue, lastIsUser }) {
    return await page.evaluate(async ({ getMessage, isContinue, lastIsUser }) => {
        /** @type {import('../../public/script.js')} */
        const { cleanUpMessage, chat } = await import('./script.js');
        /** @type {import('../../public/scripts/power-user.js')} */
        const { power_user } = await import('./scripts/power-user.js');

        const originalInstruct = structuredClone(power_user.instruct);
        const originalTrimSpaces = power_user.trim_spaces;
        const originalChat = chat.splice(0, chat.length);

        power_user.trim_spaces = true;
        Object.assign(power_user.instruct, {
            enabled: true,
            wrap: false,
            macro: true,
            names_behavior: 'force',
            sequences_as_stop_strings: true,
            stop_sequence: '',
            input_sequence: '<|turn>user\n',
            output_sequence: '<|turn>model\n',
            first_output_sequence: '',
            last_output_sequence: '',
            system_sequence: '<|turn>system\n',
        });

        chat.push({
            name: lastIsUser ? 'User' : 'Assistant',
            is_user: lastIsUser,
            is_system: false,
            send_date: new Date().toISOString(),
            mes: 'Original text',
            extra: {},
        });

        try {
            return cleanUpMessage({ getMessage, isImpersonate: false, isContinue, stoppingStrings: [] });
        } finally {
            Object.assign(power_user.instruct, originalInstruct);
            power_user.trim_spaces = originalTrimSpaces;
            chat.splice(0, chat.length, ...originalChat);
        }
    }, { getMessage, isContinue, lastIsUser });
}

test.describe('Continue on a user message with instruct sequences', () => {
    test.beforeEach(testSetup.awaitST);

    test('cuts the continuation where the character turn starts', async ({ page }) => {
        const result = await cleanUpWithInstruct(page, {
            getMessage: ' and that is all I wanted to say.\n<|turn>model\n<think>The user is done.</think>Glad to hear it!',
            isContinue: true,
            lastIsUser: true,
        });

        expect(result).toBe('and that is all I wanted to say.');
    });

    test('keeps a continuation that stays inside the user turn', async ({ page }) => {
        const result = await cleanUpWithInstruct(page, {
            getMessage: ' and that is all I wanted to say.',
            isContinue: true,
            lastIsUser: true,
        });

        expect(result).toBe('and that is all I wanted to say.');
    });

    test('still strips a leaked output sequence when continuing a character message', async ({ page }) => {
        const result = await cleanUpWithInstruct(page, {
            getMessage: '<|turn>model\nGlad to hear it!',
            isContinue: true,
            lastIsUser: false,
        });

        expect(result).toBe('Glad to hear it!');
    });

    test('still strips a leaked output sequence on a normal reply', async ({ page }) => {
        const result = await cleanUpWithInstruct(page, {
            getMessage: '<|turn>model\nGlad to hear it!',
            isContinue: false,
            lastIsUser: true,
        });

        expect(result).toBe('Glad to hear it!');
    });
});
