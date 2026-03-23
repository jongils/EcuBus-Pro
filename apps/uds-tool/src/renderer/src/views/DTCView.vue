<template>
  <div class="view-container">
    <el-card>
      <template #header>
        <div class="card-header">
          <span class="panel-title">DTC Management</span>
          <div class="header-actions">
            <span class="label">Report Type</span>
            <el-select v-model="reportType" size="small" style="width: 280px">
              <el-option
                v-for="rt in reportTypes"
                :key="rt.value"
                :label="rt.label"
                :value="rt.value"
              />
            </el-select>
            <span class="label">Status Mask</span>
            <el-input
              v-model="statusMaskHex"
              size="small"
              style="width: 80px"
              placeholder="FF"
            />
            <el-button
              type="primary"
              size="small"
              :loading="readLoading"
              :disabled="!connected"
              @click="doReadDTCs"
            >
              Read DTCs
            </el-button>
            <el-button
              type="danger"
              size="small"
              :loading="clearLoading"
              :disabled="!connected || !dtcs.length"
              @click="confirmClear"
            >
              Clear All DTCs
            </el-button>
          </div>
        </div>
      </template>

      <!-- Summary -->
      <div v-if="lastReadTime" class="summary">
        <el-tag type="info" size="small">{{ dtcs.length }} DTC(s) found</el-tag>
        <span class="read-time">Last read: {{ lastReadTime }}</span>
      </div>

      <!-- DTC Table -->
      <el-table
        :data="dtcs"
        size="small"
        stripe
        style="width: 100%; margin-top: 10px"
        :empty-text="readLoading ? 'Reading...' : 'No DTCs (or not yet read)'"
      >
        <el-table-column prop="code" label="DTC Code" width="120">
          <template #default="{ row }">
            <el-tag size="small" type="danger">{{ row.code }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="codeHex" label="Hex" width="90">
          <template #default="{ row }">
            <code>{{ row.codeHex }}</code>
          </template>
        </el-table-column>
        <el-table-column label="Status Byte" width="110">
          <template #default="{ row }">
            <code>0x{{ row.status.toString(16).padStart(2, '0').toUpperCase() }}</code>
          </template>
        </el-table-column>
        <el-table-column prop="statusDescription" label="Status Flags" show-overflow-tooltip>
          <template #default="{ row }">
            <div class="status-flags">
              <el-tag
                v-for="flag in row.statusDescription.split(', ')"
                :key="flag"
                size="small"
                :type="flagType(flag)"
                style="margin: 1px"
              >
                {{ flag }}
              </el-tag>
            </div>
          </template>
        </el-table-column>
      </el-table>

      <!-- Error display -->
      <div v-if="lastError" class="error-box">{{ lastError }}</div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, inject } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'

const api = (window as any).udsApi
const connected = inject<any>('connected')
const addLog = inject<any>('addLog')

const reportType = ref(0x02)
const statusMaskHex = ref('FF')
const readLoading = ref(false)
const clearLoading = ref(false)
const lastReadTime = ref('')
const lastError = ref('')

interface DtcEntry {
  code: string
  codeHex: string
  status: number
  statusDescription: string
}

const dtcs = ref<DtcEntry[]>([])

const reportTypes = [
  { value: 0x01, label: '0x01 - reportNumberOfDTCByStatusMask' },
  { value: 0x02, label: '0x02 - reportDTCByStatusMask' },
  { value: 0x03, label: '0x03 - reportDTCSnapshotIdentification' },
  { value: 0x06, label: '0x06 - reportDTCExtendedDataRecordByDTCNumber' },
  { value: 0x0a, label: '0x0A - reportSupportedDTCs' }
]

function flagType(flag: string): 'danger' | 'warning' | 'info' {
  if (flag.includes('confirmed') || flag.includes('warningIndicator')) return 'danger'
  if (flag.includes('pending') || flag.includes('testFailed')) return 'warning'
  return 'info'
}

async function doReadDTCs() {
  readLoading.value = true
  lastError.value = ''
  dtcs.value = []

  try {
    const mask = parseInt(statusMaskHex.value, 16)
    if (isNaN(mask)) {
      ElMessage.error('Invalid status mask')
      return
    }

    const result = await api.readDTCs(reportType.value, mask)

    if (result.success) {
      dtcs.value = result.data || []
      const now = new Date()
      lastReadTime.value = now.toLocaleTimeString()
      addLog?.('success', `ReadDTCs: ${dtcs.value.length} DTC(s) found`)
    } else {
      lastError.value = result.errorMsg || 'Read failed'
      addLog?.('error', `ReadDTCs failed: ${result.errorMsg}`)
    }
  } finally {
    readLoading.value = false
  }
}

async function confirmClear() {
  try {
    await ElMessageBox.confirm(
      `This will clear all ${dtcs.value.length} DTC(s). Continue?`,
      'Confirm Clear DTCs',
      { type: 'warning', confirmButtonText: 'Clear All', cancelButtonText: 'Cancel' }
    )
    await doClearDTCs()
  } catch {
    // cancelled
  }
}

async function doClearDTCs() {
  clearLoading.value = true
  lastError.value = ''
  try {
    const result = await api.clearDTCs(0xffffff) // Clear all
    if (result.success) {
      dtcs.value = []
      lastReadTime.value = ''
      ElMessage.success('DTCs cleared successfully')
      addLog?.('success', 'ClearDTCs: All DTCs cleared')
    } else {
      lastError.value = result.errorMsg || 'Clear failed'
      ElMessage.error(result.errorMsg || 'Clear failed')
      addLog?.('error', `ClearDTCs failed: ${result.errorMsg}`)
    }
  } finally {
    clearLoading.value = false
  }
}
</script>

<style scoped>
.view-container {
  padding: 4px 0;
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
}

.panel-title {
  font-weight: 600;
  font-size: 14px;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.label {
  font-size: 12px;
  color: #6b7280;
}

.summary {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 0;
}

.read-time {
  font-size: 12px;
  color: #9ca3af;
}

.error-box {
  background: #fef2f2;
  border: 1px solid #fca5a5;
  border-radius: 6px;
  padding: 8px 12px;
  color: #dc2626;
  font-size: 13px;
  margin-top: 10px;
}

.status-flags {
  display: flex;
  flex-wrap: wrap;
}

code {
  font-family: 'Courier New', monospace;
  background: #f3f4f6;
  padding: 1px 4px;
  border-radius: 3px;
  font-size: 12px;
}
</style>
