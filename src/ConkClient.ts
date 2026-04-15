/**
 * @axiomtide/conk-sdk — ConkClient
 * Main entry point. Initialise once, access all protocol surfaces.
 *
 * Two auth modes:
 *   1. zkLogin session  — for human users (Google OAuth, browser)
 *   2. Private key      — for daemons / Agent Spark workers
 */

import { SuiClient, getFullnodeUrl }   from '@mysten/sui/client'
import { Ed25519Keypair }              from '@mysten/sui/keypairs/ed25519'
import { Transaction }                 from '@mysten/sui/transactions'
import { Harbor }                      from './Harbor'
import { Attachments }                 from './Attachments'
import { DEFAULT_PROXY, RPC_ENDPOINTS } from './config'
import { ConkError, ConkErrorCode }    from './types'
import type {
  ConkClientConfig,
  Network,
  ZkLoginSession,
} from './types'

export class ConkClient {
  readonly network:      Network
  readonly proxyUrl:     string
  readonly attachments:  Attachments
  readonly suiClient:    SuiClient

  private session?:    ZkLoginSession
  private keypair?:    Ed25519Keypair
  private harborCache: Harbor | null = null

  constructor(config: ConkClientConfig = {}) {
    this.network  = config.network ?? 'mainnet'
    this.proxyUrl = config.proxy   ?? DEFAULT_PROXY

    this.suiClient = new SuiClient({
      url: RPC_ENDPOINTS[this.network] ?? getFullnodeUrl(this.network),
    })

    this.attachments = new Attachments()

    // Auth: zkLogin session takes precedence over private key
    if (config.zkLoginSession) {
      this.session = config.zkLoginSession
    } else if (config.privateKey) {
      this.keypair = Ed25519Keypair.fromSecretKey(
        Buffer.from(config.privateKey.replace('0x', ''), 'hex'),
      )
    }
  }

  // ─── Session management ───────────────────────────────────────────────────

  /** Load a zkLogin session after OAuth (browser use). */
  setSession(session: ZkLoginSession): void {
    this.session    = session
    this.keypair    = undefined
    this.harborCache = null
  }

  /** Clear session and keypair. */
  clearSession(): void {
    this.session     = undefined
    this.keypair     = undefined
    this.harborCache  = null
  }

  isAuthenticated(): boolean {
    return !!(this.session ?? this.keypair)
  }

  currentAddress(): string {
    if (this.session) return this.session.address
    if (this.keypair) return this.keypair.getPublicKey().toSuiAddress()
    throw new ConkError(
      'Not authenticated — call setSession() or pass privateKey in config',
      ConkErrorCode.INVALID_CONFIG,
    )
  }

  // ─── Harbor ───────────────────────────────────────────────────────────────

  /**
   * Load (or create) a Harbor for the current identity.
   * Harbor is cached per-session; call again after setSession() to refresh.
   */
  async harbor(options?: {
    spendingCapCents?: number
    forceRefresh?: boolean
  }): Promise<Harbor> {
    if (this.harborCache && !options?.forceRefresh) {
      return this.harborCache
    }

    this.harborCache = await Harbor.load(
      this.suiClient,
      this.network,
      this.requireSession(),
      this.buildSigner(),
      options?.spendingCapCents,
    )

    return this.harborCache
  }

  // ─── Internal helpers ─────────────────────────────────────────────────────

  private requireSession(): ZkLoginSession {
    if (this.session) return this.session

    // For keypair mode — synthesise a minimal session-like object
    if (this.keypair) {
      return {
        address:          this.keypair.getPublicKey().toSuiAddress(),
        proof:            {} as ZkLoginSession['proof'],
        ephemeralKeyPair: { publicKey: '', privateKey: '' },
        maxEpoch:         0,
        randomness:       '',
        salt:             '',
      }
    }

    throw new ConkError(
      'Not authenticated',
      ConkErrorCode.INVALID_CONFIG,
    )
  }

  /**
   * Returns a sign-and-execute function appropriate for the current auth mode.
   *
   * NOTE: The zkLogin signing path calls the Cloudflare Worker proxy to generate
   * the ZK proof, then assembles the zkLogin signature. The exact proof-assembly
   * logic lives in the app's zklogin.ts — extract and slot it here.
   */
  private buildSigner(): (tx: Transaction) => Promise<{ digest: string }> {
    const suiClient = this.suiClient
    const proxyUrl  = this.proxyUrl

    // ── Keypair (daemon) mode ─────────────────────────────────────────────
    if (this.keypair) {
      const kp = this.keypair
      return async (tx: Transaction) => {
        tx.setSender(kp.getPublicKey().toSuiAddress())

        const bytes  = await tx.build({ client: suiClient })
        const signed = await kp.signTransaction(bytes)

        const result = await suiClient.executeTransactionBlock({
          transactionBlock: bytes,
          signature:        signed.signature,
          options: { showEffects: true, showObjectChanges: true, showEvents: true },
        })

        if (result.effects?.status?.status !== 'success') {
          throw new ConkError(
            `Transaction failed: ${result.effects?.status?.error ?? 'unknown'}`,
            ConkErrorCode.TRANSACTION_FAILED,
            { digest: result.digest },
          )
        }

        return { digest: result.digest }
      }
    }

    // ── zkLogin mode ───────────────────────────────────────────────────────
    if (this.session) {
      const session = this.session

      return async (tx: Transaction) => {
        tx.setSender(session.address)

        await tx.build({ client: suiClient })

        // TODO: extract the proof-generation + zkLogin signature assembly
        // from apps/conk/src/sui/zklogin.ts and call it here.
        //
        // Shape expected:
        //   const proof    = await fetchZkProof(proxyUrl, bytes, session)
        //   const zkSig    = assembleZkLoginSignature(proof, session)
        //
        // For now, placeholder to unblock downstream build:
        void proxyUrl

        throw new ConkError(
          'zkLogin signing not yet wired — extract from zklogin.ts and slot here',
          ConkErrorCode.PROOF_GENERATION_FAILED,
        )
      }
    }

    throw new ConkError('Not authenticated', ConkErrorCode.INVALID_CONFIG)
  }
}
