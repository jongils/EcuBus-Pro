import type { IpcMain, BrowserWindow } from 'electron'
import { SimulateHardware, getSimulateDevices } from './core/hardware/simulate'
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
// Global state
// ─────────────────────────────────────────────────────────────────────────────

let currentHw: CanHardware | null = null
let currentCfg: UdsConfig | null = null
let isConnected = false

function getWin(): BrowserWindow | null {
  return (global as any).mainWindow || null
}

function sendToRenderer(channel: string, data: any) {
  const win = getWin()
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, data)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// IPC Handlers
// ─────────────────────────────────────────────────────────────────────────────

export function registerIpcHandlers(ipcMain: IpcMain) {
  // ── Device discovery ──────────────────────────────────────────────────────

  ipcMain.handle('device:list', async (): Promise<HardwareDevice[]> => {
    const devices: HardwareDevice[] = [...getSimulateDevices()]

    // Try to load socketcan devices (Linux only, optional)
    try {
      const { exec } = await import('child_process')
      const { promisify } = await import('util')
      const execAsync = promisify(exec)
      const { stdout } = await execAsync('ip link show type can 2>/dev/null || echo ""')
      const canIfaces = stdout
        .split('\n')
        .filter((l) => l.match(/^\d+: (can\d+)/))
        .map((l) => {
          const m = l.match(/^\d+: (can\d+)/)
          return m ? m[1] : null
        })
        .filter(Boolean) as string[]

      for (const iface of canIfaces) {
        devices.push({
          id: `socketcan-${iface}`,
          label: `SocketCAN ${iface}`,
          type: 'socketcan',
          channel: iface
        })
      }
    } catch {
      // socketcan not available
    }

    return devices
  })

  // ── Connection management ─────────────────────────────────────────────────

  ipcMain.handle(
    'device:connect',
    async (
      _,
      params: {
        deviceId: string
        deviceType: string
        channel?: string
        txId: number
        rxId: number
        p2TimeoutMs: number
      }
    ) => {
      try {
        // Disconnect existing connection
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
          // Dynamic import for socketcan (optional dependency)
          const { SocketCanHardware } = await import('./core/hardware/socketcan').catch(() => {
            throw new Error('SocketCAN module not available. Install socketcan package.')
          })
          hw = new SocketCanHardware(params.channel || 'can0', params.txId, params.rxId)
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

  ipcMain.handle('device:status', () => ({
    connected: isConnected
  }))

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
    async (
      _,
      params: {
        fileBase64: string
        memoryAddress: number
      }
    ) => {
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
      const { udsTransaction } = await import('./core/cantp')
      const { hexToBuffer, bufToHex } = await import('./core/uds-ops')
      const req = hexToBuffer(requestHex.replace(/\s+/g, ''))
      const resp = await udsTransaction(
        currentCfg.hw,
        currentCfg.txId,
        currentCfg.rxId,
        req,
        currentCfg.p2TimeoutMs
      )
      return { success: true, responseHex: bufToHex(resp) }
    } catch (e: any) {
      return { success: false, errorMsg: e.message || String(e) }
    }
  })
}
