// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title SellerRegistry
 * @notice Multi-seller registry for PredictAgent.
 *
 * DESIGN
 * ──────
 * The original PredictAgent has a single registered seller set by the owner.
 * This registry allows any address to register as a seller and deploy their
 * own per-seller escrow pool. Buyers choose which seller to buy from.
 *
 * Each registered seller has:
 *   - A USDC fee per signal request
 *   - A reputation score (settledCount / refundedCount)
 *   - An active/inactive flag (sellers can deactivate themselves)
 *   - A metadata URI (IPFS JSON with name, description, logo)
 *
 * Buyers call requestSignalFrom(seller, token, windowOpen, windowClose) on
 * this registry, which holds the escrow and delegates commit/reveal to the
 * seller's registered wallet.
 *
 * LIMITATIONS (stated plainly)
 * ─────────────────────────────
 * 1. No slashing / stake: sellers cannot be penalised for poor performance
 *    beyond the reputational cost in on-chain stats. A staking extension is
 *    a natural next step (seller deposits USDC stake; slashed on refunds).
 * 2. Outcome verification is still owner/verifier permissioned here — combine
 *    with PredictAgentChainlink for trustless verification.
 * 3. Per-seller fee is fixed at registration time; sellers can update it but
 *    in-flight requests use the fee snapshotted at request time.
 *
 * pragma solidity ^0.8.20 — EVM target: Paris (no PUSH0)
 */

