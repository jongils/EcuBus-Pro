/**
 * Generic wrapper for any EcuBus-Pro CanBase-based driver.
 *
 * All raw-CAN EcuBus-Pro drivers (Vector, Kvaser, ZLG, Candle, SLCAN, TooMoss)
 * extend CanBase. This wrapper:
 *   1. Dynamically imports the driver class
 *   2. Wraps it with EcuBus-Pro's CAN_TP for ISO 15765-2
 *   3. Exposes sendAndReceive() so the app's own CAN-TP layer is bypassed
 *
 * The ecubus-log and node-item Vite aliases ensure the heavy EcuBus-Pro
 * logging infrastructure (winston/dayjs) is replaced by lightweight stubs.
 */
import type { CanBaseInfo } from '../../../../../../src/main/share/can'
import { CAN_ADDR_FORMAT, CAN_ADDR_TYPE, CAN_ID_TYPE } from '../../../../../../src/main/share/can'
import type { CanHardware } from './interface'

/** Factory that returns the CanBase constructor for a given vendor */
export type CanBaseFactory = () => Promise<new (info: CanBaseInfo) => any>

export class EcuBusCanWrapper implements CanHardware {
  private canTp: any = null

  constructor(
    private readonly factory: CanBaseFactory,
    private readonly info: CanBaseInfo,
    private readonly txId: number,
    private readonly rxId: number
  ) {}

  async open(): Promise<void> {
    const [DriverClass, { CAN_TP }] = await Promise.all([
      this.factory(),
      import('../../../../../../src/main/docan/cantp')
    ])
    const canBase = new DriverClass(this.info)
    this.canTp = new CAN_TP(canBase)
  }

  close(): void {
    try {
      // close(true) also closes the underlying CanBase
      this.canTp?.close(true)
    } catch {
      // ignore
    }
    this.canTp = null
  }

  /**
   * Send a UDS PDU and receive the response via EcuBus-Pro's CAN_TP.
   * CAN-TP segmentation (SF/FF/CF/FC) is handled internally by EcuBus-Pro.
   */
  async sendAndReceive(
    txId: number,
    rxId: number,
    data: Buffer,
    timeoutMs: number
  ): Promise<Buffer> {
    if (!this.canTp) throw new Error('Not connected')
    const addr = buildCanAddr(txId, rxId)
    await this.canTp.writeTp(addr, data)
    const { data: resp } = await this.canTp.readTp(addr, timeoutMs)
    return resp
  }
}

/** Build a CanAddr for NORMAL addressing (standard UDS over CAN) */
function buildCanAddr(txId: number, rxId: number) {
  return {
    idType: txId > 0x7ff || rxId > 0x7ff ? CAN_ID_TYPE.EXTENDED : CAN_ID_TYPE.STANDARD,
    brs: false,
    canfd: false,
    remote: false,
    SA: 0xf1, // Tester source address
    TA: 0x01, // ECU target address
    AE: 0,
    canIdTx: txId,
    canIdRx: rxId,
    addrType: CAN_ADDR_TYPE.PHYSICAL,
    addrFormat: CAN_ADDR_FORMAT.NORMAL
  }
}

/** Build CanBaseInfo from common parameters */
export function buildCanBaseInfo(
  id: string,
  handle: number | string,
  name: string,
  vendor: string,
  bitrate: string,
  canFd: boolean
): CanBaseInfo {
  const freq = parseInt(bitrate)
  return {
    id,
    handle: handle as number, // SLCAN uses string path here at runtime
    name,
    vendor,
    canfd: canFd,
    bitrate: {
      freq,
      timeSeg1: freqToSeg1(freq),
      timeSeg2: freqToSeg2(freq),
      sjw: 4,
      preScaler: 10
    }
  } as CanBaseInfo
}

function freqToSeg1(freq: number): number {
  const m: Record<number, number> = {
    1000000: 6,
    500000: 13,
    250000: 13,
    125000: 13,
    100000: 13,
    50000: 16
  }
  return m[freq] ?? 13
}

function freqToSeg2(freq: number): number {
  const m: Record<number, number> = {
    1000000: 1,
    500000: 2,
    250000: 2,
    125000: 2,
    100000: 2,
    50000: 8
  }
  return m[freq] ?? 2
}
