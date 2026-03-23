<template>
  <div class="app-layout">
    <!-- Header -->
    <div class="app-header">
      <span class="app-title">UDS Tool</span>
      <div class="connection-status">
        <el-tag :type="connected ? 'success' : 'danger'" size="small">
          {{ connected ? 'Connected' : 'Disconnected' }}
        </el-tag>
      </div>
    </div>

    <!-- Connection bar -->
    <ConnectionBar @connection-changed="onConnectionChanged" />

    <!-- Main tabs -->
    <el-tabs v-model="activeTab" class="main-tabs">
      <el-tab-pane label="DID Read/Write" name="did">
        <DIDView />
      </el-tab-pane>
      <el-tab-pane label="DTC" name="dtc">
        <DTCView />
      </el-tab-pane>
      <el-tab-pane label="Flash" name="flash">
        <FlashView />
      </el-tab-pane>
      <el-tab-pane label="Sequence" name="sequence">
        <SequenceView />
      </el-tab-pane>
    </el-tabs>

    <!-- Log panel -->
    <div class="log-panel">
      <div class="log-header">
        <span>Log</span>
        <el-button size="small" text @click="clearLog">Clear</el-button>
      </div>
      <div ref="logEl" class="log-content">
        <div
          v-for="(entry, i) in logEntries"
          :key="i"
          :class="['log-entry', `log-${entry.level}`]"
        >
          <span class="log-time">{{ entry.time }}</span>
          <span class="log-msg">{{ entry.msg }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, provide, nextTick } from 'vue'
import ConnectionBar from './components/ConnectionBar.vue'
import DIDView from './views/DIDView.vue'
import DTCView from './views/DTCView.vue'
import FlashView from './views/FlashView.vue'
import SequenceView from './views/SequenceView.vue'

const activeTab = ref('did')
const connected = ref(false)
const logEl = ref<HTMLElement>()

interface LogEntry {
  time: string
  level: 'info' | 'success' | 'error' | 'warn'
  msg: string
}

const logEntries = ref<LogEntry[]>([])

function addLog(level: LogEntry['level'], msg: string) {
  const now = new Date()
  const time = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}.${now.getMilliseconds().toString().padStart(3, '0')}`
  logEntries.value.push({ time, level, msg })
  if (logEntries.value.length > 500) logEntries.value.shift()
  nextTick(() => {
    if (logEl.value) logEl.value.scrollTop = logEl.value.scrollHeight
  })
}

function clearLog() {
  logEntries.value = []
}

function onConnectionChanged(isConnected: boolean) {
  connected.value = isConnected
  addLog(isConnected ? 'success' : 'warn', isConnected ? 'Connected to device' : 'Disconnected')
}

// Provide global log function and connection state to child components
provide('addLog', addLog)
provide('connected', connected)
</script>

<style>
* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  background: #f0f2f5;
  color: #1f2937;
  overflow: hidden;
}

.app-layout {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
}

.app-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  background: #1d3557;
  color: white;
  height: 44px;
  flex-shrink: 0;
}

.app-title {
  font-size: 16px;
  font-weight: 600;
  letter-spacing: 0.5px;
}

.main-tabs {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  padding: 0 12px;
}

.main-tabs .el-tabs__content {
  flex: 1;
  overflow-y: auto;
  padding: 12px 0;
}

.log-panel {
  height: 160px;
  flex-shrink: 0;
  border-top: 1px solid #e5e7eb;
  background: #1a1a2e;
  display: flex;
  flex-direction: column;
}

.log-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 10px;
  background: #16213e;
  color: #9ca3af;
  font-size: 12px;
}

.log-content {
  flex: 1;
  overflow-y: auto;
  padding: 4px 10px;
  font-family: 'Courier New', monospace;
  font-size: 12px;
  line-height: 1.6;
}

.log-entry {
  display: flex;
  gap: 10px;
}

.log-time {
  color: #4b5563;
  flex-shrink: 0;
}

.log-info .log-msg {
  color: #9ca3af;
}
.log-success .log-msg {
  color: #34d399;
}
.log-error .log-msg {
  color: #f87171;
}
.log-warn .log-msg {
  color: #fbbf24;
}
</style>
