import { test, expect } from '@playwright/test';
import { testSetup } from './frontent-test-utils.js';

/**
 * Selects a Google AI Studio model while the model list is empty (no API key yet)
 * and reports the temperature limit that was applied. Restores the settings afterwards.
 * @param {import('@playwright/test').Page} page
 * @param {string} model Model ID to select
 * @param {number} temperature Temperature set before switching models
 * @returns {Promise<{ max: string, temperature: number }>}
 */
async function selectGoogleModel(page, model, temperature) {
    return await page.evaluate(async ({ model, temperature }) => {
        /** @type {import('../../public/scripts/openai.js')} */
        const { oai_settings, chat_completion_sources, model_list } = await import('./scripts/openai.js');

        const originalSettings = structuredClone(oai_settings);
        const originalModelList = model_list.splice(0, model_list.length);

        try {
            oai_settings.chat_completion_source = chat_completion_sources.MAKERSUITE;
            oai_settings.temp_openai = temperature;
            $('#model_google_select').val(model).trigger('change');
            return { max: $('#temp_openai').attr('max'), temperature: oai_settings.temp_openai };
        } finally {
            Object.assign(oai_settings, originalSettings);
            model_list.push(...originalModelList);
            $('#model_google_select').val(oai_settings.google_model);
            $('#temp_openai').attr('max', 2).val(oai_settings.temp_openai).trigger('input');
        }
    }, { model, temperature });
}

test.describe('Google AI Studio temperature limit without a model list', () => {
    test.beforeEach(testSetup.awaitST);

    test('keeps a Gemma temperature above 1', async ({ page }) => {
        const result = await selectGoogleModel(page, 'gemma-4-31b-it', 1.5);

        expect(result.max).toBe('2');
        expect(result.temperature).toBe(1.5);
    });

    test('still allows 2 for Gemini models', async ({ page }) => {
        const result = await selectGoogleModel(page, 'gemini-2.5-flash', 1.5);

        expect(result.max).toBe('2');
        expect(result.temperature).toBe(1.5);
    });
});
