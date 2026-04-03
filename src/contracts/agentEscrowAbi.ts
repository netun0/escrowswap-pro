/** Minimal AgentEscrow interface for ethers v6 (matches contracts/AgentEscrow.sol). */
export const AGENT_ESCROW_ABI = [
  "error CrossTokenNeedsUniswapX()",
  "function createTask(string specURI, address worker, address verifier, address paymentToken, uint256 amount, address workerPreferredToken) external returns (uint256 taskId)",
  "function fundTask(uint256 taskId) external",
  "function submitWork(uint256 taskId, string outputURI) external",
  "function verify(uint256 taskId, bool approved) external",
  "function verifyWithUniswapXOrder(uint256 taskId, bool approved, bytes uniswapXOrder, bytes uniswapXSig) external",
  "function dispute(uint256 taskId) external",
  "function getTask(uint256 taskId) external view returns (tuple(uint256 id, address client, address worker, address verifier, string specURI, string outputURI, address paymentToken, uint256 amount, address workerPreferredToken, uint8 state, uint256 createdAt, uint256 fundedAt, uint256 submittedAt, uint256 verifiedAt, uint256 completedAt))",
  "function getTaskCount() external view returns (uint256)",
  "function uniswapPayout() external view returns (address)",
  "event TaskCreated(uint256 indexed taskId, address indexed client, address worker, address verifier, uint256 amount)",
  "event TaskFunded(uint256 indexed taskId, address indexed client, uint256 amount)",
  "event WorkSubmitted(uint256 indexed taskId, address indexed worker, string outputURI)",
  "event WorkVerified(uint256 indexed taskId, address indexed verifier, bool approved)",
  "event PayoutCompleted(uint256 indexed taskId, address indexed worker, address tokenOut, uint256 amountOut)",
  "event TaskRefunded(uint256 indexed taskId, address indexed client, uint256 amount)",
  "event TaskDisputed(uint256 indexed taskId, address indexed disputant)",
] as const;

export const ERC20_MIN_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
] as const;
