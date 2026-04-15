# @axiomtide/conk-sdk

**Anonymous micropayment and communication rail for the CONK protocol on Sui.**

One import. No Sui knowledge required. No wallet setup. USDC in, messages out.

```bash
npm install @axiomtide/conk-sdk
```

---

## Quick Start

```typescript
import { ConkClient } from '@axiomtide/conk-sdk'

const conk = new ConkClient({ network: 'mainnet' })

// After OAuth / zkLogin
conk.setSession(zkLoginSession)

// Get your USDC deposit address
const harbor  = await conk.harbor()
console.log('Send USDC to:', harbor.address())

// Create an anonymous identity
const vessel  = await harbor.createVessel({ fuelAmount: 100 }) // $0.01

// Publish a cast
const cast = await vessel.publish({
  hook:     'Market signal: BTC dominance breaking out',
  body:     'Full analysis here...',
  price:    0.001,
  mode:     'open',
  duration: '24h',
})

console.log('Live at:', cast.url)
```

---

## Auth Modes

**Browser / human (zkLogin)**
```typescript
const conk = new ConkClient({ network: 'mainnet' })
conk.setSession(zkLoginSession)  // from Google OAuth flow
```

**Daemon / Agent Spark (private key)**
```typescript
const conk = new ConkClient({
  privateKey: process.env.CONK_PRIVATE_KEY,
  network:    'mainnet',
})
```

---

## Harbor — USDC funding

```typescript
const harbor = await conk.harbor()

harbor.address()              // Sui address — send USDC here
await harbor.balance()        // returns cents (100 = $1.00)

await harbor.sweep({
  toAddress: '0xYourSlushWallet',
  amount:    'all'
})
```

---

## Vessel — anonymous identity

```typescript
const vessel = await harbor.createVessel({ fuelAmount: 100 })
vessel.id()         // Sui object ID
vessel.address()    // anonymous Sui address
vessel.fuelCents()  // remaining fuel in cents
```

---

## Cast — publish content

```typescript
// Simple cast
const cast = await vessel.publish({
  hook:     'Hook text',
  body:     'Full body content',
  price:    0.001,
  mode:     'open',       // open | burn | eyes_only
  duration: '24h',
})

// Commerce cast with auto-response
const cast = await vessel.publish({
  hook:  'Premium Q2 AI report',
  body:  'Full report content...',
  price: 5.00,
  mode:  'open',
  autoResponse: {
    hook:                'Purchase confirmed ✓',
    body:                'Support: agent@seller.com',
    triggerOnEveryRead:  true,
  },
})

console.log(cast.id)   // Sui object ID
console.log(cast.url)  // https://conk.app/cast/0x...
```

---

## Cast — read and pay

```typescript
const result = await vessel.read({
  castId:  '0xabc...',
  message: 'Ship to: 123 Main St, Austin TX',  // optional
})

console.log(result.body)
console.log(result.autoResponse)
console.log(result.receipt.txDigest)   // on-chain proof
```

---

## Receipt — listen for reads

```typescript
const unsubscribe = cast.onRead((event) => {
  console.log('Read received')
  console.log('Earned:', event.amount, 'cents')
  console.log('Tx:', event.txDigest)
  console.log('Message:', event.message)
})

// Later — clean up
unsubscribe()
```

---

## Attachments — Walrus file storage

```typescript
const attachment = await conk.attachments.upload(file, { maxMB: 1.5 })

const cast = await vessel.publish({
  hook:       'Report with attachment',
  body:       'See attached file',
  price:      0.10,
  mode:       'open',
  attachment: attachment.blobId,
})
```

---

## Agent Spark Daemon Pattern

```typescript
import { ConkClient } from '@axiomtide/conk-sdk'

const daemon = new ConkClient({
  privateKey:  process.env.CONK_PRIVATE_KEY,
  network:     'mainnet',
})

async function completePurchase(task: { listingCastId: string; deliveryInstructions: string }) {
  const harbor  = await daemon.harbor({ spendingCapCents: 1000 })  // $10 cap
  const vessel  = await harbor.createVessel({ fuelAmount: 10 })

  const listing = await vessel.read({
    castId:  task.listingCastId,
    message: task.deliveryInstructions,
  })

  return {
    confirmed:      true,
    receipt:        listing.receipt,
    sellerResponse: listing.autoResponse,
    cost:           listing.receipt.amount,
  }
}
```

---

## Error Handling

```typescript
import { ConkError, ConkErrorCode } from '@axiomtide/conk-sdk'

try {
  await vessel.publish({ ... })
} catch (err) {
  if (err instanceof ConkError) {
    switch (err.code) {
      case ConkErrorCode.INSUFFICIENT_FUEL:
        // top up the vessel
        break
      case ConkErrorCode.TRANSACTION_FAILED:
        console.error('Tx failed:', err.context)
        break
    }
  }
}
```

---

## Architecture

```
@axiomtide/conk-sdk
├── ConkClient      entry point, auth, SuiClient
├── Harbor          USDC deposit, balance, sweep, vessel factory
├── Vessel          anonymous identity, publish, read
├── Cast            on-chain content object, read events
├── Receipt         tx verification, event subscription
└── Attachments     Walrus file storage
```

---

## Protocol

CONK runs on [Sui](https://sui.io) mainnet. Payments are USDC (native Sui USDC).  
Built by [Axiom Tide LLC](https://axiomtide.com) · [conk.app](https://conk.app)

---

## License

MIT © 2026 Axiom Tide LLC
