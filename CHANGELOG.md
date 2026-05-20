# Changelog

All notable changes to `@axiomtide/conk-sdk` are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

## [Unreleased]

### Planned
- zkLogin signing wired into ConkClient
- Move call targets verified against CONK mainnet contracts
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
