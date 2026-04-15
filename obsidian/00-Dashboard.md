# 🚀 CONK SDK — Build Dashboard
`@axiomtide/conk-sdk` · Axiom Tide LLC · April 2026

---

## Status

| Area | Status |
|------|--------|
| Repo scaffold | ✅ Ready to push |
| Types + config | ✅ Complete |
| Harbor module | ✅ Complete |
| Vessel module | ✅ Complete |
| Cast module | ✅ Complete |
| Receipt module | ✅ Complete |
| Attachments module | ✅ Complete |
| ConkClient entry point | ✅ Complete |
| Test suite scaffold | ✅ Complete |
| zkLogin signing wired | 🔴 Blocked — needs zklogin.ts extraction |
| Move call targets verified | 🟡 TODOs placed — needs client.ts review |
| npm publish | ⏳ Pending |
| Agent Spark integration | ⏳ Pending npm publish |

---

## Critical Path

```
zklogin.ts extraction → wire ConkClient.buildSigner() → full e2e test → npm publish → Agent Spark
```

The one real blocker before the SDK can run end-to-end is slotting the ZK proof generation + zkLogin signature assembly from `apps/conk/src/sui/zklogin.ts` into `ConkClient.ts` around line 100.

Daemon mode (private key) is fully functional — no zkLogin dependency.

---

## Links

- Repo: https://github.com/AXIOM-TIDE/conk-sdk
- conk.app: https://conk.app
- Cloudflare Worker: https://conk-zkproxy-v2.italktonumbers.workers.dev
- Package: `@axiomtide/conk-sdk`
- Grant deliverable: $25,000 Sui Foundation RFP — SDK milestone

---

## Related Notes

- [[Architecture]]
- [[Build Tracker]]
- [[Key Decisions]]
- [[Sui Foundation Grant]]
