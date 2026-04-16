/**
 * @axiomtide/conk-sdk — Gas
 * Estimate and validate gas budgets before transaction submission.
 * Prevents daemons from failing mid-task due to insufficient gas.
 */

import { SuiClient }    from '@mysten/sui/client'
import { Transaction }  from '@mysten/sui/transactions'
import { withRpcRetry } from './retry'
import { ConkError, ConkErrorCode } from './types'

// ─── Constants ────────────────────────────────────────────────────────────────

/** Safety multiplier on top of estimated gas — covers price spikes */
const GAS_SAFETY_BUFFER = 1.25

/** Minimum SUI balance required to cover gas for one transaction (in MIST) */
const MIN_SUI_BALANCE_MIST = BigInt(10_000_000)  // 0.01 SUI

/** 1 SUI in MIST */
const MIST_PER_SUI = BigInt(1_000_000_000)

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GasEstimate {
  /** Estimated gas cost in MIST */
  estimatedMist: bigint
  /** Recommended budget with safety buffer in MIST */
  recommendedBudget: bigint
  /** Estimated cost in SUI (human readable) */
  estimatedSui: string
  /** Whether the address has enough SUI to cover gas */
  canAfford: boolean
  /** Current SUI balance in MIST */
  suiBalance: bigint
}

// ─── Gas estimator ────────────────────────────────────────────────────────────

export class Gas {
  constructor(private readonly suiClient: SuiClient) {}

  /**
   * Dry-run a transaction and return a gas estimate.
   * Call before executing any PTB to avoid on-chain failures.
   */
  async estimate(
    tx:     Transaction,
    sender: string,
  ): Promise<GasEstimate> {
    // Fetch SUI balance in parallel with dry run
    const [dryRun, suiBalance] = await Promise.all([
      withRpcRetry(async () =>
        this.suiClient.dryRunTransactionBlock({
          transactionBlock: await tx.build({ client: this.suiClient }),
        }),
      ),
      this.suiBalance(sender),
    ])

    if (dryRun.effects.status.status !== 'success') {
      throw new ConkError(
        `Transaction would fail: ${dryRun.effects.status.error ?? 'unknown'}`,
        ConkErrorCode.TRANSACTION_FAILED,
        { dryRunError: dryRun.effects.status.error },
      )
    }

    const gasSummary    = dryRun.effects.gasUsed
    const computationCost = BigInt(gasSummary.computationCost)
    const storageCost     = BigInt(gasSummary.storageCost)
    const storageRebate   = BigInt(gasSummary.storageRebate)

    const estimatedMist    = computationCost + storageCost - storageRebate
    const recommendedBudget = BigInt(
      Math.ceil(Number(estimatedMist) * GAS_SAFETY_BUFFER),
    )

    return {
      estimatedMist,
      recommendedBudget,
      estimatedSui:  this.mistToSui(estimatedMist),
      canAfford:     suiBalance >= recommendedBudget,
      suiBalance,
    }
  }

  /**
   * Estimate and automatically set the gas budget on a transaction.
   * Throws if the sender cannot afford it.
   */
  async setBudget(tx: Transaction, sender: string): Promise<GasEstimate> {
    const estimate = await this.estimate(tx, sender)

    if (!estimate.canAfford) {
      throw new ConkError(
        `Insufficient SUI for gas. Need ~${estimate.estimatedSui} SUI, ` +
        `have ${this.mistToSui(estimate.suiBalance)} SUI`,
        ConkErrorCode.INSUFFICIENT_BALANCE,
        {
          required: estimate.recommendedBudget.toString(),
          available: estimate.suiBalance.toString(),
        },
      )
    }

    tx.setGasBudget(estimate.recommendedBudget)
    return estimate
  }

  /**
   * Quick check — does this address have enough SUI to do anything?
   */
  async hasMinimumGas(address: string): Promise<boolean> {
    const balance = await this.suiBalance(address)
    return balance >= MIN_SUI_BALANCE_MIST
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private async suiBalance(address: string): Promise<bigint> {
    const balance = await withRpcRetry(async () =>
      this.suiClient.getBalance({ owner: address }),
    )
    return BigInt(balance.totalBalance)
  }

  private mistToSui(mist: bigint): string {
    const whole    = mist / MIST_PER_SUI
    const fraction = mist % MIST_PER_SUI
    return `${whole}.${fraction.toString().padStart(9, '0').slice(0, 4)}`
  }
}
