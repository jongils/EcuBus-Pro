/**
 * Hardware vendor drivers for the UDS Tool.
 *
 * All vendors below use EcuBus-Pro's native CanBase drivers wrapped by EcuBusCanWrapper.
 * - Vector  : Windows (XL Driver Library) — also supports ETAS ES891 via XL-Driver
 * - Kvaser  : Windows / Linux (kvaser/linuxcan)
 * - ZLG     : Windows (ZCANPRO driver)
 * - Candle  : Windows / macOS (gs_usb variant)
 * - SLCAN   : ALL platforms via serialport (CANable, many USB-CAN adapters)
 * - TooMoss : Windows
 *
 * ETAS notes:
 *   - ETAS ES581 USB CAN   → use SocketCAN on Linux (usbcan driver)
 *   - ETAS ES891/ES582     → use Vector driver on Windows (XL-Driver-Library compatible)
 *   - ETAS INCA interface  → ETAS does not expose a public raw-CAN API; use Vector driver
 */
import { EcuBusCanWrapper, buildCanBaseInfo, CanBaseFactory } from './ecubus-wrapper'
import type { HardwareDevice } from './interface'
import type { CanHardware } from './interface'

// ── Relative paths to EcuBus-Pro source ──────────────────────────────────────
const DOCAN = '../../../../../../src/main/docan'

// ─────────────────────────────────────────────────────────────────────────────
// Generic factory helper
// ─────────────────────────────────────────────────────────────────────────────

function makeWrapper(
  factory: CanBaseFactory,
  device: HardwareDevice,
  txId: number,
  rxId: number,
  bitrate: string,
  canFd: boolean
): CanHardware {
  const info = buildCanBaseInfo(
    device.id,
    device.handle ?? (device.serialPort as any) ?? 0,
    device.serialPort ?? device.label,
    device.type,
    bitrate,
    canFd
  )
  return new EcuBusCanWrapper(factory, info, txId, rxId)
}

// ─────────────────────────────────────────────────────────────────────────────
// Vector CAN  (Windows – XL Driver Library)
// ETAS ES891 also works here via Vector XL-Driver-Library compatibility.
// ─────────────────────────────────────────────────────────────────────────────

export async function getVectorDevices(): Promise<HardwareDevice[]> {
  try {
    const { VECTOR_CAN } = await import(`${DOCAN}/vector/index`)
    const devices = VECTOR_CAN.getValidDevices()
    return (devices || []).map((d: any) => ({
      id: `vector-${d.handle}`,
      label: `Vector  ${d.label ?? d.id}`,
      type: 'vector' as const,
      handle: d.handle,
      canFdCapable: true
    }))
  } catch {
    return []
  }
}

