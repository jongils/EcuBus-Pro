<template>
  <div class="view-container">
    <div class="two-col">
      <!-- Sequence editor -->
      <el-card class="panel">
        <template #header>
          <div class="card-header">
            <span class="panel-title">Sequence Steps</span>
            <div class="header-actions">
              <el-button size="small" @click="addStep">+ Add Step</el-button>
              <el-button size="small" type="danger" plain @click="clearSteps">Clear</el-button>
            </div>
          </div>
        </template>

        <div v-if="!steps.length" class="empty-hint">
          Add steps to build a UDS sequence
        </div>

        <div v-for="(step, idx) in steps" :key="step.id" class="step-card" :class="{ disabled: !step.enabled }">
          <div class="step-header">
            <el-checkbox v-model="step.enabled" />
            <span class="step-num">{{ idx + 1 }}</span>
            <el-input v-model="step.name" size="small" style="flex: 1" placeholder="Step name" />
            <el-button size="small" text type="danger" @click="removeStep(idx)">✕</el-button>
          </div>

          <div class="step-body">
            <div class="step-row">
              <span class="step-label">Service</span>
              <el-select v-model="step.serviceId" size="small" style="width: 200px">
                <el-option
                  v-for="svc in serviceOptions"
                  :key="svc.id"
                  :label="svc.label"
                  :value="svc.id"
                  @click="applyTemplate(step, svc)"
                />
              </el-select>
            </div>

            <div class="step-row">
              <span class="step-label">Request (hex)</span>
              <el-input
                v-model="step.requestHex"
                size="small"
                style="flex: 1"
                placeholder="e.g. 22 F1 90"
                :class="{ 'step-req': true }"
              />
            </div>

            <div class="step-row">
              <span class="step-label">Delay after (ms)</span>
              <el-input-number
                v-model="step.delayAfterMs"
                :min="0"
                :max="60000"
                :step="100"
                size="small"
                style="width: 120px"
              />
              <el-checkbox v-model="step.checkResponse" style="margin-left: 12px">
                Check response
              </el-checkbox>
            </div>
          </div>
        </div>
      </el-card>

      <!-- Results panel -->
      <el-card class="panel">
        <template #header>
          <div class="card-header">
            <span class="panel-title">Execution</span>
            <div class="header-actions">
              <el-select v-model="cycleMode" size="small" style="width: 120px">
                <el-option label="Run once" value="once" />
                <el-option label="Repeat" value="repeat" />
              </el-select>
              <el-button
                type="primary"
                size="small"
                :loading="running"
                :disabled="!connected || !steps.length"
                @click="runSequence"
              >
                Run
              </el-button>
              <el-button v-if="running" size="small" type="danger" @click="stopSequence">
                Stop
              </el-button>
            </div>
          </div>
        </template>

        <!-- Run summary -->
        <div v-if="results.length" class="run-summary">
          <el-tag type="success" size="small">{{ passCount }} Passed</el-tag>
          <el-tag type="danger" size="small" style="margin-left: 6px">
            {{ failCount }} Failed
          </el-tag>
          <span class="run-time">{{ lastRunTime }}</span>
        </div>

        <!-- Results table -->
        <div v-if="results.length" class="results-list">
          <div
            v-for="r in results"
            :key="r.stepId"
            class="result-item"
            :class="r.success ? 'ok' : 'err'"
          >
            <div class="result-top">
              <span class="result-icon">{{ r.success ? '✓' : '✗' }}</span>
              <span class="result-name">{{ r.stepName }}</span>
              <span class="result-dur">{{ r.durationMs }}ms</span>
            </div>
            <div class="result-detail">
              <span class="detail-label">REQ:</span>
              <code>{{ r.requestHex }}</code>
            </div>
            <div v-if="r.responseHex" class="result-detail">
              <span class="detail-label">RSP:</span>
              <code>{{ r.responseHex }}</code>
            </div>
            <div v-if="r.errorMsg" class="result-error">{{ r.errorMsg }}</div>
          </div>
        </div>

        <div v-else class="empty-hint">Run a sequence to see results</div>
      </el-card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, inject, onUnmounted } from 'vue'
import { v4 as uuidv4 } from 'uuid'
import { ElMessage } from 'element-plus'

const api = (window as any).udsApi
const connected = inject<any>('connected')
const addLog = inject<any>('addLog')

interface SequenceStep {
  id: string
  name: string
  serviceId: number
  requestHex: string
  delayAfterMs: number
  checkResponse: boolean
  enabled: boolean
}

interface StepResult {
  stepId: string
  stepName: string
  success: boolean
  requestHex: string
  responseHex?: string
  errorMsg?: string
  durationMs: number
}

const steps = ref<SequenceStep[]>([])
const results = ref<StepResult[]>([])
const running = ref(false)
const cycleMode = ref('once')
const lastRunTime = ref('')
const stopFlag = ref(false)

const passCount = computed(() => results.value.filter((r) => r.success).length)
const failCount = computed(() => results.value.filter((r) => !r.success).length)

