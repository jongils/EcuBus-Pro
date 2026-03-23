import type { IpcMain, BrowserWindow } from 'electron'
import { SimulateHardware, getSimulateDevices } from './core/hardware/simulate'
import { SocketCanHardware, getSocketCanDevices } from './core/hardware/socketcan'
import { PeakCanHardware, getPeakDevices } from './core/hardware/peak'
import {
  getAllVendorDevices,
  createVectorHardware,
  createKvaserHardware,
  createZlgHardware,
  createCandleHardware,
  createSlcanHardware,
  createTooMossHardware
} from './core/hardware/vendors'
import { CanHardware, HardwareDevice, HardwareType } from './core/hardware/interface'
import {
  UdsConfig,
  readDID,
  writeDID,
  readDTCs,
  clearDTCs,
  flashECU,
  runSequence,
  SequenceStep
} from './core/uds-ops'

// ─────────────────────────────────────────────────────────────────────────────
// Connection state
// ─────────────────────────────────────────────────────────────────────────────

let currentHw: CanHardware | null = null
let currentCfg: UdsConfig | null = null
let isConnected = false

function getWin(): BrowserWindow | null {
  return (global as any).mainWindow || null
}

function sendToRenderer(channel: string, data: unknown) {
  const win = getWin()
  if (win && !win.isDestroyed()) win.webContents.send(channel, data)
}

// ─────────────────────────────────────────────────────────────────────────────
// IPC Handlers
// ─────────────────────────────────────────────────────────────────────────────

