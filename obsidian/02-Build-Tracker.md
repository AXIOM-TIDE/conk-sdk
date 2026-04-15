# Build Tracker — @axiomtide/conk-sdk

## Phase 1 — Scaffold (Done ✅)
- [x] Directory structure: `src/`, `tests/`, `obsidian/`
- [x] `package.json` — name, deps, jest config, prepublishOnly
- [x] `tsconfig.json` — strict mode, ES2020, commonjs out
- [x] `.gitignore`
- [x] `src/types.ts` — all interfaces, ConkError, ConkErrorCode enum
- [x] `src/config.ts` — contract addresses, RPC, proxy, helpers
- [x] `src/Receipt.ts` — tx verification, onRead() event subscription
- [x] `src/Attachments.ts` — Walrus upload, url()
- [x] `src/Cast.ts` — publish(), read() with PTB construction
- [x] `src/Vessel.ts` — create(), publish(), read() delegation
- [x] `src/Harbor.ts` — load(), balance(), sweep(), createVessel()
- [x] `src/ConkClient.ts` — entry point, auth modes, harbor()
- [x] `src/index.ts` — clean re-export surface
- [x] `tests/sdk.test.ts` — unit test scaffold
- [x] `README.md` — complete API documentation

## Phase 2 — Wire zkLogin Signing 🔴
- [ ] Open `apps/conk/src/sui/zklogin.ts`
- [ ] Extract `fetchZkProof(proxyUrl, txBytes, session)` function
- [ ] Extract `assembleZkLoginSignature(proof, session, ephemeralSig)` function
- [ ] Slot both into `ConkClient.buildSigner()` — see TODO comment at line ~100
- [ ] Run e2e test: publish a cast as a logged-in user on testnet

## Phase 3 — Move Call Verification 🟡
- [ ] Open `apps/conk/src/sui/client.ts`
- [ ] Confirm exact `target` strings for:
  - `harbor::create`
  - `harbor::sweep`
  - `vessel::create`
  - `cast::publish`
  - `cast::read`
- [ ] Confirm argument ordering matches PTB calls in Harbor.ts, Vessel.ts, Cast.ts
- [ ] Confirm event type strings (`::cast::ReadEvent`, `::cast::ReadResult`)

## Phase 4 — Tests ⏳
- [ ] All Phase 1 unit tests passing (`npm test`)
- [ ] Integration test: daemon mode (private key) end-to-end on devnet
- [ ] Integration test: zkLogin mode end-to-end on testnet
- [ ] Coverage > 80%

## Phase 5 — Publish ⏳
- [ ] Register `@axiomtide` org on npmjs.com
- [ ] `npm run build` — clean dist/
- [ ] `npm publish --access public`
- [ ] Verify: `npm install @axiomtide/conk-sdk` in fresh project

## Phase 6 — Agent Spark Integration ⏳
- [ ] Add `@axiomtide/conk-sdk` to Agent Spark daemon template
- [ ] Implement daemon purchase flow using SDK
- [ ] Document in Agent Spark README
- [ ] Screenshot/recording for Sui Foundation proof of completion

---

## Time Log

| Date | Hours | Work |
|------|-------|------|
| 2026-04-15 | ~3h | Scaffold, all modules, types, tests, README |
| | | |
