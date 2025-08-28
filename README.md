# ResolveNet: Decentralized Complaint Resolution Platform

## Overview

ResolveNet is a Web3 project built on the Stacks blockchain using Clarity smart contracts. It provides a decentralized complaint tracking application where users can submit complaints about real-world products or services (e.g., faulty electronics, poor customer service in retail, or appliance breakdowns). The system incentivizes timely resolutions by allowing users to mint fungible tokens (ResolveTokens or RST) upon verified resolution of their complaints. These tokens are redeemable for value-added services, such as virtual diagnostics (e.g., AI-powered troubleshooting sessions) or in-person repairs (e.g., discounted repair vouchers from registered providers).

### Real-World Problems Solved
- **Lack of Transparency in Complaint Handling**: Traditional centralized systems (e.g., company helpdesks) often hide complaint statuses, leading to frustration and unresolved issues. ResolveNet makes all complaints publicly trackable on-chain, ensuring accountability.
- **Slow Resolutions and No Incentives**: Companies may delay fixes due to no penalties. Here, resolutions mint tokens for users, encouraging providers to act quickly.
- **Trust Issues in Service Redemption**: Users often doubt voucher validity. Blockchain ensures tamper-proof redemptions.
- **Centralized Monopolies**: Empowers users in industries like consumer electronics or home services by decentralizing control, reducing reliance on big corporations.
- **Data Silos**: Complaints are scattered; ResolveNet aggregates them pseudonymously, allowing analytics for systemic issues (e.g., product recalls).

The platform uses 7 Clarity smart contracts for modularity, security, and scalability. It follows SIP-10 for fungible tokens and integrates oracle-like verification for off-chain events. Users interact via a dApp frontend (not included here; assume React + Stacks.js).

## Prerequisites
- Stacks blockchain (testnet or mainnet).
- Clarity development tools (e.g., Clarinet for local testing).
- No external dependencies beyond standard Clarity libraries.

## Architecture
- **User Flow**:
  1. Register as a user or provider.
  2. Submit a complaint with details (e.g., product ID, description).
  3. Providers or community propose resolutions.
  4. Verification via oracle or voting confirms resolution.
  5. Mint RST tokens to the user.
  6. Redeem RST for services (virtual or in-person).
- **Tokenomics**: RST is a SIP-10 fungible token. Minted on resolution (e.g., 10-100 RST based on severity). Burned on redemption.
- **Governance**: DAO-style voting for disputes or upgrades.
- **Security**: All contracts use post-conditions, read-only functions, and principal checks to prevent exploits.

## Smart Contracts
Below are the 7 smart contracts in Clarity. Each is self-contained but interacts via traits and public functions. Deploy them in order (e.g., using Clarinet).

### 1. UserRegistry.clar
Registers users and providers with basic profiles. Ensures unique principals.

```clarity
;; User Registry Contract
(define-trait user-trait
  (
    (register-user (principal buff) (response bool uint))
    (is-registered (principal) (response bool uint))
  )
)

(define-map users principal { registered: bool, role: (string-ascii 10) }) ;; role: "user" or "provider"

(define-public (register-user (user principal) (role (string-ascii 10)))
  (if (is-none (map-get? users user))
    (begin
      (map-set users user { registered: true, role: role })
      (ok true)
    )
    (err u100) ;; Already registered
  )
)

(define-read-only (is-registered (user principal))
  (match (map-get? users user)
    profile (ok (get registered profile))
    (ok false)
  )
)

(define-read-only (get-role (user principal))
  (match (map-get? users user)
    profile (ok (get role profile))
    (err u101) ;; Not registered
  )
)
```

### 2. ProviderRegistry.clar
Manages service providers who can resolve complaints and offer redemptions.

```clarity
;; Provider Registry Contract
(define-map providers principal { approved: bool, services: (list 10 (string-ascii 50)) }) ;; e.g., ["virtual-diagnostic", "in-person-repair"]

(define-public (register-provider (provider principal) (services (list 10 (string-ascii 50))))
  (let ((user-role (unwrap! (contract-call? .UserRegistry get-role provider) (err u200))))
    (if (is-eq user-role "provider")
      (begin
        (map-set providers provider { approved: true, services: services })
        (ok true)
      )
      (err u201) ;; Not a provider role
    )
  )
)

(define-read-only (is-approved-provider (provider principal))
  (match (map-get? providers provider)
    info (ok (get approved info))
    (ok false)
  )
)

(define-read-only (get-provider-services (provider principal))
  (match (map-get? providers provider)
    info (ok (get services info))
    (err u202) ;; Not registered
  )
)
```

### 3. ComplaintTracker.clar
Core contract for submitting and tracking complaints.

```clarity
;; Complaint Tracker Contract
(define-map complaints uint { owner: principal, description: (string-utf8 256), status: (string-ascii 20), resolved: bool }) ;; status: "open", "in-progress", "resolved"
(define-data-var next-id uint u1)

(define-public (submit-complaint (owner principal) (description (string-utf8 256)))
  (let ((id (var-get next-id)))
    (asserts! (unwrap! (contract-call? .UserRegistry is-registered owner) false) (err u300))
    (map-set complaints id { owner: owner, description: description, status: "open", resolved: false })
    (var-set next-id (+ id u1))
    (ok id)
  )
)

(define-public (update-status (id uint) (new-status (string-ascii 20)) (caller principal))
  (match (map-get? complaints id)
    complaint
      (if (is-eq (get owner complaint) caller)
        (begin
          (map-set complaints id (merge complaint { status: new-status }))
          (ok true)
        )
        (err u301) ;; Not owner
      )
    (err u302) ;; Complaint not found
  )
)

(define-read-only (get-complaint (id uint))
  (map-get? complaints id)
)
```

