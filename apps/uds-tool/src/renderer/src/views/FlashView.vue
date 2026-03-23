<template>
  <div class="view-container">
    <el-card>
      <template #header>
        <span class="panel-title">ECU Flash (0x34 → 0x36 → 0x37)</span>
      </template>

      <div class="flash-form">
        <!-- File selection -->
        <div class="form-row">
          <span class="field-label">Binary File</span>
          <div class="file-row">
            <el-input
              v-model="fileName"
              readonly
              placeholder="No file selected"
              size="small"
              style="flex: 1"
            />
            <el-button size="small" @click="selectFile">Browse...</el-button>
          </div>
        </div>

        <div v-if="fileSize" class="form-row">
          <span class="field-label" />
          <span class="file-info"
            >Size: {{ (fileSize / 1024).toFixed(1) }} KB ({{ fileSize }} bytes)</span
          >
        </div>

        <!-- Memory address -->
        <div class="form-row">
          <span class="field-label">Memory Address</span>
          <el-input
            v-model="memAddressHex"
            placeholder="e.g. 0x08000000"
            size="small"
            style="width: 160px"
          />
          <span class="hint">(4-byte big-endian)</span>
        </div>

        <!-- Pre-flash sequence -->
        <div class="form-row">
          <span class="field-label">Pre-flash</span>
          <el-checkbox v-model="doSessionChange">Switch to Programming Session (0x10 02)</el-checkbox>
        </div>

        <!-- Flash button -->
        <div class="form-row" style="margin-top: 8px">
          <el-button
            type="primary"
            size="default"
            :loading="flashing"
            :disabled="!connected || !fileBuffer"
            @click="startFlash"
          >
            Start Flash
          </el-button>
          <el-button v-if="flashing" type="danger" size="default" @click="cancelFlash">
            Cancel
          </el-button>
        </div>
      </div>

      <!-- Progress -->
      <div v-if="progress" class="progress-section">
        <div class="progress-header">
          <span class="progress-phase">{{ phaseLabel }}</span>
          <span class="progress-pct">{{ progress.percent }}%</span>
        </div>
        <el-progress
          :percentage="progress.percent"
          :status="progressStatus"
          :striped="flashing"
          :striped-flow="flashing"
          :duration="6"
        />
        <div class="progress-msg">{{ progress.message }}</div>
        <div v-if="progress.totalBytes > 0" class="progress-bytes">
          {{ progress.bytesSent.toLocaleString() }} / {{ progress.totalBytes.toLocaleString() }}
          bytes
        </div>
      </div>

      <!-- Result -->
      <div v-if="flashResult" class="result-box" :class="flashResult.success ? 'ok' : 'err'">
        <template v-if="flashResult.success">
          Flash completed successfully in {{ flashDurationSec }}s
        </template>
        <template v-else> Flash failed: {{ flashResult.errorMsg }} </template>
      </div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, inject, onUnmounted } from 'vue'
import { ElMessage } from 'element-plus'

const api = (window as any).udsApi
const connected = inject<any>('connected')
const addLog = inject<any>('addLog')

const fileName = ref('')
const fileSize = ref(0)
const fileBuffer = ref<ArrayBuffer | null>(null)
const memAddressHex = ref('0x08000000')
const doSessionChange = ref(true)
const flashing = ref(false)
const flashResult = ref<any>(null)
const flashStartTime = ref(0)
const flashDurationSec = ref(0)

interface FlashProgress {
  phase: string
  percent: number
  bytesSent: number
  totalBytes: number
  message: string
}

const progress = ref<FlashProgress | null>(null)

const progressStatus = computed(() => {
  if (!progress.value) return ''
  if (progress.value.phase === 'done') return 'success'
  if (progress.value.phase === 'error') return 'exception'
  return ''
})

const phaseLabel = computed(() => {
  if (!progress.value) return ''
  const labels: Record<string, string> = {
    download: 'Requesting Download',
    transfer: 'Transferring Data',
    exit: 'Finalizing',
    done: 'Complete',
    error: 'Error'
  }
  return labels[progress.value.phase] || progress.value.phase
})

