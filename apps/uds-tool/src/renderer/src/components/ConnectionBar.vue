<template>
  <div class="conn-bar">
    <!-- Device selector with grouped vendors -->
    <el-select
      v-model="selectedDeviceId"
      placeholder="Select device"
      size="small"
      style="width: 230px"
      :loading="loadingDevices"
      @focus="refreshDevices"
      @change="onDeviceChange"
    >
      <el-option-group v-for="g in deviceGroups" :key="g.label" :label="g.label">
        <el-option v-for="d in g.devices" :key="d.id" :label="d.label" :value="d.id">
          <span class="hw-type-badge" :class="`hw-${d.type}`">{{ hwBadge(d.type) }}</span>
          {{ d.label }}
        </el-option>
      </el-option-group>
    </el-select>

    <el-divider direction="vertical" />

    <!-- SocketCAN: interface name + bitrate + setup button -->
    <template v-if="selectedDevice?.type === 'socketcan'">
      <span class="label">Interface</span>
      <el-input v-model="socketCanIface" size="small" style="width: 75px" placeholder="can0" />
      <span class="label">Bitrate</span>
      <el-select v-model="bitrate" size="small" style="width: 105px">
        <el-option v-for="b in bitrateOptions" :key="b.v" :label="b.l" :value="b.v" />
      </el-select>
      <el-tooltip content="Setup Linux CAN interface (requires sudo)" placement="bottom">
        <el-button size="small" :loading="settingUp" @click="setupSocketCan">Setup</el-button>
      </el-tooltip>
    </template>

    <!-- SLCAN: serial port path + bitrate (no CAN-FD) -->
    <template v-else-if="selectedDevice?.type === 'slcan'">
      <span class="label">Port</span>
      <el-input
        v-model="slcanPort"
        size="small"
        style="width: 130px"
        placeholder="/dev/ttyUSB0"
      />
      <span class="label">Bitrate</span>
      <el-select v-model="bitrate" size="small" style="width: 105px">
        <el-option v-for="b in slcanBitrateOptions" :key="b.v" :label="b.l" :value="b.v" />
      </el-select>
    </template>

    <!-- All other vendors: bitrate + optional CAN-FD -->
    <template v-else-if="selectedDevice && selectedDevice.type !== 'simulate'">
      <span class="label">Bitrate</span>
      <el-select v-model="bitrate" size="small" style="width: 105px">
        <el-option v-for="b in bitrateOptions" :key="b.v" :label="b.l" :value="b.v" />
      </el-select>
      <el-checkbox
        v-if="selectedDevice?.canFdCapable"
        v-model="canFd"
        size="small"
        style="margin-left: 4px"
      >
        CAN-FD
      </el-checkbox>
    </template>

    <el-divider direction="vertical" />

    <!-- TX / RX IDs -->
    <span class="label">TX</span>
    <el-input v-model="txIdHex" size="small" style="width: 80px" placeholder="0x7E0" />
    <span class="label">RX</span>
    <el-input v-model="rxIdHex" size="small" style="width: 80px" placeholder="0x7E8" />

    <!-- P2 timeout -->
    <span class="label">P2 ms</span>
    <el-input-number
      v-model="p2Timeout"
      :min="100"
      :max="10000"
      :step="100"
      size="small"
      style="width: 108px"
    />

    <el-divider direction="vertical" />

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
  type: string
  channel?: string
  handle?: number
  serialPort?: string
  canFdCapable?: boolean
}

// ── State ─────────────────────────────────────────────────────────────────────
const devices = ref<Device[]>([])
const selectedDeviceId = ref('')
const txIdHex = ref('0x7E0')
const rxIdHex = ref('0x7E8')
const p2Timeout = ref(2000)
const bitrate = ref('500000')
const canFd = ref(false)
const socketCanIface = ref('can0')
const slcanPort = ref('/dev/ttyUSB0')
const connected = ref(false)
const connecting = ref(false)
const loadingDevices = ref(false)
const settingUp = ref(false)

// ── Bitrate options ───────────────────────────────────────────────────────────
const bitrateOptions = [
  { l: '1 Mbit/s', v: '1000000' },
  { l: '800 kbit/s', v: '800000' },
  { l: '500 kbit/s', v: '500000' },
  { l: '250 kbit/s', v: '250000' },
  { l: '125 kbit/s', v: '125000' },
  { l: '100 kbit/s', v: '100000' },
  { l: '50 kbit/s', v: '50000' }
]

