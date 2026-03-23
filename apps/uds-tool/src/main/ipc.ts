import type { IpcMain, BrowserWindow } from 'electron'
import { SimulateHardware, getSimulateDevices } from './core/hardware/simulate'
import { SocketCanHardware, getSocketCanDevices } from './core/hardware/socketcan'
import { getPeakDevices } from './core/hardware/peak'
import { CanHardware, HardwareDevice } from './core/hardware/interface'
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
// Global connection state
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

  ipcMain.handle('device:list', async (): Promise<HardwareDevice[]> => {
    const [simulateDevices, socketCanDevices, peakDevices] = await Promise.all([
      Promise.resolve(getSimulateDevices()),
      getSocketCanDevices(),
      getPeakDevices()
    ])
    return [...simulateDevices, ...socketCanDevices, ...peakDevices]
  })

  // ── Connection management ─────────────────────────────────────────────────

  ipcMain.handle(
    'device:connect',
    async (
      _,
      params: {
        deviceId: string
        deviceType: 'simulate' | 'socketcan' | 'peak'
        channel?: string
        handle?: number
        txId: number
        rxId: number
        bitrate?: string
        canFd?: boolean
        p2TimeoutMs: number
      }
    ) => {
      try {
        // Close any existing connection first
        if (currentHw) {
          currentHw.close()
          currentHw = null
          currentCfg = null
          isConnected = false
        }

        let hw: CanHardware

        if (params.deviceType === 'simulate') {
          hw = new SimulateHardware(params.txId, params.rxId)
        } else if (params.deviceType === 'socketcan') {
          if (!params.channel) throw new Error('SocketCAN: channel name required (e.g. can0)')
          hw = new SocketCanHardware(params.channel)
        } else if (params.deviceType === 'peak') {
          if (!params.handle) throw new Error('PEAK: channel handle required')
          const { PeakCanHardware } = await import('./core/hardware/peak')
          hw = new PeakCanHardware(
            params.handle,
            params.txId,
            params.rxId,
            params.bitrate ?? '500000',
            params.canFd ?? false
          )
        } else {
          throw new Error(`Unsupported device type: ${params.deviceType}`)
        }

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
    }
  )

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

  ipcMain.handle('uds:writeDID', async (_, params: { did: number; valueHex: string }) => {
    if (!currentCfg) return { success: false, errorMsg: 'Not connected' }
    return writeDID(currentCfg, params.did, params.valueHex)
  })

  // ── DTC operations ────────────────────────────────────────────────────────

  ipcMain.handle(
    'uds:readDTCs',
    async (_, params: { reportType: number; statusMask: number }) => {
      if (!currentCfg) return { success: false, errorMsg: 'Not connected' }
      return readDTCs(currentCfg, params.reportType, params.statusMask)
    }
  )

  ipcMain.handle('uds:clearDTCs', async (_, groupOfDTC: number) => {
    if (!currentCfg) return { success: false, errorMsg: 'Not connected' }
    return clearDTCs(currentCfg, groupOfDTC)
  })

  // ── Flash operations ──────────────────────────────────────────────────────

  ipcMain.handle(
    'uds:flash',
    async (_, params: { fileBase64: string; memoryAddress: number }) => {
      if (!currentCfg) return { success: false, errorMsg: 'Not connected' }
      const fileBuffer = Buffer.from(params.fileBase64, 'base64')
      return flashECU(currentCfg, fileBuffer, params.memoryAddress, (progress) => {
        sendToRenderer('uds:flashProgress', progress)
      })
    }
  )

  // ── Sequence automation ───────────────────────────────────────────────────

  ipcMain.handle('uds:runSequence', async (_, steps: SequenceStep[]) => {
    if (!currentCfg) return { success: false, errorMsg: 'Not connected' }
    return runSequence(currentCfg, steps, (stepResult) => {
      sendToRenderer('uds:sequenceStepDone', stepResult)
    })
  })

  // ── Raw UDS transaction ───────────────────────────────────────────────────

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

  // ── SocketCAN interface setup helper ─────────────────────────────────────
  // Runs: sudo ip link set <iface> type can bitrate <bps> && sudo ip link set <iface> up

  ipcMain.handle(
    'socketcan:setup',
    async (_, params: { iface: string; bitrate: string }): Promise<{ success: boolean; output: string }> => {
      try {
        const { exec } = await import('child_process')
        const { promisify } = await import('util')
        const execAsync = promisify(exec)
        const cmd = `sudo ip link set ${params.iface} type can bitrate ${params.bitrate} && sudo ip link set ${params.iface} up`
        const { stdout, stderr } = await execAsync(cmd)
        return { success: true, output: stdout || stderr || 'OK' }
      } catch (e: any) {
        return { success: false, output: e.message }
      }
    }
  )
}
