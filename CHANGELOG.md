# Changelog

All notable changes to `@axiomtide/conk-sdk` are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.6.0] — 2026-05-21

### Breaking Changes — CONK v11 Protocol

CONK v11 deployed on Sui mainnet (package `0x734b19fa...`, tx `FzZPXnyBKqFit...`).

**`Cast.publish()` / `Vessel.publish()`** — `vesselCapId: string` is now a required
parameter (last argument to `Cast.publish()`). The contract no longer accepts raw
`vessel_id + vessel_tier` — it requires the actual `Vessel` and `VesselCap` objects.
`Vessel.publish()` reads `capObjectId` from `VesselState` automatically. Vessels
created before v11 must be re-created to populate `capObjectId`.

**`Cast.read()`** — `ProtocolConfig` shared object added at argument position [3].
Handled automatically by the SDK using the `PROTOCOL_CONFIG_ID` constant.

**`Stream.create()` / `StreamCreateOptions`** — `vesselId: string` field is now
required in `StreamCreateOptions`. Pass the publisher's `Vessel.objectId()`.

### New Features

- **`Vessel.getReputation()`** — Fetch on-chain reputation for a Vessel.
  Returns `castCount`, `lighthouseCount`, `tier`, `createdAt`, `expiresAt`,
  `lighthouseRate` (lighthouse_count / cast_count), and `ageDays`.

- **`Vessel.fetchReputation(suiClient, vesselObjectId)`** — Static variant for
  fetching any Vessel's reputation by object ID without a Vessel instance.

- **`isLighthouse(suiClient, castId)`** — Check if a Cast is in the
  on-chain `LighthouseRegistry`. Returns `boolean`. Uses Sui dynamic field
  lookup (no transaction required).

- **`getLighthouseEntry(suiClient, castId)`** — Fetch `LighthouseEntry` from
  the on-chain registry. Returns `{ castId, vesselId, lighthouseId,
  registeredAt, birthPath, totalReadsAtBirth, lastVisitAt }` or `null`.

- **`VesselReputation` type** — exported from package root.

- **`LighthouseEntry` type** — exported from package root.

- **`CONK_PACKAGE_ID`, `PROTOCOL_CONFIG_ID`, `LIGHTHOUSE_REGISTRY_ID`** —
  all exported from package root for consumers that build their own PTBs.

### New Shared Object Addresses (v11)

| Constant | Object ID |
|---|---|
| `CONK_PACKAGE_ID` | `0x734b19fa1696dec30f8cae38f1cdbf0ab5a12720735f7c7b0d4935cab31732cc` |
| `PROTOCOL_CONFIG_ID` | `0xdc8e5131d6e3bec492a2e12b1d7beddbfec709ae5def8e775dab59c7a45421ea` |
| `LIGHTHOUSE_REGISTRY_ID` | `0x5ee0f0a6ad1b89412a2e05def4f1e0ad6e606df3751c030e9601fd155b444e94` |
| Abyss | `0x075c8667d1780bdde01a8175cd458aa345b3f6e2a84c45b91f82b344a4325bd0` |
| Drift | `0x9312b6837bb12381849b413636064cd8d56b6ef84bf891b3f756b3cbb6157fad` |

All IDs are overrideable via environment variables:
`CONK_PACKAGE_ID`, `CONK_PROTOCOL_CONFIG_ID`, `CONK_LIGHTHOUSE_REGISTRY_ID`.

---

## [0.2.0] — 2026-04-30

### Fixed
- **`Cast.publish()`** — rebuilt PTB to match verified mainnet signature (tx `CWWbABJn2vXH9EnDZTjeC9DmfuBRR2v18cgJMVXSY4DL`). Adds `SplitCoins` for the 1000-unit Abyss sound fee, passes all 12 inputs in the correct order including `&mut Abyss`, `object::ID` vessel ID, `vector<u8>` hook/body, BCS-encoded `Option<vector<u8>>` attachment, and `&Clock`.
- **`Cast.read()`** — rebuilt PTB to match on-chain ABI. Fetches the cast's price on-chain, splits the reader's USDC coin for exact payment, and passes `cast::read(castObj, coin, abyss, readerAddr, clock)` in the correct order.

### Added
- **`Receipt.awaitRead(timeoutMs?)`** — Promise-based complement to `onRead()`. Resolves with the first `ReadEvent` received; rejects with `ConkError` if the optional timeout elapses.
- **`Vessel.claimName(name)`** — sounds a special identity cast with hook `[VESSEL:NAME] <name>` and JSON body containing vessel metadata. Returns `{ castId, txDigest }`.
- **`VesselRegistry`** — new class. `findVessel({ name?, vesselId?, limit? })` queries CONK `cast` module events and returns `VesselEntry[]` filtered by name and/or vessel ID.
- Exported `VesselRegistry`, `VesselEntry`, and `FindVesselOptions` from the package root.

### Changed
- `Cast.read()` accepts an optional `session?: ZkLoginSession` parameter (6th arg) for USDC coin selection and reader address. `Vessel.read()` forwards the vessel's session automatically — no consumer API change.
- `USDC_TYPE` is now re-exported from `config.ts` and used internally for coin queries.

## [0.6.0] — 2026-05-21 — CONK v11 Compatibility

> Deploy tx: `FzZPXnyBKqFitg5KU5cApHjx8G75dexk9vdnBewen8dL`