import {Ownable}        from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20}         from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract SellerRegistry is Ownable, ReentrancyGuard {

    address public constant USDC = 0x3600000000000000000000000000000000000000;

    // ── Structs ───────────────────────────────────────────────────────────────

    struct SellerProfile {
        address  sellerAddr;
        uint256  feeUsdc;        // fee per signal request (6-decimal USDC)
        bool     active;
        uint256  settledCount;
        uint256  refundedCount;
        string   metadataUri;    // IPFS URI: { name, description, logoUrl }
        uint256  registeredAt;
    }

    enum RequestStatus { PENDING, COMMITTED, REVEALED, SETTLED, REFUNDED }

    struct SignalRequest {
        uint256       requestId;
        address       seller;
        address       buyer;
        string        tokenSymbol;
        uint256       windowOpen;
        uint256       windowClose;
        bytes32       commitHash;
        bytes32       revealedDirection;
        uint256       revealedTargetPrice;
        uint256       revealedConfidenceBandBps;
        uint256       revealedTimestamp;
        uint256       revealedNonce;
        RequestStatus status;
        address       verifier;
        uint256       feePaid;
        bool          outcomeRecorded;
        bool          outcomeCorrect;
    }

    // ── Errors ────────────────────────────────────────────────────────────────

    error SR__AlreadyRegistered(address seller);
    error SR__NotRegistered(address seller);
    error SR__SellerInactive(address seller);
    error SR__InvalidFee();
    error SR__InvalidAddress();
    error SR__WindowNotOpen();
    error SR__NotSeller(uint256 requestId);
    error SR__InvalidStatus(uint256 requestId);
    error SR__HashMismatch();
    error SR__WindowNotClosed();
    error SR__RevealDeadlinePassed();
    error SR__RevealDeadlineNotReached();
    error SR__NotBuyer();
    error SR__NotAuthorized();
    error SR__TransferFailed();
    error SR__RequestNotFound(uint256 requestId);
    error SR__Paused();

    // ── Events ────────────────────────────────────────────────────────────────

    event SellerRegistered(address indexed seller, uint256 feeUsdc, string metadataUri);
    event SellerDeactivated(address indexed seller);
    event SellerReactivated(address indexed seller);
    event SellerFeeUpdated(address indexed seller, uint256 oldFee, uint256 newFee);
    event SellerMetadataUpdated(address indexed seller, string newUri);
    event RequestCreated(uint256 indexed requestId, address indexed seller, address indexed buyer, string tokenSymbol, uint256 windowOpen, uint256 windowClose, uint256 fee);
    event SignalCommitted(uint256 indexed requestId, bytes32 commitHash);
    event SignalRevealed(uint256 indexed requestId, bytes32 direction, uint256 targetPrice, uint256 confidenceBandBps, uint256 ts, uint256 nonce);
    event OutcomeRecorded(uint256 indexed requestId, address indexed verifier, bool correct);
    event RequestSettled(uint256 indexed requestId, address indexed seller, uint256 amount);
    event RequestRefunded(uint256 indexed requestId, address indexed buyer, uint256 amount);
    event VerifierSet(uint256 indexed requestId, address indexed verifier);
    event Paused(address by);
    event Unpaused(address by);

    // ── Constructor ───────────────────────────────────────────────────────────

    constructor(address _initialOwner) Ownable(_initialOwner) {
        if (_initialOwner == address(0)) revert SR__InvalidAddress();
        nextRequestId = 1;
    }

    // ── State ─────────────────────────────────────────────────────────────────

    mapping(address => SellerProfile) public sellers;
    address[] public sellerList;

    mapping(uint256 => SignalRequest) public requests;
    uint256 public nextRequestId;

    uint256 public revealDeadlineOffset  = 3600;   // 1h
    uint256 public outcomeDeadlineOffset = 86400;  // 24h
    bool    public paused;

    // ── Registration ──────────────────────────────────────────────────────────

    /**
     * @notice Register as a seller. Anyone can call this.
     * @param feeUsdc     Fee per signal request in 6-decimal USDC
     * @param metadataUri IPFS URI pointing to seller JSON metadata
     */
    function register(uint256 feeUsdc, string calldata metadataUri) external {
        if (sellers[msg.sender].sellerAddr != address(0)) revert SR__AlreadyRegistered(msg.sender);
        if (feeUsdc == 0) revert SR__InvalidFee();

        sellers[msg.sender] = SellerProfile({
            sellerAddr:    msg.sender,
            feeUsdc:       feeUsdc,
            active:        true,
            settledCount:  0,
            refundedCount: 0,
            metadataUri:   metadataUri,
            registeredAt:  block.timestamp
        });
        sellerList.push(msg.sender);

        emit SellerRegistered(msg.sender, feeUsdc, metadataUri);
    }

    function deactivate() external {
        _requireRegistered(msg.sender);
        sellers[msg.sender].active = false;
        emit SellerDeactivated(msg.sender);
    }

    function reactivate() external {
        _requireRegistered(msg.sender);
        sellers[msg.sender].active = true;
        emit SellerReactivated(msg.sender);
    }

    function updateFee(uint256 newFee) external {
        _requireRegistered(msg.sender);
        if (newFee == 0) revert SR__InvalidFee();
        uint256 old = sellers[msg.sender].feeUsdc;
        sellers[msg.sender].feeUsdc = newFee;
        emit SellerFeeUpdated(msg.sender, old, newFee);
    }

    function updateMetadata(string calldata uri) external {
        _requireRegistered(msg.sender);
        sellers[msg.sender].metadataUri = uri;
        emit SellerMetadataUpdated(msg.sender, uri);
    }

    // ── Signal flow ───────────────────────────────────────────────────────────

    /**
     * @notice Buyer requests a signal from a specific seller.
     *         Fee is deducted at the seller's current rate (snapshotted onto the request).
     */
    function requestSignalFrom(
        address sellerAddr,
        string calldata tokenSymbol,
        uint256 windowOpen,
        uint256 windowClose
    ) external nonReentrant returns (uint256 requestId) {
        if (paused) revert SR__Paused();
        _requireRegistered(sellerAddr);
        if (!sellers[sellerAddr].active) revert SR__SellerInactive(sellerAddr);
        if (windowOpen <= block.timestamp || windowClose <= windowOpen) revert SR__WindowNotOpen();

        uint256 fee = sellers[sellerAddr].feeUsdc;
        bool ok = IERC20(USDC).transferFrom(msg.sender, address(this), fee);
        if (!ok) revert SR__TransferFailed();

        requestId = nextRequestId++;
        SignalRequest storage req = requests[requestId];
        req.requestId   = requestId;
        req.seller      = sellerAddr;
        req.buyer       = msg.sender;
        req.tokenSymbol = tokenSymbol;
        req.windowOpen  = windowOpen;
        req.windowClose = windowClose;
        req.feePaid     = fee;
        req.status      = RequestStatus.PENDING;

        emit RequestCreated(requestId, sellerAddr, msg.sender, tokenSymbol, windowOpen, windowClose, fee);
    }

    function commitSignal(uint256 requestId, bytes32 commitHash) external {
        SignalRequest storage req = _getRequest(requestId);
        if (msg.sender != req.seller) revert SR__NotSeller(requestId);
        _requireStatus(req, RequestStatus.PENDING);
        if (block.timestamp >= req.windowOpen) revert SR__WindowNotOpen();

        req.commitHash = commitHash;
        req.status = RequestStatus.COMMITTED;
        emit SignalCommitted(requestId, commitHash);
    }

    function revealSignal(
        uint256 requestId,
        bytes32 direction,
        uint256 targetPrice,
        uint256 confidenceBandBps,
        uint256 signalTimestamp,
        uint256 nonce
    ) external {
        SignalRequest storage req = _getRequest(requestId);
        if (msg.sender != req.seller) revert SR__NotSeller(requestId);
        _requireStatus(req, RequestStatus.COMMITTED);
        if (block.timestamp < req.windowClose)                              revert SR__WindowNotClosed();
        if (block.timestamp > req.windowClose + revealDeadlineOffset)      revert SR__RevealDeadlinePassed();

        bytes32 expected = keccak256(
            abi.encodePacked(requestId, direction, targetPrice, confidenceBandBps, signalTimestamp, nonce)
        );
        if (expected != req.commitHash) revert SR__HashMismatch();

        req.revealedDirection         = direction;
        req.revealedTargetPrice       = targetPrice;
        req.revealedConfidenceBandBps = confidenceBandBps;
        req.revealedTimestamp         = signalTimestamp;
        req.revealedNonce             = nonce;
        req.status                    = RequestStatus.REVEALED;

        emit SignalRevealed(requestId, direction, targetPrice, confidenceBandBps, signalTimestamp, nonce);
    }

    function recordOutcome(uint256 requestId, bool correct) external nonReentrant {
        SignalRequest storage req = _getRequest(requestId);
        if (msg.sender != req.verifier && msg.sender != owner()) revert SR__NotAuthorized();
        _requireStatus(req, RequestStatus.REVEALED);

        req.outcomeRecorded = true;
        req.outcomeCorrect  = correct;
        emit OutcomeRecorded(requestId, msg.sender, correct);

        if (correct) { _settle(requestId); } else { _refund(requestId); }
    }

    function claimRefund(uint256 requestId) external nonReentrant {
        SignalRequest storage req = _getRequest(requestId);
        if (msg.sender != req.buyer) revert SR__NotBuyer();
        if (
            req.status != RequestStatus.PENDING &&
            req.status != RequestStatus.COMMITTED &&
            req.status != RequestStatus.REVEALED
        ) revert SR__InvalidStatus(requestId);

        if (req.status == RequestStatus.REVEALED) {
            if (block.timestamp <= req.windowClose + revealDeadlineOffset + outcomeDeadlineOffset) {
                revert SR__RevealDeadlineNotReached();
            }
        } else if (block.timestamp <= req.windowClose + revealDeadlineOffset) {
            revert SR__RevealDeadlineNotReached();
        }

        _refund(requestId);
    }

    // ── Owner / verifier management ───────────────────────────────────────────

    function setVerifier(uint256 requestId, address verifier) external onlyOwner {
        if (verifier == address(0)) revert SR__InvalidAddress();
        requests[requestId].verifier = verifier;
        emit VerifierSet(requestId, verifier);
    }

    function setRevealDeadlineOffset(uint256 offset) external onlyOwner {
        revealDeadlineOffset = offset;
    }

    function setOutcomeDeadlineOffset(uint256 offset) external onlyOwner {
        outcomeDeadlineOffset = offset;
    }

    function pause()   external onlyOwner { paused = true;  emit Paused(msg.sender);   }
    function unpause() external onlyOwner { paused = false; emit Unpaused(msg.sender); }

    // ── View helpers ──────────────────────────────────────────────────────────

    function getSellerCount() external view returns (uint256) {
        return sellerList.length;
    }

    function getActiveSellers() external view returns (address[] memory active) {
        uint256 count;
        for (uint256 i; i < sellerList.length; i++) {
            if (sellers[sellerList[i]].active) count++;
        }
        active = new address[](count);
        uint256 j;
        for (uint256 i; i < sellerList.length; i++) {
            if (sellers[sellerList[i]].active) active[j++] = sellerList[i];
        }
    }

    function getRequest(uint256 requestId) external view returns (SignalRequest memory) {
        return requests[requestId];
    }

    // ── Internal ──────────────────────────────────────────────────────────────

    function _settle(uint256 requestId) internal {
        SignalRequest storage req = requests[requestId];
        req.status = RequestStatus.SETTLED;
        sellers[req.seller].settledCount++;
        bool ok = IERC20(USDC).transfer(req.seller, req.feePaid);
        if (!ok) revert SR__TransferFailed();
        emit RequestSettled(requestId, req.seller, req.feePaid);
    }

    function _refund(uint256 requestId) internal {
        SignalRequest storage req = requests[requestId];
        req.status = RequestStatus.REFUNDED;
        sellers[req.seller].refundedCount++;
        bool ok = IERC20(USDC).transfer(req.buyer, req.feePaid);
        if (!ok) revert SR__TransferFailed();
        emit RequestRefunded(requestId, req.buyer, req.feePaid);
    }

    function _requireRegistered(address addr) internal view {
        if (sellers[addr].sellerAddr == address(0)) revert SR__NotRegistered(addr);
    }

    function _requireStatus(SignalRequest storage req, RequestStatus expected) internal view {
        if (req.status != expected) revert SR__InvalidStatus(req.requestId);
    }

    function _getRequest(uint256 requestId) internal view returns (SignalRequest storage req) {
        req = requests[requestId];
        if (req.requestId != requestId || requestId == 0) revert SR__RequestNotFound(requestId);
    }
}
