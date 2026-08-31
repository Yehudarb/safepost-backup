import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

function appEntryRewrite() {
    return {
        name: 'safepost-app-entry-rewrite',
        configureServer(server) {
            server.middlewares.use((req, _res, next) => {
                if (req.url === '/app') req.url = '/app/index.html'
                next()
            })
        },
        configurePreviewServer(server) {
            server.middlewares.use((req, _res, next) => {
                if (req.url === '/app') req.url = '/app/index.html'
                next()
            })
        },
    }
}

export default defineConfig({
    plugins: [react(), appEntryRewrite()],
    resolve: {
        alias: {
            '@': resolve(__dirname, './src'),
        },
    },
    build: {
        outDir: 'dist',
        rollupOptions: {
            input: {
                // Public marketing page at "/" and the React dashboard at "/app".
                // Two separate entries so the landing page ships without the
                // dashboard's ~600kB bundle (and vice versa).
                landing: resolve(__dirname, 'index.html'),
                dashboard: resolve(__dirname, 'app/index.html')
            }
        }
    }
})
