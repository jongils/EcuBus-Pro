/** Raw CAN frame */
export interface CanFrame {
  id: number
  data: Buffer
  extended?: boolean
}

/**
 * CAN hardware abstraction.
 *
 * Two modes are supported:
 *   1. **Raw frame mode** (Simulate, SocketCAN, USB-CAN adapters)
 *      → `send` + `receive` are used; the CAN-TP layer handles ISO 15765-2 segmentation.
 *
 *   2. **Integrated TP mode** (PEAK PCAN-TP, DoIP, etc.)
 *      → `sendAndReceive` is used directly (hardware owns ISO-TP/transport); CAN-TP is bypassed.
 */
export interface CanHardware {
  open(): Promise<void>
  close(): void

  // ── Raw frame mode (modes without integrated TP) ─────────────────────────
  send?(frame: CanFrame): Promise<void>
  receive?(id: number, timeoutMs: number): Promise<CanFrame | null>

  // ── Integrated TP mode (hardware handles ISO-TP internally) ───────────────
  /**
   * Send a UDS PDU and return the response PDU in a single call.
   * When present, the CAN-TP segmentation layer is bypassed entirely.
   */
  sendAndReceive?(txId: number, rxId: number, data: Buffer, timeoutMs: number): Promise<Buffer>
}

export type HardwareType =
  | 'simulate'
  | 'socketcan'
  | 'peak'
  | 'vector'
  | 'kvaser'
  | 'zlg'
  | 'candle'
  | 'slcan'
  | 'toomoss'

export interface HardwareDevice {
  id: string
  label: string
  type: HardwareType
  /** SocketCAN interface name, e.g. 'can0' */
  channel?: string
  /** Device handle (PEAK, Vector, Kvaser, ZLG, Candle, TooMoss) */
  handle?: number
  /** SLCAN serial port path, e.g. '/dev/ttyUSB0' or 'COM3' */
  serialPort?: string
  /** Whether the device supports CAN-FD */
  canFdCapable?: boolean
}