export function createVectorHardware(
  device: HardwareDevice,
  txId: number,
  rxId: number,
  bitrate: string,
  canFd: boolean
): CanHardware {
  return makeWrapper(
    async () => (await import(`${DOCAN}/vector/index`)).VECTOR_CAN,
    device,
    txId,
    rxId,
    bitrate,
    canFd
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Kvaser CAN  (Windows + Linux via linuxcan)
// ─────────────────────────────────────────────────────────────────────────────

export async function getKvaserDevices(): Promise<HardwareDevice[]> {
  try {
    const { KVASER_CAN } = await import(`${DOCAN}/kvaser/index`)
    const devices = KVASER_CAN.getValidDevices()
    return (devices || []).map((d: any) => ({
      id: `kvaser-${d.handle}`,
      label: `Kvaser  ${d.label ?? d.id}`,
      type: 'kvaser' as const,
      handle: d.handle,
      canFdCapable: true
    }))
  } catch {
    return []
  }
}

export function createKvaserHardware(
  device: HardwareDevice,
  txId: number,
  rxId: number,
  bitrate: string,
  canFd: boolean
): CanHardware {
  return makeWrapper(
    async () => (await import(`${DOCAN}/kvaser/index`)).KVASER_CAN,
    device,
    txId,
    rxId,
    bitrate,
    canFd
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// ZLG CAN  (Windows – ZCANPRO)
// ─────────────────────────────────────────────────────────────────────────────

export async function getZlgDevices(): Promise<HardwareDevice[]> {
  try {
    const { ZLG_CAN } = await import(`${DOCAN}/zlg/index`)
    const devices = ZLG_CAN.getValidDevices()
    return (devices || []).map((d: any) => ({
      id: `zlg-${d.handle}`,
      label: `ZLG  ${d.label ?? d.id}`,
      type: 'zlg' as const,
      handle: d.handle,
      canFdCapable: true
    }))
  } catch {
    return []
  }
}

export function createZlgHardware(
  device: HardwareDevice,
  txId: number,
  rxId: number,
  bitrate: string,
  canFd: boolean
): CanHardware {
  return makeWrapper(
    async () => (await import(`${DOCAN}/zlg/index`)).ZLG_CAN,
    device,
    txId,
    rxId,
    bitrate,
    canFd
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Candle CAN  (Windows – gs_usb / CANable variant)
// ─────────────────────────────────────────────────────────────────────────────

export async function getCandleDevices(): Promise<HardwareDevice[]> {
  try {
    const { Candle_CAN } = await import(`${DOCAN}/candle/index`)
    const devices = Candle_CAN.getValidDevices()
    return (devices || []).map((d: any) => ({
      id: `candle-${d.handle}`,
      label: `Candle  ${d.label ?? d.id}`,
      type: 'candle' as const,
      handle: d.handle,
      canFdCapable: true
    }))
  } catch {
    return []
  }
}

export function createCandleHardware(
  device: HardwareDevice,
  txId: number,
  rxId: number,
  bitrate: string,
  canFd: boolean
): CanHardware {
  return makeWrapper(
    async () => (await import(`${DOCAN}/candle/index`)).Candle_CAN,
    device,
    txId,
    rxId,
    bitrate,
    canFd
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// SLCAN  (ALL platforms – CANable, many USB-CAN adapters)
// Uses serialport library – no native CAN module needed.
// Works on Linux, Windows, macOS.
// Compatible devices: CANable 1.0 / 2.0, many cheap USB-CAN sticks
// ─────────────────────────────────────────────────────────────────────────────

export async function getSlcanDevices(): Promise<HardwareDevice[]> {
  try {
    const { SLCAN_CAN } = await import(`${DOCAN}/slcan/index`)
    const devices = await SLCAN_CAN.getValidDevices()
    return (devices || []).map((d: any) => ({
      id: `slcan-${d.id}`,
      label: `SLCAN  ${d.label ?? d.id}`,
      type: 'slcan' as const,
      serialPort: d.id, // SLCAN id IS the serial port path
      handle: d.handle,
      canFdCapable: false
    }))
  } catch {
    return []
  }
}

export function createSlcanHardware(
  device: HardwareDevice,
  txId: number,
  rxId: number,
  bitrate: string
): CanHardware {
  // For SLCAN, info.handle must be the serial port path (runtime string, typed as number)
  const info = buildCanBaseInfo(
    device.id,
    device.serialPort as any, // runtime: string used as port path
    device.serialPort ?? device.label,
    'slcan',
    bitrate,
    false
  )
  return new EcuBusCanWrapper(
    async () => (await import(`${DOCAN}/slcan/index`)).SLCAN_CAN,
    info,
    txId,
    rxId
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// TooMoss CAN  (Windows)
// ─────────────────────────────────────────────────────────────────────────────

export async function getTooMossDevices(): Promise<HardwareDevice[]> {
  try {
    const { TOOMOSS_CAN } = await import(`${DOCAN}/toomoss/index`)
    const devices = TOOMOSS_CAN.getValidDevices()
    return (devices || []).map((d: any) => ({
      id: `toomoss-${d.handle}`,
      label: `TooMoss  ${d.label ?? d.id}`,
      type: 'toomoss' as const,
      handle: d.handle,
      canFdCapable: true
    }))
  } catch {
    return []
  }
}

export function createTooMossHardware(
  device: HardwareDevice,
  txId: number,
  rxId: number,
  bitrate: string,
  canFd: boolean
): CanHardware {
  return makeWrapper(
    async () => (await import(`${DOCAN}/toomoss/index`)).TOOMOSS_CAN,
    device,
    txId,
    rxId,
    bitrate,
    canFd
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Enumerate ALL vendor devices
// ─────────────────────────────────────────────────────────────────────────────

export async function getAllVendorDevices(): Promise<HardwareDevice[]> {
  const results = await Promise.allSettled([
    getVectorDevices(),
    getKvaserDevices(),
    getZlgDevices(),
    getCandleDevices(),
    getSlcanDevices(),
    getTooMossDevices()
  ])
  return results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
}
