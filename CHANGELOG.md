# Changelog

All notable changes to `@axiomtide/conk-sdk` are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

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
