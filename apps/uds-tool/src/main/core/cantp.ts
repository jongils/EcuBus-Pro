import { CanFrame, CanHardware } from './hardware/interface'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Send a UDS PDU over CAN-TP (ISO 15765-2)
 * Handles SF (≤7 bytes) and FF+CF segmentation for longer messages
 */
export async function canTpSend(
  hw: CanHardware,
  txId: number,
  rxId: number,
  payload: Buffer
): Promise<void> {
  if (payload.length <= 7) {
    // Single Frame
    const frame = Buffer.alloc(8, 0)
    frame[0] = payload.length & 0x0f
    payload.copy(frame, 1)
    await hw.send({ id: txId, data: frame })
  } else {
    // First Frame
    const ff = Buffer.alloc(8, 0)
    ff[0] = 0x10 | ((payload.length >> 8) & 0x0f)
    ff[1] = payload.length & 0xff
    payload.copy(ff, 2, 0, 6)
    await hw.send({ id: txId, data: ff })

    // Wait for Flow Control
    const fcFrame = await hw.receive(rxId, 1000)
    if (!fcFrame) throw new Error('CAN-TP: No Flow Control received (timeout)')
    if ((fcFrame.data[0] & 0xf0) !== 0x30)
      throw new Error(`CAN-TP: Expected FC frame, got 0x${fcFrame.data[0].toString(16)}`)

    const fs = fcFrame.data[0] & 0x0f
    if (fs === 1) throw new Error('CAN-TP: Flow Control WAIT - not supported in basic mode')
    if (fs === 2) throw new Error('CAN-TP: Flow Control OVERFLOW')

    const blockSize = fcFrame.data[1] // 0 = no limit
    const stMin = fcFrame.data[2] // Separation time (ms)

    // Send Consecutive Frames
    let sn = 1
    let offset = 6
    let blockCount = 0

    while (offset < payload.length) {
      const remaining = payload.length - offset
      const copyLen = Math.min(7, remaining)

      const cf = Buffer.alloc(8, 0)
      cf[0] = 0x20 | (sn & 0x0f)
      payload.copy(cf, 1, offset, offset + copyLen)
      await hw.send({ id: txId, data: cf })

      offset += copyLen
      sn = (sn + 1) & 0x0f
      blockCount++

      if (stMin > 0) await sleep(stMin)

      if (blockSize > 0 && blockCount >= blockSize && offset < payload.length) {
        const nextFc = await hw.receive(rxId, 1000)
        if (!nextFc) throw new Error('CAN-TP: No FC for next block')
        if ((nextFc.data[0] & 0xf0) !== 0x30) throw new Error('CAN-TP: Expected FC frame')
        blockCount = 0
      }
    }
  }
}

/**
 * Receive a UDS PDU over CAN-TP (ISO 15765-2)
 * Handles SF and FF+CF reassembly
 */
export async function canTpReceive(
  hw: CanHardware,
  rxId: number,
  txId: number,
  timeoutMs: number
): Promise<Buffer> {
  const firstFrame = await hw.receive(rxId, timeoutMs)
  if (!firstFrame) throw new Error('CAN-TP: No response received (timeout)')

  const frameType = (firstFrame.data[0] & 0xf0) >> 4

  if (frameType === 0x0) {
    // Single Frame
    const len = firstFrame.data[0] & 0x0f
    return Buffer.from(firstFrame.data.slice(1, 1 + len))
  } else if (frameType === 0x1) {
    // First Frame - start reassembly
    const totalLen = ((firstFrame.data[0] & 0x0f) << 8) | firstFrame.data[1]
    const result = Buffer.alloc(totalLen)
    firstFrame.data.copy(result, 0, 2, 8)
    let received = 6

    // Send Flow Control (Continue to Send, no block limit)
    const fc = Buffer.alloc(8, 0)
    fc[0] = 0x30 // CTS, BS=0, STmin=0
    await hw.send({ id: txId, data: fc })

    // Receive Consecutive Frames
    while (received < totalLen) {
      const cf = await hw.receive(rxId, 1000)
      if (!cf) throw new Error('CAN-TP: Timeout waiting for consecutive frame')
      if ((cf.data[0] & 0xf0) !== 0x20)
        throw new Error(`CAN-TP: Expected CF frame, got 0x${cf.data[0].toString(16)}`)

      const copyLen = Math.min(7, totalLen - received)
      cf.data.copy(result, received, 1, 1 + copyLen)
      received += copyLen
    }

    return result
  } else if (frameType === 0x3) {
    // Unexpected Flow Control
    throw new Error('CAN-TP: Received unexpected Flow Control frame')
  } else {
    throw new Error(`CAN-TP: Unknown frame type 0x${frameType.toString(16)}`)
  }
}

/** Send UDS request and receive response (handles CAN-TP + direct modes) */
export async function udsTransaction(
  hw: CanHardware,
  txId: number,
  rxId: number,
  request: Buffer,
  timeoutMs = 2000
): Promise<Buffer> {
  await canTpSend(hw, txId, rxId, request)
  return canTpReceive(hw, rxId, txId, timeoutMs)
}

/** Parse a negative response - returns NRC description */
export function parseNrc(nrc: number): string {
  const NRC_MAP: Record<number, string> = {
    0x10: 'generalReject',
    0x11: 'serviceNotSupported',
    0x12: 'subFunctionNotSupported',
    0x13: 'incorrectMessageLengthOrInvalidFormat',
    0x14: 'responseTooLong',
    0x21: 'busyRepeatRequest',
    0x22: 'conditionsNotCorrect',
    0x24: 'requestSequenceError',
    0x25: 'noResponseFromSubnetComponent',
    0x26: 'failurePreventsExecutionOfRequestedAction',
    0x31: 'requestOutOfRange',
    0x33: 'securityAccessDenied',
    0x35: 'invalidKey',
    0x36: 'exceededNumberOfAttempts',
    0x37: 'requiredTimeDelayNotExpired',
    0x70: 'uploadDownloadNotAccepted',
    0x71: 'transferDataSuspended',
    0x72: 'generalProgrammingFailure',
    0x73: 'wrongBlockSequenceCounter',
    0x78: 'requestCorrectlyReceivedResponsePending',
    0x7e: 'subFunctionNotSupportedInActiveSession',
    0x7f: 'serviceNotSupportedInActiveSession'
  }
  return NRC_MAP[nrc] || `unknownNrc_0x${nrc.toString(16).padStart(2, '0')}`
}

export function checkResponse(response: Buffer, expectedSid: number): void {
  if (response[0] === 0x7f) {
    const sid = response[1]
    const nrc = response[2]
    if (nrc === 0x78) {
      // Response pending - caller should retry
      throw new Object({ pending: true, sid, nrc })
    }
    throw new Error(
      `Negative Response [SID=0x${sid.toString(16)}, NRC=0x${nrc.toString(16)}]: ${parseNrc(nrc)}`
    )
  }
  if (response[0] !== expectedSid + 0x40) {
    throw new Error(
      `Unexpected response SID: expected 0x${(expectedSid + 0x40).toString(16)}, got 0x${response[0].toString(16)}`
    )
  }
}