### v11 Contract Addresses (mainnet)

| Object | ID |
|---|---|
| Package | `0x734b19fa1696dec30f8cae38f1cdbf0ab5a12720735f7c7b0d4935cab31732cc` |
| Abyss | `0x075c8667d1780bdde01a8175cd458aa345b3f6e2a84c45b91f82b344a4325bd0` |
| Drift | `0x9312b6837bb12381849b413636064cd8d56b6ef84bf891b3f756b3cbb6157fad` |
| ProtocolConfig *(new)* | `0xdc8e5131d6e3bec492a2e12b1d7beddbfec709ae5def8e775dab59c7a45421ea` |
| LighthouseRegistry *(new)* | `0x5ee0f0a6ad1b89412a2e05def4f1e0ad6e606df3751c030e9601fd155b444e94` |

### Breaking Changes

- **`Cast.publish()` / `cast::sound` PTB** — `vessel_id: ID` + `vessel_tier: u8` replaced by `&mut Vessel` + `&VesselCap` object references (args [2] and [3]). The contract now derives identity and tier from the on-chain object directly. `Cast.publish()` gains a required 7th parameter `vesselCapId: string`. All callers via `Vessel.publish()` are handled automatically once the Vessel carries `capObjectId`.

- **`Cast.read()` / `cast::read` PTB** — `ProtocolConfig` shared object added at argument position [3]. New call signature: `(cast, fee_coin, abyss, config, reader, clock)`. No consumer API change — `PROTOCOL_CONFIG_ID` is injected automatically.

- **`lighthouse::raise` PTB** — The Beacon publish flow now sends a second transaction to register each Lighthouse in the `LighthouseRegistry`. `Beacon.publish()` calls `vessel.raiseToLighthouse(castId)` after every successful cast. Old raw-ID params replaced by `&mut Cast`, `&mut Vessel`, `&VesselCap`, `&mut LighthouseRegistry`, `&Drift`, `&Clock`.

- **`Stream.create()` / `stream::create` PTB** — `vesselId` added to `StreamCreateOptions` and inserted as arg [2] in the PTB. Streams are now attributed to a Vessel identity. **Existing callers must add `vesselId` to `StreamCreateOptions`.**

### Added

- **`CONK_PACKAGE_ID`** — exported constant for the v11 package address. Overridable via `CONK_PACKAGE_ID` env var. Hardcoded default is the mainnet v11 deploy address.
- **`PROTOCOL_CONFIG_ID`** — exported constant for the v11 `ProtocolConfig` shared object. Overridable via `CONK_PROTOCOL_CONFIG_ID` env var.
- **`LIGHTHOUSE_REGISTRY_ID`** — exported constant for the v11 `LighthouseRegistry` shared object. Overridable via `CONK_LIGHTHOUSE_REGISTRY_ID` env var.
- **`PENDING_V11_DEPLOY`** — sentinel string value for unconfigured deployments.
- **`Vessel.raiseToLighthouse(castId, registryId?)`** — builds and executes `lighthouse::raise` PTB. Registers a published Cast in the on-chain LighthouseRegistry.
- **`Vessel.capObjectId()`** — accessor for the `VesselCap` object ID stored in `VesselState`.
- **`Vessel.create()`** now captures the `VesselCap` object ID from tx object changes and stores it in `VesselState.capObjectId`.
- **`VesselState.capObjectId?`** — new optional field on the `VesselState` interface.
- **`getVesselReputation(suiClient, vesselId, network?)`** — new function. Reads the `vessel::Reputation` dynamic field and returns cast count, unique readers, total earned, read count, trust score, and last activity timestamp. Returns `null` for vessels with no record yet.
- **`getVesselReputations(suiClient, vesselIds[], network?)`** — batch variant; fetches in parallel and returns a `Map<string, VesselReputation | null>`.
- **`isLighthouse(suiClient, castId, registryId?)`** — returns `true` if the given Cast has been raised into the `LighthouseRegistry`.
- **`getLighthouseEntry(suiClient, castId, registryId?)`** — returns the full `LighthouseEntry` from the registry (beacon ID, price, media type, category, blob ID, tags, raisedAt), or `null` if not found.

### Changed

- `CONTRACTS` object is no longer `as const` — the `package` field is now dynamically populated from `CONK_PACKAGE_ID` at module load time.
- `CONTRACTS.mainnet.abyss` and `CONTRACTS.mainnet.drift` updated to v11 addresses.

## [Unreleased]

### Planned
- zkLogin signing wired into ConkClient
- Integration test suite (devnet)
- CI/CD pipeline via GitHub Actions

---

## [0.1.0] — 2026-04-15

### Added
- `ConkClient` — main entry point with dual auth (zkLogin + private key)
- `Harbor` — USDC deposit address, balance query, sweep, Vessel factory
- `Vessel` — anonymous identity, publish and read delegation
- `Cast` — PTB construction for publish and read, onRead() event subscription
- `Receipt` — on-chain tx verification, WebSocket subscription with polling fallback and exponential backoff
- `Attachments` — Walrus decentralised file storage upload
- `retry.ts` — exponential backoff with jitter for all RPC and tx calls
- Full TypeScript types and `ConkError` with typed error codes
- Unit test suite (11 tests, Jest)
- README with full API documentation and Agent Spark daemon pattern