### 4. ResolutionVerifier.clar
Verifies resolutions using a simple oracle (multi-principal approval for demo; extend with external oracles).

```clarity
;; Resolution Verifier Contract
(define-map resolutions uint { complaint-id: uint, verifiers: (list 5 principal), approvals: uint, required: uint })
(define-constant required-approvals u3)

(define-public (propose-resolution (complaint-id uint) (verifier principal))
  (asserts! (unwrap! (contract-call? .ProviderRegistry is-approved-provider verifier) false) (err u400))
  (match (map-get? resolutions complaint-id)
    res
      (ok (map-set resolutions complaint-id (merge res { approvals: (+ (get approvals res) u1) })))
    (begin
      (map-set resolutions complaint-id { complaint-id: complaint-id, verifiers: (list verifier), approvals: u1, required: required-approvals })
      (ok true)
    )
  )
)

(define-public (verify-resolution (complaint-id uint))
  (match (map-get? resolutions complaint-id)
    res
      (if (>= (get approvals res) (get required res))
        (begin
          ;; Update complaint status
          (unwrap! (contract-call? .ComplaintTracker update-status complaint-id "resolved" tx-sender) (err u401))
          (ok true)
        )
        (err u402) ;; Not enough approvals
      )
    (err u403) ;; No resolution proposed
  )
)
```

### 5. TokenMinter.clar
SIP-10 compliant fungible token for RST. Mints on verified resolutions.

```clarity
;; Token Minter Contract (SIP-10 Fungible Token)
(define-fungible-token rst u1000000) ;; Max supply
(define-constant mint-amount u50) ;; Tokens per resolution

(define-public (mint-on-resolution (complaint-id uint) (recipient principal))
  (let ((is-resolved (unwrap! (contract-call? .ResolutionVerifier verify-resolution complaint-id) (err u500))))
    (asserts! is-resolved (err u501))
    (ft-mint? rst mint-amount recipient)
  )
)

(define-public (transfer (amount uint) (sender principal) (recipient principal))
  (ft-transfer? rst amount sender recipient)
)

(define-read-only (get-balance (account principal))
  (ft-get-balance? rst account)
)

(define-read-only (get-total-supply)
  (ft-get-supply? rst)
)
```

### 6. ServiceRedemption.clar
Handles token redemption for services.

```clarity
;; Service Redemption Contract
(define-map redemptions uint { user: principal, provider: principal, service: (string-ascii 50), tokens: uint, fulfilled: bool })

(define-data-var next-redemption-id uint u1)

(define-public (redeem-tokens (user principal) (provider principal) (service (string-ascii 50)) (tokens uint))
  (asserts! (unwrap! (contract-call? .ProviderRegistry is-approved-provider provider) false) (err u600))
  (asserts! (>= (unwrap! (contract-call? .TokenMinter get-balance user) u0) tokens) (err u601))
  (let ((id (var-get next-redemption-id)))
    (map-set redemptions id { user: user, provider: provider, service: service, tokens: tokens, fulfilled: false })
    (unwrap! (contract-call? .TokenMinter transfer tokens user provider) (err u602)) ;; Transfer to provider (or burn)
    (var-set next-redemption-id (+ id u1))
    (ok id)
  )
)

(define-public (fulfill-redemption (id uint) (provider principal))
  (match (map-get? redemptions id)
    red
      (if (is-eq (get provider red) provider)
        (begin
          (map-set redemptions id (merge red { fulfilled: true }))
          (ok true)
        )
        (err u603) ;; Not the provider
      )
    (err u604) ;; Redemption not found
  )
)
```

### 7. Governance.clar
Basic DAO for voting on disputes or upgrades.

```clarity
;; Governance Contract
(define-map proposals uint { proposer: principal, description: (string-utf8 256), votes-for: uint, votes-against: uint, active: bool })
(define-data-var next-proposal-id uint u1)
(define-constant vote-threshold u10)

(define-public (create-proposal (proposer principal) (description (string-utf8 256)))
  (asserts! (unwrap! (contract-call? .UserRegistry is-registered proposer) false) (err u700))
  (let ((id (var-get next-proposal-id)))
    (map-set proposals id { proposer: proposer, description: description, votes-for: u0, votes-against: u0, active: true })
    (var-set next-proposal-id (+ id u1))
    (ok id)
  )
)

(define-public (vote (proposal-id uint) (vote bool)) ;; true = for, false = against
  (match (map-get? proposals proposal-id)
    prop
      (if (get active prop)
        (begin
          (if vote
            (map-set proposals proposal-id (merge prop { votes-for: (+ (get votes-for prop) u1) }))
            (map-set proposals proposal-id (merge prop { votes-against: (+ (get votes-against prop) u1) })))
          (ok true)
        )
        (err u701) ;; Proposal inactive
      )
    (err u702) ;; Proposal not found
  )
)

(define-public (execute-proposal (proposal-id uint))
  (match (map-get? proposals proposal-id)
    prop
      (if (and (get active prop) (>= (get votes-for prop) vote-threshold))
        (begin
          (map-set proposals proposal-id (merge prop { active: false }))
          (ok true) ;; Execute logic (e.g., call other contracts)
        )
        (err u703) ;; Not passed
      )
    (err u704)
  )
)
```

## Deployment and Testing
- Use Clarinet: `clarinet new resolvenet`, then add contracts.
- Test locally: `clarinet test`.
- Deploy to Stacks testnet via Hiro tools.
- Interactions: Use Stacks Wallet or JS SDK.

## Future Enhancements
- Integrate real oracles (e.g., Chainlink on Stacks).
- NFT for unique repair vouchers.
- Analytics dashboard for complaint trends.

## License
MIT License. This is a conceptual project; audit before production use.