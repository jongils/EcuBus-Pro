import { CanHardware, HardwareDevice } from './interface'
import type { CanAddr, CanBaseInfo } from '../../../../../../src/main/share/can'
import { CAN_ADDR_FORMAT, CAN_ADDR_TYPE, CAN_ID_TYPE } from '../../../../../../src/main/share/can'

/**
 * PEAK CAN hardware driver (Windows / Linux via PCAN-TP).
 *
 * Uses EcuBus-Pro's PEAK_TP class which wraps PCAN-TP (PEAK's built-in ISO-TP).
 * Because PEAK handles ISO-TP natively, this driver implements `sendAndReceive`
 * (not raw send/receive), so the app's own CAN-TP layer is bypassed.
 *
 * Prerequisites:
 *   - PEAK PCAN driver installed (Windows: PEAK System driver; Linux: peak_usb module)
 *   - The native peak.node module must be compiled:
 *       cd EcuBus-Pro/src/main/docan && node-gyp build
 *
 * On Linux, prefer SocketCAN instead — it works for PEAK USB hardware via
 * the peak_usb kernel module and requires no native compilation.
 */
export class PeakCanHardware implements CanHardware {
  private peakTp: any = null
  private addr: CanAddr

  constructor(
    private channelHandle: number,
    txId: number,
    rxId: number,
    private bitrate: string = '500000',
    private canFd: boolean = false
  ) {
    // Build a CanAddr for NORMAL addressing using raw CAN IDs
    this.addr = {
      idType: CAN_ID_TYPE.STANDARD,
      brs: false,
      canfd: canFd,
      remote: false,
      SA: 0xf1,
      TA: 0x01,
      AE: 0,
      canIdTx: txId,
      canIdRx: rxId,
      addrType: CAN_ADDR_TYPE.PHYSICAL,
      addrFormat: CAN_ADDR_FORMAT.NORMAL
    } as CanAddr
  }

  async open(): Promise<void> {
    // Dynamically import PEAK_TP (requires EcuBus-Pro source + built native module)
    let PEAK_TP: any
    try {
      const mod = await import('../../../../../../src/main/docan/peak/index')
      PEAK_TP = mod.PEAK_TP
    } catch (e: any) {
      throw new Error(
        `Failed to load PEAK driver: ${e.message}\n` +
          `Make sure peak.node is built:\n` +
          `  cd EcuBus-Pro/src/main/docan && node-gyp build\n` +
          `On Linux, use SocketCAN mode instead (works with PEAK USB via peak_usb module).`
      )
    }

    const bitrateStr = this.canFd
      ? `f_clock_mhz=80, nom_brp=2, nom_tseg1=129, nom_tseg2=30, nom_sjw=30, data_brp=2, data_tseg1=29, data_tseg2=10, data_sjw=10`
      : `f_clock_mhz=80, nom_brp=10, nom_tseg1=${this._bitrateToSeg1()}, nom_tseg2=${this._bitrateToSeg2()}, nom_sjw=4, data_brp=10, data_tseg1=13, data_tseg2=2, data_sjw=2`

    const info: CanBaseInfo = {
      id: `peak-${this.channelHandle.toString(16)}`,
      handle: this.channelHandle,
      name: `PEAK Channel 0x${this.channelHandle.toString(16).padStart(2, '0')}`,
      vendor: 'peak',
      canfd: this.canFd,
      bitrate: {
        freq: parseInt(this.bitrate),
        timeSeg1: this._bitrateToSeg1(),
        timeSeg2: this._bitrateToSeg2(),
        sjw: 4,
        preScaler: 10
      }
    } as CanBaseInfo

    this.peakTp = new PEAK_TP(info)
  }

  close(): void {
    try {
      this.peakTp?.close()
    } catch {
      // ignore
    }
    this.peakTp = null
  }

  /**
   * PEAK handles ISO-TP natively via PCAN-TP.
   * This method sends a UDS PDU and waits for the response in a single call.
   */
  async sendAndReceive(
    _txId: number,
    _rxId: number,
    data: Buffer,
    timeoutMs: number
  ): Promise<Buffer> {
    if (!this.peakTp) throw new Error('PEAK: Not connected')
    await this.peakTp.writeTp(this.addr, data)
    const { data: respData } = await this.peakTp.readTp(this.addr, timeoutMs)
    return respData
  }

  // ── Bitrate helpers ───────────────────────────────────────────────────────

  private _bitrateToSeg1(): number {
    const map: Record<string, number> = {
      '1000000': 6,
      '800000': 7,
      '500000': 13,
      '250000': 13,
      '125000': 13,
      '100000': 13,
      '50000': 16,
      '20000': 16
    }
    return map[this.bitrate] ?? 13
  }

  private _bitrateToSeg2(): number {
    const map: Record<string, number> = {
      '1000000': 1,
      '800000': 2,
      '500000': 2,
      '250000': 2,
      '125000': 2,
      '100000': 2,
      '50000': 8,
      '20000': 8
    }
    return map[this.bitrate] ?? 2
  }
}

// ── Device discovery ─────────────────────────────────────────────────────────

const PEAK_CHANNELS: Array<{ handle: number; label: string }> = [
  { handle: 0x51, label: 'PCAN_USBBUS1' },
  { handle: 0x52, label: 'PCAN_USBBUS2' },
  { handle: 0x53, label: 'PCAN_USBBUS3' },
  { handle: 0x54, label: 'PCAN_USBBUS4' },
  { handle: 0x41, label: 'PCAN_PCIBUS1' },
  { handle: 0x42, label: 'PCAN_PCIBUS2' }
]

export async function getPeakDevices(): Promise<HardwareDevice[]> {
  try {
    const mod = await import('../../../../../../src/main/docan/peak/index')
    const devices = await mod.PEAK_TP.getValidDevices()
    return (devices || []).map((d: any) => ({
      id: `peak-${d.handle.toString(16)}`,
      label: `PEAK ${d.label ?? d.id}`,
      type: 'peak' as const,
      handle: d.handle
    }))
  } catch {
    // Native module not available — return all known channels so user can try
    return PEAK_CHANNELS.map((ch) => ({
      id: `peak-${ch.handle.toString(16)}`,
      label: `PEAK ${ch.label}`,
      type: 'peak' as const,
      handle: ch.handle
    }))
  }
}
