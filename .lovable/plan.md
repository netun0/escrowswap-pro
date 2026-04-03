
## ERC-8183 Agent-to-Agent Escrow with Uniswap Payout Routing

### Overview
Build Solidity smart contracts implementing ERC-8183 escrow with Uniswap swap-on-release, plus a React dashboard for managing and monitoring the agent escrow lifecycle. Target: Sepolia testnet. Hybrid interaction model (manual client, automated verifier). Includes x402 micropayment support.

---

### Phase 1: Smart Contract Code Generation

**ERC-8183 Escrow Contract** (`contracts/AgentEscrow.sol`)
- Roles: Client, Worker, Verifier (address-based)
- States: `Open → Funded → Submitted → Verified → PaidOut` (+ `Refunded`, `Disputed`)
- `createTask(spec, worker, verifier, paymentToken, amount, workerPreferredToken)` — client creates & funds
- `submitWork(taskId, outputURI)` — worker submits deliverable (IPFS hash or URI)
- `verify(taskId, approved)` — verifier approves/rejects
- On approval: calls Uniswap V3 SwapRouter to convert escrowed token → worker's preferred token, then transfers
- On rejection: refunds client
- Events for all state transitions

**Uniswap Integration** (`contracts/UniswapPayout.sol`)
- Wrapper around Uniswap V3 SwapRouter (Sepolia deployment)
- `swapAndPay(tokenIn, tokenOut, amountIn, recipient, maxSlippage)` — exact-input swap + transfer
- Fallback: if tokenIn == tokenOut, direct transfer (no swap)

**x402 Micropayment Module** (`contracts/X402Relay.sol`)
- Lightweight payment channel for agent-to-agent sub-service calls
- `payForCall(provider, amount, callHash)` — micropayment with receipt
- Integrates with escrow balance or separate funding

**Interfaces & Types** (`contracts/interfaces/`)
- `IERC8183Escrow.sol` — standard interface
- `IX402Relay.sol` — micropayment interface
- Shared enums and structs

---

### Phase 2: React Dashboard

**Pages:**

1. **Dashboard** (`/`) — Overview of active tasks, stats (total escrowed, completed, in-progress), recent activity feed

2. **Create Task** (`/create`) — Form to define task spec, assign worker/verifier addresses, select payment token, set amount, specify worker's preferred payout token. Connect wallet & fund escrow

3. **Task Detail** (`/task/:id`) — Full lifecycle view showing current state, participants, work submission, verification status, payout transaction. Actions based on role (submit work, verify, dispute)

4. **My Tasks** (`/tasks`) — Filtered views: "As Client", "As Worker", "As Verifier" with status badges

5. **Agent Monitor** (`/agents`) — Live view of agent activity, automated verifier logs, x402 micropayment history

**Components:**
- Wallet connector (ethers.js + MetaMask)
- Task state machine visualization (Open → Funded → Submitted → Verified → PaidOut)
- Token selector with Uniswap pool availability check
- Swap preview showing estimated payout in worker's preferred token
- x402 payment log table
- Transaction status toasts

**Design:**
- Dark theme with blockchain-inspired aesthetic
- Color-coded state badges (blue=open, yellow=funded, orange=submitted, green=verified/paid, red=refunded)
- Responsive layout with sidebar navigation

---

### Phase 3: Integration Layer

- **Contract ABIs** generated and stored in `src/contracts/abis/`
- **Hook layer** (`useEscrow`, `useUniswapQuote`, `useX402`) wrapping ethers.js contract calls
- **Mock mode** for development without deployed contracts (simulated state transitions)
- **Sepolia config** with contract addresses, Uniswap router address, and test token addresses
