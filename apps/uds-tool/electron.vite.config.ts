import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'

// Path to EcuBus-Pro's main source directory (shared code)
const ECUBUS_MAIN = resolve(__dirname, '../../src/main')

export default defineConfig({
  main: {
    resolve: {
      alias: [
        // ── EcuBus-Pro dependency stubs ───────────────────────────────────
        // Replace the heavy winston-based CanLOG with a console-only stub
        {
          find: /.*[/\\]src[/\\]main[/\\]log$/,
          replacement: resolve(__dirname, 'src/main/stubs/ecubus-log')
        },
        // Replace NodeClass with a no-op stub
        {
          find: /.*[/\\]src[/\\]main[/\\]nodeItem$/,
          replacement: resolve(__dirname, 'src/main/stubs/node-item')
        },
        // Provide the 'nodeCan' path alias that EcuBus-Pro uses internally
        {
          find: 'nodeCan',
          replacement: resolve(ECUBUS_MAIN, 'share')
        }
      ]
    },
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [vue()]
  }
})
