import { EventEmitter } from 'events'
import { CanFrame, CanHardware } from './interface'

/** UDS ECU simulator - responds to UDS requests */
class UdsEcuSimulator {
  private dids = new Map<number, Buffer>()
  private dtcs: number[] = [0x010201, 0x020301]

  respond(request: Buffer): Buffer {
    if (request.length === 0) return Buffer.from([0x7f, 0x00, 0x11])
    const sid = request[0]

    switch (sid) {
      case 0x10:
        return Buffer.from([0x50, request[1] || 0x01, 0x00, 0x19, 0x01, 0xf4])
      case 0x11:
        return Buffer.from([0x51, request[1] || 0x01])
      case 0x22: {
        if (request.length < 3) return Buffer.from([0x7f, 0x22, 0x13])
        const did = (request[1] << 8) | request[2]
        const data = this.dids.get(did) || Buffer.from([0xde, 0xad, 0xbe, 0xef])
        return Buffer.concat([Buffer.from([0x62, request[1], request[2]]), data])
      }
      case 0x2e: {
        if (request.length < 4) return Buffer.from([0x7f, 0x2e, 0x13])
        const did = (request[1] << 8) | request[2]
        this.dids.set(did, Buffer.from(request.slice(3)))
        return Buffer.from([0x6e, request[1], request[2]])
      }
      case 0x19: {
        const subFunc = request[1]
        if (subFunc === 0x02) {
          const resp: number[] = [0x59, 0x02, 0xff]
          for (const dtc of this.dtcs)
            resp.push((dtc >> 16) & 0xff, (dtc >> 8) & 0xff, dtc & 0xff, 0x08)
          return Buffer.from(resp)
        }
        if (subFunc === 0x01) return Buffer.from([0x59, 0x01, 0xff, 0x01, this.dtcs.length])
        return Buffer.from([0x7f, 0x19, 0x12])
      }
      case 0x14:
        this.dtcs = []
        return Buffer.from([0x54])
      case 0x27: {
        const level = request[1]
        if (level % 2 === 1) return Buffer.from([0x67, level, 0x11, 0x22, 0x33, 0x44])
        return Buffer.from([0x67, level])
      }
      case 0x3e:
        return Buffer.from([0x7e, request[1] & 0x7f])
      case 0x34:
        return Buffer.from([0x74, 0x20, 0x00, 0x80]) // maxBlockLen=128
      case 0x36:
        return Buffer.from([0x76, request[1]])
      case 0x37:
        return Buffer.from([0x77])
      case 0x31:
        return Buffer.from([0x71, request[1], request[2], request[3]])
      default:
        return Buffer.from([0x7f, sid, 0x11])
    }
  }
}

/** Encode a UDS PDU into CAN-TP frames */
function encodeCanTp(payload: Buffer): Buffer[] {
  if (payload.length <= 7) {
    const frame = Buffer.alloc(8, 0)
    frame[0] = payload.length & 0x0f
    payload.copy(frame, 1)
    return [frame]
  }
  const frames: Buffer[] = []
  const ff = Buffer.alloc(8, 0)
  ff[0] = 0x10 | ((payload.length >> 8) & 0x0f)
  ff[1] = payload.length & 0xff
  payload.copy(ff, 2, 0, 6)
  frames.push(ff)

  let offset = 6
  let sn = 1
  while (offset < payload.length) {
    const copyLen = Math.min(7, payload.length - offset)
    const cf = Buffer.alloc(8, 0)
    cf[0] = 0x20 | (sn & 0x0f)
    payload.copy(cf, 1, offset, offset + copyLen)
    frames.push(cf)
    offset += copyLen
    sn = (sn + 1) & 0x0f
  }
  return frames
}

/** Simulated CAN bus with a built-in UDS ECU responder (handles CAN-TP on ECU side) */
export class SimulateHardware implements CanHardware {
  private bus = new EventEmitter()
  private ecu = new UdsEcuSimulator()

  // CAN-TP state on ECU side (reassembly)
  private ecRxBuf: Buffer | null = null
  private ecRxTotal = 0
  private ecRxReceived = 0

