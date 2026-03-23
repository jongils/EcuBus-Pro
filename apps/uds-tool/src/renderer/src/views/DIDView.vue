<template>
  <div class="view-container">
    <div class="two-col">
      <!-- Read DID -->
      <el-card class="panel">
        <template #header>
          <span class="panel-title">Read DID (0x22)</span>
        </template>

        <div class="form-row">
          <span class="field-label">DID (hex)</span>
          <el-input
            v-model="readDidHex"
            placeholder="e.g. F190"
            style="width: 130px"
            size="small"
          />
          <el-button
            type="primary"
            size="small"
            :loading="readLoading"
            :disabled="!connected"
            @click="doReadDID"
          >
            Read
          </el-button>
        </div>

        <div v-if="readResult" class="result-box" :class="readResult.success ? 'ok' : 'err'">
          <template v-if="readResult.success">
            <div class="result-row">
              <b>DID:</b> 0x{{ readResult.data?.did.toString(16).toUpperCase().padStart(4, '0') }}
            </div>
            <div class="result-row">
              <b>Data (HEX):</b>
              <code>{{ readResult.data?.dataHex }}</code>
            </div>
            <div class="result-row">
              <b>Data (ASCII):</b>
              <code>{{ readResult.data?.dataAscii }}</code>
            </div>
            <div class="result-row raw"><b>Raw:</b> {{ readResult.raw }}</div>
          </template>
          <template v-else>
            <div class="error-msg">{{ readResult.errorMsg }}</div>
          </template>
        </div>

        <!-- DID History -->
        <div v-if="readHistory.length" class="history">
          <div class="history-title">History</div>
          <el-table :data="readHistory" size="small" max-height="200">
            <el-table-column prop="didHex" label="DID" width="70" />
            <el-table-column prop="dataHex" label="Data" show-overflow-tooltip />
            <el-table-column prop="time" label="Time" width="90" />
          </el-table>
        </div>
      </el-card>

      <!-- Write DID -->
      <el-card class="panel">
        <template #header>
          <span class="panel-title">Write DID (0x2E)</span>
        </template>

        <div class="form-row">
          <span class="field-label">DID (hex)</span>
          <el-input
            v-model="writeDidHex"
            placeholder="e.g. F190"
            style="width: 130px"
            size="small"
          />
        </div>

        <div class="form-row">
          <span class="field-label">Value (hex)</span>
          <el-input
            v-model="writeValueHex"
            placeholder="e.g. 01 02 03 04"
            style="flex: 1"
            size="small"
          />
        </div>

        <div class="form-row">
          <el-button
            type="warning"
            size="small"
            :loading="writeLoading"
            :disabled="!connected"
            @click="doWriteDID"
          >
            Write
          </el-button>
        </div>

        <div v-if="writeResult" class="result-box" :class="writeResult.success ? 'ok' : 'err'">
          <template v-if="writeResult.success">
            <div class="success-msg">Write successful</div>
            <div class="result-row raw"><b>Raw:</b> {{ writeResult.raw }}</div>
          </template>
          <template v-else>
            <div class="error-msg">{{ writeResult.errorMsg }}</div>
          </template>
        </div>

        <!-- Quick presets -->
        <div class="presets">
          <div class="presets-title">Common DIDs</div>
          <div class="preset-list">
            <el-tag
              v-for="p in commonDIDs"
              :key="p.did"
              size="small"
              class="preset-tag"
              @click="applyPreset(p)"
            >
              {{ p.label }} ({{ p.did }})
            </el-tag>
          </div>
        </div>
      </el-card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, inject } from 'vue'
import { ElMessage } from 'element-plus'

const api = (window as any).udsApi
const connected = inject<any>('connected')
const addLog = inject<any>('addLog')

const readDidHex = ref('F190')
const readLoading = ref(false)
const readResult = ref<any>(null)

