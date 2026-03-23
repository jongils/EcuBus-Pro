import { contextBridge, ipcRenderer } from 'electron'

const api = {
  // ── Device ────────────────────────────────────────────────────────────────
  listDevices: () => ipcRenderer.invoke('device:list'),

  connect: (params: {
    device: {
      id: string
      label: string
      type: string
      channel?: string
      handle?: number
      serialPort?: string
      canFdCapable?: boolean
    }
    txId: number
    rxId: number
    bitrate: string
    canFd: boolean
    p2TimeoutMs: number
  }) => ipcRenderer.invoke('device:connect', params),

  disconnect: () => ipcRenderer.invoke('device:disconnect'),
  getStatus: () => ipcRenderer.invoke('device:status'),

  // ── DID ───────────────────────────────────────────────────────────────────
  readDID: (did: number) => ipcRenderer.invoke('uds:readDID', did),
  writeDID: (did: number, valueHex: string) =>
    ipcRenderer.invoke('uds:writeDID', { did, valueHex }),

  // ── DTC ───────────────────────────────────────────────────────────────────
  readDTCs: (reportType: number, statusMask: number) =>
    ipcRenderer.invoke('uds:readDTCs', { reportType, statusMask }),
  clearDTCs: (groupOfDTC: number) => ipcRenderer.invoke('uds:clearDTCs', groupOfDTC),

  // ── Flash ─────────────────────────────────────────────────────────────────
  flash: (fileBase64: string, memoryAddress: number) =>
    ipcRenderer.invoke('uds:flash', { fileBase64, memoryAddress }),
  onFlashProgress: (cb: (progress: any) => void) => {
    ipcRenderer.on('uds:flashProgress', (_, data) => cb(data))
    return () => ipcRenderer.removeAllListeners('uds:flashProgress')
  },

  // ── Sequence ──────────────────────────────────────────────────────────────
  runSequence: (steps: any[]) => ipcRenderer.invoke('uds:runSequence', steps),
  onSequenceStepDone: (cb: (result: any) => void) => {
    ipcRenderer.on('uds:sequenceStepDone', (_, data) => cb(data))
    return () => ipcRenderer.removeAllListeners('uds:sequenceStepDone')
  },

  // ── Raw transaction ───────────────────────────────────────────────────────
  rawRequest: (requestHex: string) => ipcRenderer.invoke('uds:raw', requestHex),

  // ── SocketCAN setup helper (Linux) ────────────────────────────────────────
  socketCanSetup: (iface: string, bitrate: string) =>
    ipcRenderer.invoke('socketcan:setup', { iface, bitrate })
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('udsApi', api)
} else {
  ;(window as any).udsApi = api
}

export type UdsApi = typeof api
