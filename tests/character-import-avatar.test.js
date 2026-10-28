import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import zlib from 'node:zlib';
import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';
import encode from '../src/png/encode.js';
import extract from 'png-chunks-extract';

// The import route reads the default avatar from a repo-root-relative path
const originalCwd = process.cwd();
process.env.SILLYTAVERN_PERFORMANCE_USEDISKCACHE = 'false';

/**
 * Builds a plain opaque PNG of the given size.
 * @param {number} width
 * @param {number} height
 * @returns {Buffer}
 */
function makePng(width, height) {
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0);
    header.writeUInt32BE(height, 4);
    header.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA, no interlace
    const row = Buffer.alloc(1 + width * 4, 0xff);
    row[0] = 0; // filter: none
    const pixels = Buffer.concat(Array.from({ length: height }, () => row));
    return Buffer.from(encode([
        { name: 'IHDR', data: header },
        { name: 'IDAT', data: zlib.deflateSync(pixels) },
        { name: 'IEND', data: Buffer.alloc(0) },
    ]));
}

/**
 * Reads the image size from a PNG header.
 * @param {Buffer} png
 * @returns {{ width: number, height: number }}
 */
function pngSize(png) {
    const header = Buffer.from(extract(png).find(chunk => chunk.name === 'IHDR').data);
    return { width: header.readUInt32BE(0), height: header.readUInt32BE(4) };
}

describe('Character import without an image', () => {
    /** @type {import('node:http').Server} */
    let server;
    let baseUrl;
    let tempDir;
    let directories;
    let read;

    beforeAll(async () => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'st-import-'));
        directories = {
            root: tempDir,
            characters: path.join(tempDir, 'characters'),
            chats: path.join(tempDir, 'chats'),
            userImages: path.join(tempDir, 'user', 'images'),
            thumbnailsAvatar: path.join(tempDir, 'thumbnails', 'avatar'),
        };
        for (const directory of Object.values(directories)) {
            fs.mkdirSync(directory, { recursive: true });
        }

        const { setConfigFilePath } = await import('../src/util.js');
        setConfigFilePath('../default/config.yaml');
        process.chdir(path.resolve(originalCwd, '..'));

        ({ read } = await import('../src/character-card-parser.js'));
        const { default: express } = await import('express');
        const { default: multer } = await import('multer');
        const { router } = await import('../src/endpoints/characters.js');
        const app = express();
        app.use(multer({ dest: path.join(tempDir, 'uploads') }).single('avatar'));
        app.use((req, _res, next) => {
            req.user = { profile: { handle: 'default-user' }, directories };
            next();
        });
        app.use(router);
        server = app.listen(0, '127.0.0.1');
        await new Promise(resolve => server.once('listening', resolve));
        const address = server.address();
        baseUrl = `http://127.0.0.1:${address.port}`;
    });

    afterAll(async () => {
        process.chdir(originalCwd);
        delete process.env.SILLYTAVERN_PERFORMANCE_USEDISKCACHE;
        if (server) {
            await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        }
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    /**
     * Posts a v1 JSON card to the import route.
     * @param {string} name Character name
     * @param {string} [preservedName] Existing file to replace
     * @returns {Promise<Response>}
     */
    async function importJson(name, preservedName) {
        const formData = new FormData();
        formData.append('avatar', new Blob([JSON.stringify({ name, description: 'Updated description' })], { type: 'application/json' }), `${name}.json`);
        formData.append('file_type', 'json');
        if (preservedName) {
            formData.append('preserved_name', preservedName);
        }
        return await fetch(`${baseUrl}/import`, { method: 'POST', body: formData });
    }

    test('keeps the current avatar when replacing a character with a JSON file', async () => {
        const avatarPath = path.join(directories.characters, 'Alice.png');
        fs.writeFileSync(avatarPath, makePng(64, 96));

        const response = await importJson('Alice', 'Alice.png');

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ file_name: 'Alice' });
        const card = fs.readFileSync(avatarPath);
        expect(pngSize(card)).toEqual({ width: 64, height: 96 });
        expect(JSON.parse(read(card)).data.description).toBe('Updated description');
    });

    test('still uses the default avatar for a new character', async () => {
        const response = await importJson('Bob');

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ file_name: 'Bob' });
        const card = fs.readFileSync(path.join(directories.characters, 'Bob.png'));
        expect(pngSize(card)).toEqual(pngSize(fs.readFileSync('./public/img/ai4.png')));
    });
});