// SLCAN supports a subset of bitrates
const slcanBitrateOptions = [
  { l: '1 Mbit/s', v: '1000000' },
  { l: '500 kbit/s', v: '500000' },
  { l: '250 kbit/s', v: '250000' },
  { l: '125 kbit/s', v: '125000' },
  { l: '100 kbit/s', v: '100000' },
  { l: '50 kbit/s', v: '50000' },
  { l: '20 kbit/s', v: '20000' },
  { l: '10 kbit/s', v: '10000' }
]

// ── Device grouping ───────────────────────────────────────────────────────────
const GROUP_ORDER: Record<string, string> = {
  simulate: '① Simulate (no hardware)',
  socketcan: '② SocketCAN (Linux – all brands)',
  peak: '③ PEAK (PCAN-TP)',
  vector: '④ Vector (XL Driver / ETAS ES891)',
  kvaser: '⑤ Kvaser',
  zlg: '⑥ ZLG (ZCAN)',
  candle: '⑦ Candle / CANable (USB)',
  slcan: '⑧ SLCAN (USB serial – cross-platform)',
  toomoss: '⑨ TooMoss'
}

const deviceGroups = computed(() => {
  const map = new Map<string, { label: string; devices: Device[] }>()
  for (const [type, label] of Object.entries(GROUP_ORDER)) {
    map.set(type, { label, devices: [] })
  }
  for (const d of devices.value) {
    const g = map.get(d.type)
    if (g) g.devices.push(d)
  }
  return [...map.values()].filter((g) => g.devices.length > 0)
})

const selectedDevice = computed<Device | undefined>(() =>
  devices.value.find((d) => d.id === selectedDeviceId.value)
)

// ── Helpers ───────────────────────────────────────────────────────────────────
const hwBadge: Record<string, string> = {
  simulate: 'SIM',
  socketcan: 'SCN',
  peak: 'PKK',
  vector: 'VEC',
  kvaser: 'KVS',
  zlg: 'ZLG',
  candle: 'CDL',
  slcan: 'SLC',
  toomoss: 'TMO'
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
  if (d.type === 'socketcan' && d.channel) socketCanIface.value = d.channel
  if (d.type === 'slcan' && d.serialPort) slcanPort.value = d.serialPort
  canFd.value = false
}

async function setupSocketCan() {
  const iface = socketCanIface.value
  if (!iface) return
  settingUp.value = true
  try {
    const r = await api.socketCanSetup(iface, bitrate.value)
    r.success ? ElMessage.success(`${iface} configured OK`) : ElMessage.error(`Setup: ${r.output}`)
  } finally {
    settingUp.value = false
  }
}

async function connect() {
  const device = selectedDevice.value
  if (!device) return ElMessage.warning('Select a device')

  connecting.value = true
  try {
    const txId = parseHexId(txIdHex.value)
    const rxId = parseHexId(rxIdHex.value)

    // Merge edited fields back into device object
    const devicePayload: Device = { ...device }
    if (device.type === 'socketcan') devicePayload.channel = socketCanIface.value
    if (device.type === 'slcan') devicePayload.serialPort = slcanPort.value

    const result = await api.connect({
      device: devicePayload,
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
    ElMessage.error(e.message)
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

.hw-type-badge {
  display: inline-block;
  font-size: 10px;
  font-weight: 600;
  padding: 1px 4px;
  border-radius: 3px;
  margin-right: 4px;
  font-family: 'Courier New', monospace;
}

.hw-simulate  { background: #e0f2fe; color: #0369a1; }
.hw-socketcan { background: #dcfce7; color: #166534; }
.hw-peak      { background: #fef9c3; color: #854d0e; }
.hw-vector    { background: #ede9fe; color: #5b21b6; }
.hw-kvaser    { background: #fee2e2; color: #991b1b; }
.hw-zlg       { background: #fce7f3; color: #9d174d; }
.hw-candle    { background: #ffedd5; color: #9a3412; }
.hw-slcan     { background: #f0fdf4; color: #14532d; }
.hw-toomoss   { background: #f8fafc; color: #334155; }
</style>
