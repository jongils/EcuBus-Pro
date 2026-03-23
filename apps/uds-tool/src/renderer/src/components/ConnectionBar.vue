<template>
  <div class="conn-bar">
    <el-select
      v-model="selectedDevice"
      placeholder="Select device"
      size="small"
      style="width: 200px"
      :loading="loadingDevices"
      @focus="refreshDevices"
    >
      <el-option
        v-for="d in devices"
        :key="d.id"
        :label="d.label"
        :value="d.id"
        :data-type="d.type"
      />
    </el-select>

    <el-divider direction="vertical" />

    <span class="label">TX ID</span>
    <el-input v-model="txIdHex" size="small" style="width: 90px" placeholder="0x7E0" />

    <span class="label">RX ID</span>
    <el-input v-model="rxIdHex" size="small" style="width: 90px" placeholder="0x7E8" />

    <span class="label">P2 (ms)</span>
    <el-input-number
      v-model="p2Timeout"
      :min="100"
      :max="10000"
      :step="100"
      size="small"
      style="width: 110px"
    />

    <el-divider direction="vertical" />

    <el-button
      v-if="!connected"
      type="primary"
      size="small"
      :loading="connecting"
      @click="connect"
    >
      Connect
    </el-button>
    <el-button v-else type="danger" size="small" @click="disconnect">Disconnect</el-button>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'

const emit = defineEmits<{ connectionChanged: [connected: boolean] }>()

const api = (window as any).udsApi

interface Device {
  id: string
  label: string
  type: string
  channel?: string
}

const devices = ref<Device[]>([])
const selectedDevice = ref('')
const txIdHex = ref('0x7E0')
const rxIdHex = ref('0x7E8')
const p2Timeout = ref(2000)
const connected = ref(false)
const connecting = ref(false)
const loadingDevices = ref(false)

function parseHexId(s: string): number {
  const clean = s.replace(/^0[xX]/, '').replace(/\s/g, '')
  const n = parseInt(clean, 16)
  if (isNaN(n)) throw new Error(`Invalid CAN ID: ${s}`)
  return n
}

async function refreshDevices() {
  loadingDevices.value = true
  try {
    devices.value = await api.listDevices()
    if (devices.value.length && !selectedDevice.value) {
      selectedDevice.value = devices.value[0].id
    }
  } finally {
    loadingDevices.value = false
  }
}

async function connect() {
  if (!selectedDevice.value) {
    ElMessage.warning('Please select a device')
    return
  }

  connecting.value = true
  try {
    const device = devices.value.find((d) => d.id === selectedDevice.value)
    if (!device) throw new Error('Device not found')

    const txId = parseHexId(txIdHex.value)
    const rxId = parseHexId(rxIdHex.value)

    const result = await api.connect({
      deviceId: device.id,
      deviceType: device.type,
      channel: device.channel,
      txId,
      rxId,
      p2TimeoutMs: p2Timeout.value
    })

    if (result.success) {
      connected.value = true
      emit('connectionChanged', true)
      ElMessage.success('Connected successfully')
    } else {
      ElMessage.error(result.errorMsg || 'Connection failed')
    }
  } catch (e: any) {
    ElMessage.error(e.message || 'Connection failed')
  } finally {
    connecting.value = false
  }
}

async function disconnect() {
  await api.disconnect()
  connected.value = false
  emit('connectionChanged', false)
  ElMessage.info('Disconnected')
}

onMounted(refreshDevices)
</script>

<style scoped>
.conn-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: white;
  border-bottom: 1px solid #e5e7eb;
  flex-shrink: 0;
  flex-wrap: wrap;
}

.label {
  font-size: 12px;
  color: #6b7280;
  flex-shrink: 0;
}
</style>
