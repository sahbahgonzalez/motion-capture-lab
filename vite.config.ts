import { defineConfig } from 'vite'
import path from 'path'
import { readFileSync } from 'node:fs'

function installedVersion(name: string): string | null {
  try { return JSON.parse(readFileSync(path.resolve(__dirname, 'node_modules', name, 'package.json'), 'utf8')).version ?? null }
  catch { return null }
}
const buildMetadata = {
  compiledAt: new Date().toISOString(),
  mediaPipeVersion: installedVersion('@mediapipe/tasks-vision'),
  matrixLibraryVersion: installedVersion('ml-matrix'),
}

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'


function figmaAssetResolver() {
  return {
    name: 'figma-asset-resolver',
    resolveId(id) {
      if (id.startsWith('figma:asset/')) {
        const filename = id.replace('figma:asset/', '')
        return path.resolve(__dirname, 'src/assets', filename)
      }
    },
  }
}

export default defineConfig({
  define: { 'import.meta.env.VITE_RUNTIME_BUILD_METADATA': JSON.stringify(buildMetadata) },
  plugins: [
    figmaAssetResolver(),
    // The React and Tailwind plugins are both required for Make, even if
    // Tailwind is not being actively used – do not remove them
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src/app'),
    },
  },
})