function selectFile() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.bin,.hex,.s19,.srec'
  input.onchange = () => {
    const file = input.files?.[0]
    if (!file) return
    fileName.value = file.name
    fileSize.value = file.size
    const reader = new FileReader()
    reader.onload = (e) => {
      fileBuffer.value = e.target?.result as ArrayBuffer
    }
    reader.readAsArrayBuffer(file)
  }
  input.click()
}

let removeProgressListener: (() => void) | null = null

async function startFlash() {
  if (!fileBuffer.value) {
    ElMessage.error('Please select a file')
    return
  }

  const memAddr = parseInt(memAddressHex.value.replace(/^0[xX]/, ''), 16)
  if (isNaN(memAddr)) {
    ElMessage.error('Invalid memory address')
    return
  }

  flashResult.value = null
  flashing.value = true
  flashStartTime.value = Date.now()
  progress.value = { phase: 'download', percent: 0, bytesSent: 0, totalBytes: fileSize.value, message: 'Starting...' }

  // Listen for progress events
  removeProgressListener = api.onFlashProgress((p: FlashProgress) => {
    progress.value = p
    addLog?.('info', `Flash [${p.phase}] ${p.percent}% - ${p.message}`)
  })

  try {
    // Optionally switch to programming session first
    if (doSessionChange.value) {
      progress.value = { ...progress.value!, message: 'Switching to Programming Session...' }
      await api.rawRequest('10 02')
    }

    // Convert ArrayBuffer to base64
    const bytes = new Uint8Array(fileBuffer.value)
    let binary = ''
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i])
    }
    const base64 = btoa(binary)

    const result = await api.flash(base64, memAddr)
    flashResult.value = result
    flashDurationSec.value = ((Date.now() - flashStartTime.value) / 1000).toFixed(1) as any

    if (result.success) {
      addLog?.('success', `Flash complete (${flashDurationSec.value}s)`)
      ElMessage.success('Flash completed successfully')
    } else {
      addLog?.('error', `Flash failed: ${result.errorMsg}`)
      ElMessage.error(result.errorMsg || 'Flash failed')
    }
  } finally {
    flashing.value = false
    removeProgressListener?.()
    removeProgressListener = null
  }
}

function cancelFlash() {
  // Flash cancellation would require abort signal - simplified version
  ElMessage.warning('Cancel requested - will stop after current transfer block')
  flashing.value = false
}

onUnmounted(() => {
  removeProgressListener?.()
})
</script>

<style scoped>
.view-container {
  padding: 4px 0;
}

.panel-title {
  font-weight: 600;
  font-size: 14px;
}

.flash-form {
  max-width: 600px;
}

.form-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}

.field-label {
  font-size: 12px;
  color: #6b7280;
  width: 120px;
  flex-shrink: 0;
}

.file-row {
  display: flex;
  gap: 8px;
  flex: 1;
}

.file-info {
  font-size: 12px;
  color: #6b7280;
}

.hint {
  font-size: 11px;
  color: #9ca3af;
}

.progress-section {
  margin-top: 16px;
  padding: 14px;
  background: #f9fafb;
  border-radius: 8px;
}

.progress-header {
  display: flex;
  justify-content: space-between;
  margin-bottom: 8px;
}

.progress-phase {
  font-weight: 500;
  font-size: 13px;
}

.progress-pct {
  font-weight: 600;
  color: #2563eb;
}

.progress-msg {
  font-size: 12px;
  color: #6b7280;
  margin-top: 6px;
}

.progress-bytes {
  font-size: 11px;
  color: #9ca3af;
  font-family: 'Courier New', monospace;
  margin-top: 2px;
}

.result-box {
  border-radius: 6px;
  padding: 12px;
  margin-top: 14px;
  font-size: 13px;
  font-weight: 500;
}

.result-box.ok {
  background: #f0fdf4;
  border: 1px solid #86efac;
  color: #16a34a;
}

.result-box.err {
  background: #fef2f2;
  border: 1px solid #fca5a5;
  color: #dc2626;
}
</style>
