/**
 * Minimal CanLOG stub for use in the UDS tool app.
 *
 * EcuBus-Pro's real CanLOG depends on winston + dayjs + various transports.
 * This stub replaces it so we can import EcuBus-Pro's CAN drivers (e.g. PEAK_TP)
 * without pulling in the entire logging infrastructure.
 *
 * All logging is forwarded to console instead.
 */
import { EventEmitter } from 'events'
import type { CanMessage } from '../../../../../../src/main/share/can'

export class CanLOG {
  vendor: string
  deviceId: string

  constructor(
    vendor: string,
    _instance: string,
    deviceId: string,
    private event: EventEmitter
  ) {
    this.vendor = vendor
    this.deviceId = deviceId
  }

  close() {
    // no-op (no logger to close)
  }

  canBase(data: CanMessage) {
    this.event.emit('can-frame', data)
  }

  setOption(_cmd: string, _val: unknown) {
    // no-op
  }

  error(_ts: number, msg?: string) {
    if (msg) console.error(`[${this.vendor}] ${msg}`)
  }
}

// Re-export logging utilities that log.ts also exports so imports don't break
export function addTransport(_t: () => unknown): string {
  return ''
}
export function removeTransport(_id: string) {}
export function addFormat(_f: unknown) {}
export function createLogs(_logs: unknown[], _formats: unknown[]) {}