const writeDidHex = ref('F190')
const writeValueHex = ref('')
const writeLoading = ref(false)
const writeResult = ref<any>(null)

interface HistoryEntry {
  didHex: string
  dataHex: string
  time: string
}
const readHistory = ref<HistoryEntry[]>([])

const commonDIDs = [
  { did: 'F190', label: 'VIN' },
  { did: 'F186', label: 'Active Session' },
  { did: 'F187', label: 'Spare Part Number' },
  { did: 'F189', label: 'ECU Software Version' },
  { did: 'F18A', label: 'System Supplier ECU Hardware Number' },
  { did: 'F18C', label: 'ECU Serial Number' }
]

function parseHex(s: string): number {
  return parseInt(s.replace(/^0[xX]/, ''), 16)
}

async function doReadDID() {
  const did = parseHex(readDidHex.value)
  if (isNaN(did)) {
    ElMessage.error('Invalid DID hex value')
    return
  }

  readLoading.value = true
  readResult.value = null
  try {
    const result = await api.readDID(did)
    readResult.value = result
    addLog?.(result.success ? 'success' : 'error', `ReadDID 0x${readDidHex.value}: ${result.success ? result.data?.dataHex : result.errorMsg}`)

    if (result.success) {
      const now = new Date()
      readHistory.value.unshift({
        didHex: '0x' + did.toString(16).toUpperCase().padStart(4, '0'),
        dataHex: result.data?.dataHex || '',
        time: `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`
      })
      if (readHistory.value.length > 20) readHistory.value.pop()
    }
  } finally {
    readLoading.value = false
  }
}

async function doWriteDID() {
  const did = parseHex(writeDidHex.value)
  if (isNaN(did)) {
    ElMessage.error('Invalid DID hex value')
    return
  }
  if (!writeValueHex.value.trim()) {
    ElMessage.error('Please enter a value to write')
    return
  }

  writeLoading.value = true
  writeResult.value = null
  try {
    const result = await api.writeDID(did, writeValueHex.value)
    writeResult.value = result
    addLog?.(result.success ? 'success' : 'error', `WriteDID 0x${writeDidHex.value}: ${result.success ? 'OK' : result.errorMsg}`)
  } finally {
    writeLoading.value = false
  }
}

function applyPreset(p: { did: string; label: string }) {
  readDidHex.value = p.did
  writeDidHex.value = p.did
}
</script>

<style scoped>
.view-container {
  padding: 4px 0;
}

.two-col {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.panel-title {
  font-weight: 600;
  font-size: 14px;
}

.form-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}

.field-label {
  font-size: 12px;
  color: #6b7280;
  width: 80px;
  flex-shrink: 0;
}

.result-box {
  border-radius: 6px;
  padding: 10px;
  margin-top: 10px;
  font-size: 13px;
}

.result-box.ok {
  background: #f0fdf4;
  border: 1px solid #86efac;
}

.result-box.err {
  background: #fef2f2;
  border: 1px solid #fca5a5;
}

.result-row {
  margin-bottom: 4px;
}

.result-row code {
  background: #f3f4f6;
  padding: 1px 4px;
  border-radius: 3px;
  font-family: 'Courier New', monospace;
}

.result-row.raw {
  color: #6b7280;
  font-size: 11px;
  font-family: 'Courier New', monospace;
}

.error-msg {
  color: #dc2626;
}

.success-msg {
  color: #16a34a;
  font-weight: 500;
  margin-bottom: 4px;
}

.history {
  margin-top: 12px;
}

.history-title {
  font-size: 12px;
  color: #6b7280;
  margin-bottom: 6px;
}

.presets {
  margin-top: 14px;
  border-top: 1px solid #f3f4f6;
  padding-top: 10px;
}

.presets-title {
  font-size: 12px;
  color: #6b7280;
  margin-bottom: 6px;
}

.preset-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.preset-tag {
  cursor: pointer;
}
</style>