  constructor(
    private txId = 0x7e0,
    private rxId = 0x7e8
  ) {
    this.bus.setMaxListeners(100)
  }

  async open(): Promise<void> {
    // ECU listens on tester's TX ID, responds on tester's RX ID
    this.bus.on(`raw:${this.txId}`, (frame: Buffer) => this._ecuHandleFrame(frame))
  }

  close(): void {
    this.bus.removeAllListeners()
    this.ecRxBuf = null
  }

  async send(frame: CanFrame): Promise<void> {
    setImmediate(() => this.bus.emit(`raw:${frame.id}`, frame.data))
  }

  async receive(id: number, timeoutMs: number): Promise<CanFrame | null> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.bus.removeListener(`rx:${id}`, handler)
        resolve(null)
      }, timeoutMs)
      const handler = (data: Buffer) => {
        clearTimeout(timer)
        resolve({ id, data })
      }
      this.bus.once(`rx:${id}`, handler)
    })
  }

  /** ECU-side CAN-TP frame handler */
  private _ecuHandleFrame(frame: Buffer): void {
    const frameType = (frame[0] & 0xf0) >> 4

    if (frameType === 0x0) {
      // Single Frame: process immediately
      const len = frame[0] & 0x0f
      const udsReq = frame.slice(1, 1 + len)
      this._ecuRespond(udsReq)
    } else if (frameType === 0x1) {
      // First Frame: start reassembly, send FC
      this.ecRxTotal = ((frame[0] & 0x0f) << 8) | frame[1]
      this.ecRxBuf = Buffer.alloc(this.ecRxTotal)
      frame.copy(this.ecRxBuf, 0, 2, 8)
      this.ecRxReceived = 6

      // Send Flow Control (CTS)
      const fc = Buffer.alloc(8, 0)
      fc[0] = 0x30
      setImmediate(() => this.bus.emit(`rx:${this.rxId}`, fc))
    } else if (frameType === 0x2) {
      // Consecutive Frame: continue reassembly
      if (!this.ecRxBuf) return
      const remaining = this.ecRxTotal - this.ecRxReceived
      const copyLen = Math.min(7, remaining)
      frame.copy(this.ecRxBuf, this.ecRxReceived, 1, 1 + copyLen)
      this.ecRxReceived += copyLen

      if (this.ecRxReceived >= this.ecRxTotal) {
        // All bytes received
        const udsReq = Buffer.from(this.ecRxBuf.slice(0, this.ecRxTotal))
        this.ecRxBuf = null
        this._ecuRespond(udsReq)
      }
    }
    // FC from tester (0x3) is ignored in this simple simulation
  }

  /** ECU generates and sends UDS response via CAN-TP */
  private _ecuRespond(udsRequest: Buffer): void {
    const udsResponse = this.ecu.respond(udsRequest)
    const frames = encodeCanTp(udsResponse)

    let delay = 5
    for (let i = 0; i < frames.length; i++) {
      const frame = frames[i]
      const frameType = (frame[0] & 0xf0) >> 4

      if (frameType === 0x1) {
        // FF: send it, then wait for tester's FC before sending CFs
        setTimeout(() => this.bus.emit(`rx:${this.rxId}`, frame), delay)
        delay += 5
        // After FF, wait for tester FC then send remaining CFs
        const remainingFrames = frames.slice(1)
        setTimeout(() => {
          // Listen for FC from tester
          this.bus.once(`raw:${this.txId}`, () => {
            let cfDelay = 1
            for (const cf of remainingFrames) {
              setTimeout(() => this.bus.emit(`rx:${this.rxId}`, cf), cfDelay)
              cfDelay += 2
            }
          })
        }, delay)
        return
      } else {
        setTimeout(() => this.bus.emit(`rx:${this.rxId}`, frame), delay)
        delay += 2
      }
    }
  }
}

export function getSimulateDevices() {
  return [
    { id: 'simulate-0', label: 'Simulate Bus 0', type: 'simulate' as const },
    { id: 'simulate-1', label: 'Simulate Bus 1', type: 'simulate' as const }
  ]
}
