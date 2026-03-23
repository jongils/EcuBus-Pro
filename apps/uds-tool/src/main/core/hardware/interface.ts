/** CAN frame */
export interface CanFrame {
  id: number
  data: Buffer
  extended?: boolean
}

/** CAN hardware abstraction */
export interface CanHardware {
  open(): Promise<void>
  close(): void
  send(frame: CanFrame): Promise<void>
  /** Receive a frame with the given ID, returns null on timeout */
  receive(id: number, timeoutMs: number): Promise<CanFrame | null>
}

export interface HardwareDevice {
  id: string
  label: string
  type: 'simulate' | 'socketcan' | 'peak'
  channel?: string
}
