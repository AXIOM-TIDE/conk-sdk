# Key Decisions — @axiomtide/conk-sdk

## Decision 1 — Dual Auth Mode
**Question:** How do daemons authenticate without Google OAuth?

**Decision:** `ConkClient` accepts either a `zkLoginSession` (browser) or a raw `privateKey` (daemon). Keypair mode bypasses ZK proof generation entirely — clean Ed25519 sign and execute.

**Consequence:** Agent Spark daemons work out of the box with a private key env var. Zero browser dependency.

---

## Decision 2 — Proxy Configurable, Not Hardcoded
**Question:** Should the Cloudflare Worker URL be hardcoded?

**Decision:** Default to `https://conk-zkproxy-v2.italktonumbers.workers.dev` but allow override via `ConkClientConfig.proxy`. Makes it testable against a local Worker and future-proof if the proxy URL changes.

---

## Decision 3 — Harbor Cached Per Session
**Question:** Should `conk.harbor()` create a new Harbor each call?

**Decision:** Cache the Harbor instance on `ConkClient`. Cleared on `setSession()` / `clearSession()`. Pass `forceRefresh: true` to bypass. Avoids redundant RPC calls during a session.

---

## Decision 4 — Spending Cap on Harbor, Not Vessel
**Question:** Where to enforce the daemon spending cap?

**Decision:** Spending cap lives on `Harbor.sweep()`. Vessels pull fuel from Harbor at creation time, so the cap controls total outflows. Simpler than per-vessel limits.

---

## Decision 5 — Receipt Polling, Not WebSocket
**Question:** How to implement `cast.onRead()` event subscription?

**Decision:** Poll `suiClient.queryEvents()` every 10 seconds (configurable). WebSocket subscriptions via Sui are less reliable across network conditions. Polling is deterministic, retry-friendly, and easy to cancel.

---

## Decision 6 — Move Calls as TODOs, Not Guessed
**Question:** Should I guess the exact Move module paths?

**Decision:** Mark exact `target` strings as explicit `// TODO` comments rather than guess. Wrong Move targets cause silent on-chain failures. The correct strings are a 5-minute read of `client.ts` — not worth guessing and debugging later.

---

## Open Question — Testnet Contract Addresses
The `CONTRACTS.testnet` and `CONTRACTS.devnet` entries are empty. Needed for:
- Running the integration test suite without spending real USDC
- CI/CD pipeline

Action: deploy CONK contracts to testnet and populate `src/config.ts`.
