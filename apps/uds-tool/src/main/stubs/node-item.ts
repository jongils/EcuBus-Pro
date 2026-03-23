/**
 * Minimal NodeClass stub.
 *
 * EcuBus-Pro's NodeClass is a complex graph/network node that handles
 * TX-pending callbacks. In the UDS tool context we never set txPendingNode,
 * so this stub just satisfies the type requirement.
 */
export class NodeClass {
  async callTxPending(_msg: unknown): Promise<unknown> {
    return undefined
  }
}
