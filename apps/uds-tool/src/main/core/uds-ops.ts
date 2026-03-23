import { CanHardware } from './hardware/interface'
import { udsTransaction, checkResponse, parseNrc } from './cantp'

export interface UdsConfig {
  hw: CanHardware
  txId: number
  rxId: number
  p2TimeoutMs: number // Default response timeout (ms)
}

/**
 * Single UDS transaction.
 * Automatically uses hw.sendAndReceive when available (e.g. PEAK PCAN-TP),
 * otherwise falls back to CAN-TP segmentation via send/receive.
 */
async function udsRoundTrip(cfg: UdsConfig, request: Buffer): Promise<Buffer> {
  if (cfg.hw.sendAndReceive) {
    return cfg.hw.sendAndReceive(cfg.txId, cfg.rxId, request, cfg.p2TimeoutMs)
  }
  return udsTransaction(cfg.hw, cfg.txId, cfg.rxId, request, cfg.p2TimeoutMs)
}

/** Result for any UDS operation */
export interface UdsResult<T = void> {
  success: boolean
  data?: T
  errorMsg?: string
  raw?: string // Raw hex bytes
}

function bufToHex(buf: Buffer): string {
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
    .join(' ')
}

function hexToBuffer(hex: string): Buffer {
  const clean = hex.replace(/\s+/g, '')
  if (clean.length % 2 !== 0) throw new Error('Invalid hex string (odd length)')
  const buf = Buffer.alloc(clean.length / 2)
  for (let i = 0; i < buf.length; i++) {
    buf[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  }
  return buf
}

/** Perform UDS request with pending response (0x78) handling */
async function performRequest(
  cfg: UdsConfig,
  request: Buffer,
  expectedSid: number
): Promise<Buffer> {
  let response = await udsRoundTrip(cfg, request)

  // Handle 0x78 Response Pending
  let retries = 10
  while (response[0] === 0x7f && response[2] === 0x78 && retries-- > 0) {
    response = await udsRoundTrip(cfg, request)
  }

  checkResponse(response, expectedSid)
  return response
}

// ─────────────────────────────────────────────────────────────────────────────
// DID Operations (0x22 / 0x2E)
// ─────────────────────────────────────────────────────────────────────────────

export interface DidReadResult {
  did: number
  dataHex: string
  dataAscii: string
}

export async function readDID(cfg: UdsConfig, did: number): Promise<UdsResult<DidReadResult>> {
  try {
    const req = Buffer.from([0x22, (did >> 8) & 0xff, did & 0xff])
    const resp = await performRequest(cfg, req, 0x22)
    const data = resp.slice(3) // Strip 0x62 + DID (2 bytes)
    const dataHex = bufToHex(data)
    const dataAscii = data
      .toString('ascii')
      .replace(/[^\x20-\x7e]/g, '.')

    return {
      success: true,
      data: { did, dataHex, dataAscii },
      raw: bufToHex(resp)
    }
  } catch (e: any) {
    return { success: false, errorMsg: e.message || String(e) }
  }
}

export async function writeDID(
  cfg: UdsConfig,
  did: number,
  valueHex: string
): Promise<UdsResult> {
  try {
    const valueBytes = hexToBuffer(valueHex)
    const req = Buffer.concat([Buffer.from([0x2e, (did >> 8) & 0xff, did & 0xff]), valueBytes])
    const resp = await performRequest(cfg, req, 0x2e)
    return { success: true, raw: bufToHex(resp) }
  } catch (e: any) {
    return { success: false, errorMsg: e.message || String(e) }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DTC Operations (0x19 / 0x14)
// ─────────────────────────────────────────────────────────────────────────────

export interface DtcEntry {
  code: string // e.g. "P0102"
  codeHex: string // e.g. "010102"
  status: number
  statusDescription: string
}

function dtcCodeToString(high: number, mid: number, low: number): string {
  const prefix = ['P', 'C', 'B', 'U'][(high >> 6) & 0x03]
  const digit1 = (high >> 4) & 0x03
  const rest = ((high & 0x0f) << 8) | (mid << 0)
  const code = `${prefix}${digit1}${mid.toString(16).padStart(2, '0').toUpperCase()}${low.toString(16).padStart(2, '0').toUpperCase()}`
  return code
}

function dtcStatusDescription(status: number): string {
  const flags: string[] = []
  if (status & 0x01) flags.push('testFailed')
  if (status & 0x02) flags.push('testFailedThisMonitoringCycle')
  if (status & 0x04) flags.push('pendingDTC')
  if (status & 0x08) flags.push('confirmedDTC')
  if (status & 0x10) flags.push('testNotCompleted')
  if (status & 0x20) flags.push('testFailedSinceClear')
  if (status & 0x40) flags.push('testNotCompletedSinceClear')
  if (status & 0x80) flags.push('warningIndicatorRequested')
  return flags.length ? flags.join(', ') : 'noStatus'
}

export async function readDTCs(
  cfg: UdsConfig,
  reportType: number = 0x02,
  statusMask: number = 0xff
): Promise<UdsResult<DtcEntry[]>> {
  try {
    const req = Buffer.from([0x19, reportType, statusMask])
    const resp = await performRequest(cfg, req, 0x19)

    const dtcs: DtcEntry[] = []
    let i = 3 // Skip [0x59, subFunc, statusMask]

    while (i + 3 < resp.length) {
      const high = resp[i]
      const mid = resp[i + 1]
      const low = resp[i + 2]
      const status = resp[i + 3]
      dtcs.push({
        code: dtcCodeToString(high, mid, low),
        codeHex: `${high.toString(16).padStart(2, '0')}${mid.toString(16).padStart(2, '0')}${low.toString(16).padStart(2, '0')}`.toUpperCase(),
        status,
        statusDescription: dtcStatusDescription(status)
      })
      i += 4
    }

    return { success: true, data: dtcs, raw: bufToHex(resp) }
  } catch (e: any) {
    return { success: false, errorMsg: e.message || String(e) }
  }
}

export async function clearDTCs(
  cfg: UdsConfig,
  groupOfDTC: number = 0xffffff
): Promise<UdsResult> {
  try {
    const req = Buffer.from([
      0x14,
      (groupOfDTC >> 16) & 0xff,
      (groupOfDTC >> 8) & 0xff,
      groupOfDTC & 0xff
    ])
    const resp = await performRequest(cfg, req, 0x14)
    return { success: true, raw: bufToHex(resp) }
  } catch (e: any) {
    return { success: false, errorMsg: e.message || String(e) }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Flash Operations (0x34 → 0x36 × N → 0x37)
// ─────────────────────────────────────────────────────────────────────────────

export interface FlashProgress {
  phase: 'download' | 'transfer' | 'exit' | 'done' | 'error'
  percent: number
  bytesSent: number
  totalBytes: number
  message: string
}

export async function flashECU(
  cfg: UdsConfig,
  fileBuffer: Buffer,
  memoryAddress: number,
  onProgress: (p: FlashProgress) => void
): Promise<UdsResult> {
  try {
    const addrBytes = 4
    const sizeBytes = 4
    const addrLenByte = (sizeBytes << 4) | addrBytes

    // 1. RequestDownload (0x34)
    onProgress({
      phase: 'download',
      percent: 0,
      bytesSent: 0,
      totalBytes: fileBuffer.length,
      message: 'Sending RequestDownload (0x34)...'
    })

    const req34 = Buffer.alloc(2 + addrBytes + sizeBytes)
    req34[0] = 0x34
    req34[1] = 0x00 // No compression, no encrypting
    req34[2] = addrLenByte
    req34.writeUInt32BE(memoryAddress, 3)
    req34.writeUInt32BE(fileBuffer.length, 7)

    const resp34 = await performRequest(cfg, req34, 0x34)

    // Parse maxBlockLength from response
    const lenFormatId = resp34[1]
    const maxBlockLenBytes = (lenFormatId >> 4) & 0x0f
    let maxBlockLen = 0
    for (let i = 0; i < maxBlockLenBytes; i++) {
      maxBlockLen = (maxBlockLen << 8) | resp34[2 + i]
    }
    maxBlockLen -= 2 // Subtract service ID and block sequence counter

    if (maxBlockLen <= 0) maxBlockLen = 128

    // 2. TransferData (0x36) in blocks
    let blockSeq = 1
    let offset = 0

    while (offset < fileBuffer.length) {
      const chunk = fileBuffer.slice(offset, offset + maxBlockLen)
      const req36 = Buffer.concat([Buffer.from([0x36, blockSeq & 0xff]), chunk])
      const resp36 = await performRequest(cfg, req36, 0x36)

      if (resp36[1] !== (blockSeq & 0xff)) {
        throw new Error(`Block sequence mismatch: expected ${blockSeq}, got ${resp36[1]}`)
      }

      offset += chunk.length
      blockSeq = (blockSeq % 0xff) + 1

      const percent = Math.round((offset / fileBuffer.length) * 90) + 5
      onProgress({
        phase: 'transfer',
        percent,
        bytesSent: offset,
        totalBytes: fileBuffer.length,
        message: `Transferring... ${offset}/${fileBuffer.length} bytes`
      })
    }

    // 3. RequestTransferExit (0x37)
    onProgress({
      phase: 'exit',
      percent: 97,
      bytesSent: fileBuffer.length,
      totalBytes: fileBuffer.length,
      message: 'Sending RequestTransferExit (0x37)...'
    })

    await performRequest(cfg, Buffer.from([0x37]), 0x37)

    onProgress({
      phase: 'done',
      percent: 100,
      bytesSent: fileBuffer.length,
      totalBytes: fileBuffer.length,
      message: 'Flash complete!'
    })

    return { success: true }
  } catch (e: any) {
    onProgress({
      phase: 'error',
      percent: 0,
      bytesSent: 0,
      totalBytes: fileBuffer.length,
      message: e.message || String(e)
    })
    return { success: false, errorMsg: e.message || String(e) }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Sequence Automation
// ─────────────────────────────────────────────────────────────────────────────

export interface SequenceStep {
  id: string
  name: string
  serviceId: number // e.g. 0x22
  requestHex: string // Full request bytes in hex (e.g. "22 F1 90")
  delayAfterMs: number
  checkResponse: boolean
  enabled: boolean
}

export interface SequenceStepResult {
  stepId: string
  stepName: string
  success: boolean
  requestHex: string
  responseHex?: string
  errorMsg?: string
  durationMs: number
}

export async function runSequence(
  cfg: UdsConfig,
  steps: SequenceStep[],
  onStepDone: (result: SequenceStepResult) => void
): Promise<UdsResult<SequenceStepResult[]>> {
  const results: SequenceStepResult[] = []

  for (const step of steps) {
    if (!step.enabled) continue

    const start = Date.now()
    let result: SequenceStepResult

    try {
      const reqBuf = hexToBuffer(step.requestHex.replace(/\s+/g, ''))
      const resp = await udsRoundTrip(cfg, reqBuf)
      const responseHex = bufToHex(resp)

      if (step.checkResponse && resp[0] === 0x7f) {
        const nrc = resp[2]
        throw new Error(`Negative Response NRC=0x${nrc.toString(16)}: ${parseNrc(nrc)}`)
      }

      result = {
        stepId: step.id,
        stepName: step.name,
        success: true,
        requestHex: step.requestHex,
        responseHex,
        durationMs: Date.now() - start
      }
    } catch (e: any) {
      result = {
        stepId: step.id,
        stepName: step.name,
        success: false,
        requestHex: step.requestHex,
        errorMsg: e.message || String(e),
        durationMs: Date.now() - start
      }
    }

    results.push(result)
    onStepDone(result)

    if (step.delayAfterMs > 0) {
      await new Promise((r) => setTimeout(r, step.delayAfterMs))
    }
  }

  const allOk = results.every((r) => r.success)
  return { success: allOk, data: results }
}

export { hexToBuffer, bufToHex }