export function registerIpcHandlers(ipcMain: IpcMain) {
  // ── Device discovery ──────────────────────────────────────────────────────
  // Returns all available devices across all vendors simultaneously.

  ipcMain.handle('device:list', async (): Promise<HardwareDevice[]> => {
    const [simulate, socketcan, peak, vendors] = await Promise.all([
      Promise.resolve(getSimulateDevices()),
      getSocketCanDevices(),
      getPeakDevices(),
      getAllVendorDevices()
    ])
    return [...simulate, ...socketcan, ...peak, ...vendors]
  })

  // ── Connection ────────────────────────────────────────────────────────────

  ipcMain.handle('device:connect', async (_, params: ConnectParams) => {
    try {
      if (currentHw) {
        currentHw.close()
        currentHw = null
        currentCfg = null
        isConnected = false
      }

      const hw = await createHardware(params)
      await hw.open()

      currentHw = hw
      currentCfg = {
        hw,
        txId: params.txId,
        rxId: params.rxId,
        p2TimeoutMs: params.p2TimeoutMs
      }
      isConnected = true
      return { success: true }
    } catch (e: any) {
      return { success: false, errorMsg: e.message || String(e) }
    }
  })

  ipcMain.handle('device:disconnect', async () => {
    if (currentHw) {
      currentHw.close()
      currentHw = null
      currentCfg = null
      isConnected = false
    }
    return { success: true }
  })

  ipcMain.handle('device:status', () => ({ connected: isConnected }))

  // ── DID operations ────────────────────────────────────────────────────────

  ipcMain.handle('uds:readDID', async (_, did: number) => {
    if (!currentCfg) return { success: false, errorMsg: 'Not connected' }
    return readDID(currentCfg, did)
  })

  ipcMain.handle('uds:writeDID', async (_, p: { did: number; valueHex: string }) => {
    if (!currentCfg) return { success: false, errorMsg: 'Not connected' }
    return writeDID(currentCfg, p.did, p.valueHex)
  })

  // ── DTC operations ────────────────────────────────────────────────────────

  ipcMain.handle('uds:readDTCs', async (_, p: { reportType: number; statusMask: number }) => {
    if (!currentCfg) return { success: false, errorMsg: 'Not connected' }
    return readDTCs(currentCfg, p.reportType, p.statusMask)
  })

  ipcMain.handle('uds:clearDTCs', async (_, groupOfDTC: number) => {
    if (!currentCfg) return { success: false, errorMsg: 'Not connected' }
    return clearDTCs(currentCfg, groupOfDTC)
  })

  // ── Flash ─────────────────────────────────────────────────────────────────

  ipcMain.handle('uds:flash', async (_, p: { fileBase64: string; memoryAddress: number }) => {
    if (!currentCfg) return { success: false, errorMsg: 'Not connected' }
    const fileBuffer = Buffer.from(p.fileBase64, 'base64')
    return flashECU(currentCfg, fileBuffer, p.memoryAddress, (progress) =>
      sendToRenderer('uds:flashProgress', progress)
    )
  })

  // ── Sequence ──────────────────────────────────────────────────────────────

  ipcMain.handle('uds:runSequence', async (_, steps: SequenceStep[]) => {
    if (!currentCfg) return { success: false, errorMsg: 'Not connected' }
    return runSequence(currentCfg, steps, (r) => sendToRenderer('uds:sequenceStepDone', r))
  })

  // ── Raw transaction ───────────────────────────────────────────────────────

  ipcMain.handle('uds:raw', async (_, requestHex: string) => {
    if (!currentCfg) return { success: false, errorMsg: 'Not connected' }
    try {
      const { hexToBuffer, bufToHex } = await import('./core/uds-ops')
      const req = hexToBuffer(requestHex.replace(/\s+/g, ''))
      let resp: Buffer
      if (currentCfg.hw.sendAndReceive) {
        resp = await currentCfg.hw.sendAndReceive(
          currentCfg.txId,
          currentCfg.rxId,
          req,
          currentCfg.p2TimeoutMs
        )
      } else {
        const { udsTransaction } = await import('./core/cantp')
        resp = await udsTransaction(
          currentCfg.hw,
          currentCfg.txId,
          currentCfg.rxId,
          req,
          currentCfg.p2TimeoutMs
        )
      }
      return { success: true, responseHex: bufToHex(resp) }
    } catch (e: any) {
      return { success: false, errorMsg: e.message || String(e) }
    }
  })

  // ── SocketCAN setup helper (Linux) ────────────────────────────────────────

  ipcMain.handle(
    'socketcan:setup',
    async (_, p: { iface: string; bitrate: string }): Promise<{ success: boolean; output: string }> => {
      try {
        const { exec } = await import('child_process')
        const { promisify } = await import('util')
        const cmd = `sudo ip link set ${p.iface} type can bitrate ${p.bitrate} && sudo ip link set ${p.iface} up`
        const { stdout, stderr } = await promisify(exec)(cmd)
        return { success: true, output: stdout || stderr || 'OK' }
      } catch (e: any) {
        return { success: false, output: e.message }
      }
    }
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Hardware factory
// ─────────────────────────────────────────────────────────────────────────────

interface ConnectParams {
  device: HardwareDevice
  txId: number
  rxId: number
  bitrate: string
  canFd: boolean
  p2TimeoutMs: number
}

async function createHardware(p: ConnectParams): Promise<CanHardware> {
  const { device, txId, rxId, bitrate, canFd } = p

  switch (device.type as HardwareType) {
    case 'simulate':
      return new SimulateHardware(txId, rxId)

    case 'socketcan':
      if (!device.channel) throw new Error('SocketCAN: channel name required')
      return new SocketCanHardware(device.channel)

    case 'peak': {
      if (!device.handle) throw new Error('PEAK: channel handle required')
      const { PeakCanHardware } = await import('./core/hardware/peak')
      return new PeakCanHardware(device.handle, txId, rxId, bitrate, canFd)
    }

    case 'vector':
      return createVectorHardware(device, txId, rxId, bitrate, canFd)

    case 'kvaser':
      return createKvaserHardware(device, txId, rxId, bitrate, canFd)

    case 'zlg':
      return createZlgHardware(device, txId, rxId, bitrate, canFd)

    case 'candle':
      return createCandleHardware(device, txId, rxId, bitrate, canFd)

    case 'slcan':
      if (!device.serialPort) throw new Error('SLCAN: serial port path required')
      return createSlcanHardware(device, txId, rxId, bitrate)

    case 'toomoss':
      return createTooMossHardware(device, txId, rxId, bitrate, canFd)

    default:
      throw new Error(`Unsupported device type: ${device.type}`)
  }
}