const serviceOptions = [
  { id: 0x10, label: '0x10 - DiagnosticSessionControl', template: '10 01' },
  { id: 0x11, label: '0x11 - ECUReset', template: '11 01' },
  { id: 0x22, label: '0x22 - ReadDataByIdentifier', template: '22 F1 90' },
  { id: 0x2e, label: '0x2E - WriteDataByIdentifier', template: '2E F1 90 00' },
  { id: 0x19, label: '0x19 - ReadDTCInformation', template: '19 02 FF' },
  { id: 0x14, label: '0x14 - ClearDiagnosticInfo', template: '14 FF FF FF' },
  { id: 0x27, label: '0x27 - SecurityAccess', template: '27 01' },
  { id: 0x3e, label: '0x3E - TesterPresent', template: '3E 00' },
  { id: 0x31, label: '0x31 - RoutineControl', template: '31 01 FF 00' },
  { id: 0x28, label: '0x28 - CommunicationControl', template: '28 03 01' }
]

function addStep() {
  steps.value.push({
    id: uuidv4(),
    name: `Step ${steps.value.length + 1}`,
    serviceId: 0x3e,
    requestHex: '3E 00',
    delayAfterMs: 0,
    checkResponse: true,
    enabled: true
  })
}

function removeStep(idx: number) {
  steps.value.splice(idx, 1)
}

function clearSteps() {
  steps.value = []
  results.value = []
}

function applyTemplate(step: SequenceStep, svc: { id: number; template: string }) {
  step.serviceId = svc.id
  step.requestHex = svc.template
}

let removeStepDoneListener: (() => void) | null = null

async function runSequence() {
  if (!steps.value.length) return

  results.value = []
  running.value = true
  stopFlag.value = false

  removeStepDoneListener = api.onSequenceStepDone((r: StepResult) => {
    results.value.push(r)
    addLog?.(r.success ? 'success' : 'error', `[Seq] ${r.stepName}: ${r.success ? r.responseHex : r.errorMsg}`)
  })

  try {
    do {
      const result = await api.runSequence(steps.value)
      if (result.success) {
        ElMessage.success('Sequence completed')
      } else {
        ElMessage.warning('Sequence completed with errors')
      }
    } while (cycleMode.value === 'repeat' && !stopFlag.value)

    lastRunTime.value = new Date().toLocaleTimeString()
  } finally {
    running.value = false
    removeStepDoneListener?.()
    removeStepDoneListener = null
  }
}

function stopSequence() {
  stopFlag.value = true
  running.value = false
  ElMessage.info('Sequence stopped')
}

// Default steps for demo
steps.value = [
  {
    id: uuidv4(),
    name: 'Open Extended Session',
    serviceId: 0x10,
    requestHex: '10 03',
    delayAfterMs: 100,
    checkResponse: true,
    enabled: true
  },
  {
    id: uuidv4(),
    name: 'Read VIN',
    serviceId: 0x22,
    requestHex: '22 F1 90',
    delayAfterMs: 0,
    checkResponse: true,
    enabled: true
  },
  {
    id: uuidv4(),
    name: 'Tester Present',
    serviceId: 0x3e,
    requestHex: '3E 00',
    delayAfterMs: 0,
    checkResponse: false,
    enabled: true
  }
]

onUnmounted(() => {
  removeStepDoneListener?.()
})
</script>

<style scoped>
.view-container {
  padding: 4px 0;
}

.two-col {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  height: calc(100vh - 290px);
  overflow: hidden;
}

.panel {
  overflow-y: auto;
  height: 100%;
}

.panel :deep(.el-card__body) {
  overflow-y: auto;
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.panel-title {
  font-weight: 600;
  font-size: 14px;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.empty-hint {
  color: #9ca3af;
  font-size: 13px;
  text-align: center;
  padding: 30px 0;
}

.step-card {
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  margin-bottom: 8px;
  padding: 8px;
  background: white;
}

.step-card.disabled {
  opacity: 0.5;
}

.step-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}

.step-num {
  font-size: 11px;
  color: #9ca3af;
  width: 16px;
}

.step-body {
  padding-left: 40px;
}

.step-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.step-label {
  font-size: 11px;
  color: #6b7280;
  width: 90px;
  flex-shrink: 0;
}

.run-summary {
  display: flex;
  align-items: center;
  margin-bottom: 10px;
}

.run-time {
  font-size: 12px;
  color: #9ca3af;
  margin-left: auto;
}

.results-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.result-item {
  border-radius: 6px;
  padding: 8px 10px;
  font-size: 12px;
}

.result-item.ok {
  background: #f0fdf4;
  border: 1px solid #86efac;
}

.result-item.err {
  background: #fef2f2;
  border: 1px solid #fca5a5;
}

.result-top {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}

.result-icon {
  font-weight: bold;
}

.result-item.ok .result-icon {
  color: #16a34a;
}

.result-item.err .result-icon {
  color: #dc2626;
}

.result-name {
  font-weight: 500;
  flex: 1;
}

.result-dur {
  color: #9ca3af;
  font-size: 11px;
}

.result-detail {
  display: flex;
  gap: 6px;
  margin-bottom: 2px;
}

.detail-label {
  color: #6b7280;
  width: 30px;
}

code {
  font-family: 'Courier New', monospace;
  font-size: 11px;
}

.result-error {
  color: #dc2626;
  font-size: 11px;
}
</style>
