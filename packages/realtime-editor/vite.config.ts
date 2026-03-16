import path from 'node:path';
import url from 'node:url';
import { defineConfig } from 'vite';
import tsconfigPaths from 'vite-tsconfig-paths';
import realtimeEditorAssets from './vite.plugin.assets';

const __dirname = url.fileURLToPath(new URL('.', import.meta.url));

const workspaceAliases = [
    {
        find: /^@coderline\/alphatab$/,
        replacement: path.resolve(__dirname, '../alphatab/src/alphaTab.main.ts')
    },
    {
        find: /^@coderline\/alphatab\/(.*)$/,
        replacement: `${path.resolve(__dirname, '../alphatab/src')}/$1`
    },
    {
        find: /^@coderline\/alphatab-monaco$/,
        replacement: path.resolve(__dirname, '../monaco/src/alphaTab.monaco.ts')
    },
    {
        find: /^@coderline\/alphatab-monaco\/(.*)$/,
        replacement: `${path.resolve(__dirname, '../monaco/src')}/$1`
    },
    {
        find: /^@coderline\/alphatab-language-server$/,
        replacement: path.resolve(__dirname, '../lsp/src/index.ts')
    },
    {
        find: /^@coderline\/alphatab-language-server\/(.*)$/,
        replacement: `${path.resolve(__dirname, '../lsp/src')}/$1`
    },
    {
        find: /^@coderline\/alphatab-alphatex\/(.*)$/,
        replacement: `${path.resolve(__dirname, '../alphatex/src')}/$1`
    }
] as const;

export default defineConfig({
    resolve: {
        alias: workspaceAliases
    },
    plugins: [tsconfigPaths(), realtimeEditorAssets()],
    server: {
        open: '/'
    },
    build: {
        rollupOptions: {
            output: {
                manualChunks(id) {
                    // Monaco Editor 核心（约 2MB+）
                    if (id.includes('monaco-editor') || id.includes('vscode-')) {
                        return 'vendor-monaco';
                    }
                    // alphaTab 核心引擎（乐谱解析、渲染、播放）
                    if (
                        id.includes('/packages/alphatab/') ||
                        id.includes('/packages/lsp/') ||
                        id.includes('/packages/monaco/') ||
                        id.includes('/packages/alphatex/')
                    ) {
                        return 'vendor-alphatab';
                    }
                    // 字体资源
                    if (id.includes('@fontsource/')) {
                        return 'vendor-fonts';
                    }
                    return undefined;
                }
            }
        }
    }
});
