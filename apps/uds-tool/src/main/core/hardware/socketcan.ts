import { CanHardware, CanFrame } from './interface'

/**
 * SocketCAN hardware driver for Linux
 *
 * Requires the `socketcan` npm package:
 *   npm install socketcan
 *   (or pnpm add socketcan)
 *
 * The CAN interface must be up before connecting:
 *   sudo ip link set can0 type can bitrate 500000
 *   sudo ip link set can0 up
 *
 * Works with any hardware that has Linux kernel driver support:
 *   - PEAK (peak_usb module)
 *   - Kvaser (kvaser_usb module)
 *   - Vector (vxlpci module)
 *   - Many cheap USB-CAN adapters (gs_usb, slcan modules)
 */
export class SocketCanHardware implements CanHardware {
  private channel: any = null
  private rxBuffers = new Map<number, CanFrame[]>()
  private rxWaiters = new Map<
    number,
    Array<{ resolve: (f: CanFrame | null) => void; timer: ReturnType<typeof setTimeout> }>
  >()

  constructor(private iface: string) {}

  async open(): Promise<void> {
    let socketcan: any
    try {
      // Try to load the socketcan package
      socketcan = require('socketcan')
    } catch {
      throw new Error(
        `socketcan package not installed.\n` +
          `Run: cd apps/uds-tool && npm install socketcan\n` +
          `Also make sure the CAN interface is up:\n` +
          `  sudo ip link set ${this.iface} type can bitrate 500000\n` +
          `  sudo ip link set ${this.iface} up`
      )
    }

    try {
      this.channel = socketcan.createRawChannel(this.iface, true /* timestamps */)
    } catch (e: any) {
      throw new Error(
        `Failed to open CAN interface '${this.iface}': ${e.message}\n` +
          `Make sure the interface is up: sudo ip link set ${this.iface} up`
      )
    }

    this.channel.addListener('onMessage', (msg: any) => {
      // Normalize the frame
      const frame: CanFrame = {
        id: msg.id & 0x1fffffff, // Strip extended flag from ID
        data: Buffer.isBuffer(msg.data) ? Buffer.from(msg.data) : Buffer.from(msg.data || []),
        extended: !!(msg.id & 0x80000000) || !!msg.ext
      }

      const waiters = this.rxWaiters.get(frame.id)
      if (waiters && waiters.length > 0) {
        // Wake up a pending receive()
        const waiter = waiters.shift()!
        clearTimeout(waiter.timer)
        waiter.resolve(frame)
      } else {
        // Buffer the frame for the next receive() call
        if (!this.rxBuffers.has(frame.id)) this.rxBuffers.set(frame.id, [])
        const buf = this.rxBuffers.get(frame.id)!
        buf.push(frame)
        // Limit buffer to avoid memory growth
        if (buf.length > 64) buf.shift()
      }
    })

    this.channel.addListener('onStopped', () => {
      this._drainWaiters()
    })

    this.channel.start()
  }

  close(): void {
    try {
      this.channel?.stop()
    } catch {
      // ignore
    }
    this.channel = null
    this._drainWaiters()
  }

  async send(frame: CanFrame): Promise<void> {
    if (!this.channel) throw new Error('SocketCAN: Not connected')
    this.channel.send({
      id: frame.extended ? frame.id | 0x80000000 : frame.id,
      ext: frame.extended || false,
      rtr: false,
      data: frame.data
    })
  }

  async receive(id: number, timeoutMs: number): Promise<CanFrame | null> {
    // Return buffered frame immediately if available
    const buf = this.rxBuffers.get(id)
    if (buf && buf.length > 0) return buf.shift()!

    // Otherwise wait for the next matching frame
    return new Promise((resolve) => {
      if (!this.rxWaiters.has(id)) this.rxWaiters.set(id, [])
      const timer = setTimeout(() => {
        const waiters = this.rxWaiters.get(id)
        if (waiters) {
          const idx = waiters.findIndex((w) => w.resolve === resolve)
          if (idx !== -1) waiters.splice(idx, 1)
        }
        resolve(null)
      }, timeoutMs)
      this.rxWaiters.get(id)!.push({ resolve, timer })
    })
  }

  private _drainWaiters() {
    for (const waiters of this.rxWaiters.values()) {
      for (const w of waiters) {
        clearTimeout(w.timer)
        w.resolve(null)
      }
      waiters.length = 0
    }
    this.rxWaiters.clear()
    this.rxBuffers.clear()
  }
}

/** Enumerate available SocketCAN interfaces via `ip link show type can` */
export async function getSocketCanDevices(): Promise<
  Array<{ id: string; label: string; type: 'socketcan'; channel: string }>
> {
  try {
    const { exec } = await import('child_process')
    const { promisify } = await import('util')
    const { stdout } = await promisify(exec)('ip link show type can 2>/dev/null || true')
    return stdout
      .split('\n')
      .map((line) => line.match(/^\d+:\s+(can\d+)/))
      .filter(Boolean)
      .map((m) => ({
        id: `socketcan-${m![1]}`,
        label: `SocketCAN  ${m![1]}`,
        type: 'socketcan' as const,
        channel: m![1]
      }))
  } catch {
    return []
  }
}
