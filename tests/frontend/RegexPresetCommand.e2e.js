import { test, expect } from '@playwright/test';
import { testSetup } from './frontent-test-utils.js';

test.describe('/regex-preset slash command', () => {
    test.beforeEach(testSetup.awaitST);

    test('finishes applying the preset before the next command runs', async ({ page }) => {
        const result = await page.evaluate(async () => {
            const { characters, chat, selectCharacterById, doNewChat } = await import('./script.js');
            const { extension_settings } = await import('./scripts/extensions.js');
            const { executeSlashCommandsWithOptions } = await import('./scripts/slash-commands.js');

            const presetId = 'e2e-regex-preset';
            const previousSelection = extension_settings.regex_presets.map(p => ({ id: p.id, isSelected: p.isSelected }));
            extension_settings.regex_presets.push({
                id: presetId,
                name: 'E2E preset',
                isSelected: false,
                global: extension_settings.regex.map(script => ({ id: script.id })),
                scoped: [],
                preset: [],
            });

            try {
                // The reload only hits the race with a real character chat, not with the neutral one
                await selectCharacterById(characters.findIndex(character => character.name === 'Seraphina'));
                await doNewChat({ deleteCurrentChat: false });
                await executeSlashCommandsWithOptions(`/send abc | /regex-preset ${presetId} | /send efg | /del 1`);
                return chat.filter(message => ['abc', 'efg'].includes(message.mes)).map(message => message.mes);
            } finally {
                const index = extension_settings.regex_presets.findIndex(p => p.id === presetId);
                if (index !== -1) {
                    extension_settings.regex_presets.splice(index, 1);
                }
                for (const { id, isSelected } of previousSelection) {
                    const preset = extension_settings.regex_presets.find(p => p.id === id);
                    if (preset) {
                        preset.isSelected = isSelected;
                    }
                }
                await executeSlashCommandsWithOptions('/delchat');
            }
        });

        expect(result).toEqual(['abc']);
    });
});
