<template>
  <div class="conn-bar">
    <!-- Device selector -->
    <el-select
      v-model="selectedDeviceId"
      placeholder="Select device"
      size="small"
      style="width: 220px"
      :loading="loadingDevices"
      @focus="refreshDevices"
      @change="onDeviceChange"
    >
      <el-option-group v-for="group in deviceGroups" :key="group.label" :label="group.label">
        <el-option
          v-for="d in group.devices"
          :key="d.id"
          :label="d.label"
          :value="d.id"
        >
          <span :class="`hw-icon hw-${d.type}`">{{ hwIcon(d.type) }}</span>
          {{ d.label }}
        </el-option>
      </el-option-group>
    </el-select>

    <el-divider direction="vertical" />

    <!-- SocketCAN: channel + bitrate + setup button -->
    <template v-if="selectedDevice?.type === 'socketcan'">
      <span class="label">Interface</span>
      <el-input
        v-model="socketCanChannel"
        size="small"
        style="width: 80px"
        placeholder="can0"
        @blur="syncFromDevice"
      />
      <span class="label">Bitrate</span>
      <el-select v-model="bitrate" size="small" style="width: 110px">
        <el-option v-for="b in bitrateOptions" :key="b.value" :label="b.label" :value="b.value" />
      </el-select>
      <el-tooltip content="Setup CAN interface (requires sudo)" placement="bottom">
        <el-button size="small" :loading="settingUp" @click="setupSocketCan">Setup</el-button>
      </el-tooltip>
    </template>

    <!-- PEAK: channel handle shown, bitrate select, optional CAN-FD -->
    <template v-else-if="selectedDevice?.type === 'peak'">
      <span class="label">Bitrate</span>
      <el-select v-model="bitrate" size="small" style="width: 110px">
        <el-option v-for="b in bitrateOptions" :key="b.value" :label="b.label" :value="b.value" />
      </el-select>
      <el-checkbox v-model="canFd" size="small" style="margin-left: 6px">CAN-FD</el-checkbox>
    </template>

    <el-divider direction="vertical" />

    <!-- TX / RX IDs -->
    <span class="label">TX ID</span>
    <el-input v-model="txIdHex" size="small" style="width: 82px" placeholder="0x7E0" />
    <span class="label">RX ID</span>
    <el-input v-model="rxIdHex" size="small" style="width: 82px" placeholder="0x7E8" />

    <!-- P2 timeout -->
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

    <!-- Connect / Disconnect -->
    <el-button
      v-if="!connected"
      type="primary"
      size="small"
      :loading="connecting"
      :disabled="!selectedDeviceId"
      @click="connect"
    >
      Connect
    </el-button>
    <el-button v-else type="danger" size="small" @click="disconnect">Disconnect</el-button>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'

const emit = defineEmits<{ connectionChanged: [connected: boolean] }>()

const api = (window as any).udsApi

interface Device {
  id: string
  label: string
  type: 'simulate' | 'socketcan' | 'peak'
  channel?: string
  handle?: number
}

// ── State ────────────────────────────────────────────────────────────────────
const devices = ref<Device[]>([])
const selectedDeviceId = ref('')
const txIdHex = ref('0x7E0')
const rxIdHex = ref('0x7E8')
const p2Timeout = ref(2000)
const bitrate = ref('500000')
const canFd = ref(false)
const socketCanChannel = ref('can0')
const connected = ref(false)
const connecting = ref(false)
const loadingDevices = ref(false)
const settingUp = ref(false)

const bitrateOptions = [
  { label: '1 Mbit/s', value: '1000000' },
  { label: '800 kbit/s', value: '800000' },
  { label: '500 kbit/s', value: '500000' },
  { label: '250 kbit/s', value: '250000' },
  { label: '125 kbit/s', value: '125000' },
  { label: '100 kbit/s', value: '100000' },
  { label: '50 kbit/s', value: '50000' }
]

// ── Computed ─────────────────────────────────────────────────────────────────
const selectedDevice = computed<Device | undefined>(() =>
  devices.value.find((d) => d.id === selectedDeviceId.value)
)

const deviceGroups = computed(() => {
  const groups: Record<string, { label: string; devices: Device[] }> = {
    simulate: { label: 'Simulate (no hardware)', devices: [] },
    socketcan: { label: 'SocketCAN (Linux)', devices: [] },
    peak: { label: 'PEAK CAN', devices: [] }
  }
  for (const d of devices.value) {
    const key = d.type as keyof typeof groups
    if (groups[key]) groups[key].devices.push(d)
  }
  return Object.values(groups).filter((g) => g.devices.length > 0)
})

// ── Helpers ───────────────────────────────────────────────────────────────────
function hwIcon(type: string): string {
  return type === 'simulate' ? '⚙' : type === 'socketcan' ? '🔌' : '📡'
}

function parseHexId(s: string): number {
  const n = parseInt(s.replace(/^0[xX]/, ''), 16)
  if (isNaN(n) || n < 0 || n > 0x1fffffff) throw new Error(`Invalid CAN ID: ${s}`)
  return n
}

// ── Methods ───────────────────────────────────────────────────────────────────
async function refreshDevices() {
  loadingDevices.value = true
  try {
    devices.value = await api.listDevices()
    // Auto-select first device
    if (devices.value.length && !selectedDeviceId.value) {
      selectedDeviceId.value = devices.value[0].id
      onDeviceChange()
    }
  } finally {
    loadingDevices.value = false
  }
}

function onDeviceChange() {
  const d = selectedDevice.value
  if (!d) return
  if (d.type === 'socketcan' && d.channel) {
    socketCanChannel.value = d.channel
  }
}

function syncFromDevice() {
  // Sync socketCanChannel back into selected device
  const d = selectedDevice.value
  if (d?.type === 'socketcan') {
    d.channel = socketCanChannel.value
    d.id = `socketcan-${socketCanChannel.value}`
    d.label = `SocketCAN  ${socketCanChannel.value}`
  }
}

async function setupSocketCan() {
  const iface = socketCanChannel.value
  if (!iface) {
    ElMessage.error('Enter an interface name (e.g. can0)')
    return
  }
  settingUp.value = true
  try {
    const result = await api.socketCanSetup(iface, bitrate.value)
    if (result.success) {
      ElMessage.success(`${iface} is up at ${bitrate.value} bps`)
    } else {
      ElMessage.error(`Setup failed: ${result.output}`)
    }
  } finally {
    settingUp.value = false
  }
}

async function connect() {
  const device = selectedDevice.value
  if (!device) {
    ElMessage.warning('Please select a device')
    return
  }

  connecting.value = true
  try {
    const txId = parseHexId(txIdHex.value)
    const rxId = parseHexId(rxIdHex.value)

    // For SocketCAN, use the (possibly edited) channel name
    const channel =
      device.type === 'socketcan' ? socketCanChannel.value : device.channel

    const result = await api.connect({
      deviceId: device.id,
      deviceType: device.type,
      channel,
      handle: device.handle,
      txId,
      rxId,
      bitrate: bitrate.value,
      canFd: canFd.value,
      p2TimeoutMs: p2Timeout.value
    })

    if (result.success) {
      connected.value = true
      emit('connectionChanged', true)
      ElMessage.success(`Connected: ${device.label}`)
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
  padding: 6px 12px;
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

.hw-icon {
  margin-right: 4px;
}
</style>
