import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import serveStatic from 'serve-static';
import type { Plugin } from 'vite';

const __dirname = url.fileURLToPath(new URL('.', import.meta.url));
const fontSourceDir = path.resolve(__dirname, '../alphatab/font');

export default function realtimeEditorAssets(): Plugin {
    let outDir = '';

    return {
        name: 'realtime-editor-assets',
        configResolved(config) {
            outDir = path.resolve(config.root, config.build.outDir);
        },
        configureServer(server) {
            server.middlewares.use('/font', serveStatic(fontSourceDir));
        },
        closeBundle() {
            if (!outDir) {
                return;
            }

            fs.mkdirSync(outDir, { recursive: true });
            fs.cpSync(fontSourceDir, path.join(outDir, 'font'), { recursive: true });
        }
    };
}
