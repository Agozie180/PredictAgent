// PredictAgent contract ABI — generated from contracts/PredictAgent.sol
// Update address after deployment
export const PREDICT_AGENT_ADDRESS = import.meta.env.VITE_CONTRACT_ADDRESS as `0x${string}` | undefined

export const PREDICT_AGENT_ABI = [
  // --- constructor ---
  {
    type: 'constructor',
    inputs: [
      { name: '_seller', type: 'address' },
      { name: '_signalFeeUsdc', type: 'uint256' },
      { name: '_initialOwner', type: 'address' },
    ],
    stateMutability: 'nonpayable',
  },
  // --- errors ---
  { type: 'error', name: 'PredictAgent__Paused', inputs: [] },
  { type: 'error', name: 'PredictAgent__NotSeller', inputs: [] },
  { type: 'error', name: 'PredictAgent__InvalidStatus', inputs: [{ name: 'requestId', type: 'uint256' }, { name: 'expected', type: 'uint8' }, { name: 'actual', type: 'uint8' }] },
  { type: 'error', name: 'PredictAgent__WindowNotOpen', inputs: [] },
  { type: 'error', name: 'PredictAgent__WindowNotClosed', inputs: [] },
  { type: 'error', name: 'PredictAgent__RevealDeadlinePassed', inputs: [] },
  { type: 'error', name: 'PredictAgent__RevealDeadlineNotReached', inputs: [] },
  { type: 'error', name: 'PredictAgent__HashMismatch', inputs: [] },
  { type: 'error', name: 'PredictAgent__NotBuyer', inputs: [] },
  { type: 'error', name: 'PredictAgent__InvalidAddress', inputs: [] },
  { type: 'error', name: 'PredictAgent__InvalidFee', inputs: [] },
  { type: 'error', name: 'PredictAgent__OutcomeNotRecorded', inputs: [] },
  { type: 'error', name: 'PredictAgent__NotAuthorized', inputs: [] },
  { type: 'error', name: 'PredictAgent__TransferFailed', inputs: [] },
  { type: 'error', name: 'PredictAgent__RequestNotFound', inputs: [{ name: 'requestId', type: 'uint256' }] },
  { type: 'error', name: 'PredictAgent__RenounceDisabled', inputs: [] },
  // --- events ---
  {
    type: 'event', name: 'RequestCreated',
    inputs: [
      { name: 'requestId', type: 'uint256', indexed: true },
      { name: 'buyer', type: 'address', indexed: true },
      { name: 'tokenSymbol', type: 'string', indexed: false },
      { name: 'windowOpen', type: 'uint256', indexed: false },
      { name: 'windowClose', type: 'uint256', indexed: false },
      { name: 'fee', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event', name: 'SignalCommitted',
    inputs: [
      { name: 'requestId', type: 'uint256', indexed: true },
      { name: 'commitHash', type: 'bytes32', indexed: false },
    ],
  },
  {
    type: 'event', name: 'SignalRevealed',
    inputs: [
      { name: 'requestId', type: 'uint256', indexed: true },
      { name: 'direction', type: 'bytes32', indexed: false },
      { name: 'targetPrice', type: 'uint256', indexed: false },
      { name: 'confidenceBandBps', type: 'uint256', indexed: false },
      { name: 'signalTimestamp', type: 'uint256', indexed: false },
      { name: 'nonce', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event', name: 'OutcomeRecorded',
    inputs: [
      { name: 'requestId', type: 'uint256', indexed: true },
      { name: 'verifier', type: 'address', indexed: true },
      { name: 'correct', type: 'bool', indexed: false },
    ],
  },
  {
    type: 'event', name: 'RequestSettled',
    inputs: [
      { name: 'requestId', type: 'uint256', indexed: true },
      { name: 'seller', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event', name: 'RequestRefunded',
    inputs: [
      { name: 'requestId', type: 'uint256', indexed: true },
      { name: 'buyer', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event', name: 'FeeUpdated',
    inputs: [{ name: 'oldFee', type: 'uint256' }, { name: 'newFee', type: 'uint256' }],
  },
  {
    type: 'event', name: 'SellerUpdated',
    inputs: [{ name: 'oldSeller', type: 'address' }, { name: 'newSeller', type: 'address' }],
  },
  {
    type: 'event', name: 'Paused',
    inputs: [{ name: 'by', type: 'address' }],
  },
  {
    type: 'event', name: 'Unpaused',
    inputs: [{ name: 'by', type: 'address' }],
  },
  {
    type: 'event', name: 'VerifierUpdated',
    inputs: [
      { name: 'requestId', type: 'uint256', indexed: true },
      { name: 'oldVerifier', type: 'address', indexed: true },
      { name: 'newVerifier', type: 'address', indexed: true },
    ],
  },
  // --- state-changing functions ---
  {
    type: 'function', name: 'requestSignal', stateMutability: 'nonpayable',
    inputs: [
      { name: 'tokenSymbol', type: 'string' },
      { name: 'windowOpen', type: 'uint256' },
      { name: 'windowClose', type: 'uint256' },
    ],
    outputs: [{ name: 'requestId', type: 'uint256' }],
  },
  {
    type: 'function', name: 'commitSignal', stateMutability: 'nonpayable',
    inputs: [{ name: 'requestId', type: 'uint256' }, { name: 'commitHash', type: 'bytes32' }],
    outputs: [],
  },
  {
    type: 'function', name: 'revealSignal', stateMutability: 'nonpayable',
    inputs: [
      { name: 'requestId', type: 'uint256' },
      { name: 'direction', type: 'bytes32' },
      { name: 'targetPrice', type: 'uint256' },
      { name: 'confidenceBandBps', type: 'uint256' },
      { name: 'signalTimestamp', type: 'uint256' },
      { name: 'nonce', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    type: 'function', name: 'recordOutcome', stateMutability: 'nonpayable',
    inputs: [{ name: 'requestId', type: 'uint256' }, { name: 'correct', type: 'bool' }],
    outputs: [],
  },
  {
    type: 'function', name: 'claimRefund', stateMutability: 'nonpayable',
    inputs: [{ name: 'requestId', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function', name: 'setFee', stateMutability: 'nonpayable',
    inputs: [{ name: 'newFee', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function', name: 'setSeller', stateMutability: 'nonpayable',
    inputs: [{ name: 'newSeller', type: 'address' }],
    outputs: [],
  },
  {
    type: 'function', name: 'setVerifier', stateMutability: 'nonpayable',
    inputs: [{ name: 'requestId', type: 'uint256' }, { name: 'verifier', type: 'address' }],
    outputs: [],
  },
  {
    type: 'function', name: 'setRevealDeadlineOffset', stateMutability: 'nonpayable',
    inputs: [{ name: 'offset', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function', name: 'setOutcomeDeadlineOffset', stateMutability: 'nonpayable',
    inputs: [{ name: 'offset', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function', name: 'pause', stateMutability: 'nonpayable',
    inputs: [], outputs: [],
  },
  {
    type: 'function', name: 'unpause', stateMutability: 'nonpayable',
    inputs: [], outputs: [],
  },
  // --- view functions ---
  {
    type: 'function', name: 'getRequest', stateMutability: 'view',
    inputs: [{ name: 'requestId', type: 'uint256' }],
    outputs: [{
      name: '', type: 'tuple',
      components: [
        { name: 'requestId', type: 'uint256' },
        { name: 'buyer', type: 'address' },
        { name: 'tokenSymbol', type: 'string' },
        { name: 'windowOpen', type: 'uint256' },
        { name: 'windowClose', type: 'uint256' },
        { name: 'commitHash', type: 'bytes32' },
        { name: 'revealedDirection', type: 'bytes32' },
        { name: 'revealedTargetPrice', type: 'uint256' },
        { name: 'revealedConfidenceBandBps', type: 'uint256' },
        { name: 'revealedTimestamp', type: 'uint256' },
        { name: 'revealedNonce', type: 'uint256' },
        { name: 'status', type: 'uint8' },
        { name: 'verifier', type: 'address' },
        { name: 'feePaid', type: 'uint256' },
        { name: 'outcomeRecorded', type: 'bool' },
        { name: 'outcomeCorrect', type: 'bool' },
      ],
    }],
  },
  {
    type: 'function', name: 'getReputation', stateMutability: 'view',
    inputs: [{ name: 'addr', type: 'address' }],
    outputs: [{ name: 'settled', type: 'uint256' }, { name: 'refunded', type: 'uint256' }],
  },
  {
    type: 'function', name: 'USDC', stateMutability: 'view',
    inputs: [], outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function', name: 'seller', stateMutability: 'view',
    inputs: [], outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function', name: 'signalFeeUsdc', stateMutability: 'view',
    inputs: [], outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function', name: 'revealDeadlineOffset', stateMutability: 'view',
    inputs: [], outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function', name: 'outcomeDeadlineOffset', stateMutability: 'view',
    inputs: [], outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function', name: 'paused', stateMutability: 'view',
    inputs: [], outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function', name: 'nextRequestId', stateMutability: 'view',
    inputs: [], outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function', name: 'settledCount', stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function', name: 'refundedCount', stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function', name: 'owner', stateMutability: 'view',
    inputs: [], outputs: [{ name: '', type: 'address' }],
  },
] as const
