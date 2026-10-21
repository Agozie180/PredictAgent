// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title PredictAgentChainlink
 * @notice Upgrade path for PredictAgent that replaces the permissioned verifier
 *         with a trustless Chainlink Data Feed price check, and implements
 *         Chainlink Automation so outcomes are settled without any human action.
 *
 * DESIGN
 * ──────
 * The core commit-reveal flow is unchanged from PredictAgent. The only change
 * is in how outcomes are recorded:
 *
 *   OLD: owner or a permissioned verifier calls recordOutcome(requestId, bool)
 *   NEW: anyone calls settleWithChainlink(requestId), which:
 *        1. Reads the Chainlink price feed for the request's token.
 *        2. Checks whether the revealed target price was hit within the
 *           confidence band (revealedTargetPrice ± revealedConfidenceBandBps).
 *        3. Settles (pays seller) if hit, refunds (pays buyer) if not.
 *
 * Chainlink Automation compatibility: this contract implements
 * AutomationCompatibleInterface so a registered Upkeep can call
 * performUpkeep() automatically when a request is ready to settle.
 *
 * CHAINLINK PRICE FEEDS on Arc Mainnet (verified 2026-10-21, all 8 decimals)
 * ──────────────────────────────────────────────────────────────────────────
 * BTC/USD  0xa109B535C70C8Be9995be64Bb6751AcDB27e03De
 * ETH/USD  0x50FCDD99D6762D1C170DC6A9111db944AEE6D364
 * SOL/USD  0x2d04D354f5fDaE3De723df475745B0a9B4edf90C
 * LINK/USD 0xD37600AB06758356F0f5eE607299204785bF8c3a
 * AAVE/USD 0x06e59eA707FEAA09467C689Baf8D49C180fE2118
 *
 * Feed addresses are set per-token by the owner via setPriceFeed().
 * The owner MUST call setPriceFeed() before buyers can use a token.
 *
 * LIMITATIONS (stated plainly)
 * ─────────────────────────────
 * 1. Price feed latency: Chainlink heartbeat is ~1h for most feeds.
 *    The settlement price is the feed price at the time settleWithChainlink
 *    is called — not the real-time price at the exact windowClose. A caller
 *    can game this by waiting for a favorable feed update within the
 *    settlement window. Mitigation: use a settlement window shorter than
 *    the feed's heartbeat, or accept the heartbeat lag as a known limitation.
 * 2. Feed staleness: we reject prices older than `maxStaleness` seconds
 *    (default 3600). Stale feeds will cause settleWithChainlink to revert
 *    until the feed updates.
 * 3. Feed decimals: Chainlink ETH/USD is 8 decimals, not 6. We normalise
 *    to the same 6-decimal USDC units used in the commit-reveal preimage.
 *
 * pragma solidity ^0.8.20 — EVM target: Paris (no PUSH0)
 */

import {Ownable}        from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20}         from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// ── Chainlink interfaces (inline — avoids a package dependency) ───────────────

interface AggregatorV3Interface {
    function decimals() external view returns (uint8);
    function latestRoundData() external view returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    );
}

/// @dev Chainlink Automation v2.x compatible interface
interface AutomationCompatibleInterface {
    function checkUpkeep(bytes calldata checkData) external view returns (bool upkeepNeeded, bytes memory performData);
    function performUpkeep(bytes calldata performData) external;
}

contract PredictAgentChainlink is Ownable, ReentrancyGuard, AutomationCompatibleInterface {

    // ── Constants ────────────────────────────────────────────────────────────

    address public constant USDC = 0x3600000000000000000000000000000000000000;

    /// Maximum age of a Chainlink price answer before we reject it (default 1h)
    uint256 public maxStaleness = 3600;

    // ── Enums & Structs ───────────────────────────────────────────────────────

    enum RequestStatus { PENDING, COMMITTED, REVEALED, SETTLED, REFUNDED }

    struct SignalRequest {
        uint256 requestId;
        address buyer;
        string  tokenSymbol;
        uint256 windowOpen;
        uint256 windowClose;
        bytes32 commitHash;
        bytes32 revealedDirection;
        uint256 revealedTargetPrice;       // 6-decimal USDC units
        uint256 revealedConfidenceBandBps; // e.g. 500 = ±5%
        uint256 revealedTimestamp;
        uint256 revealedNonce;
        RequestStatus status;
        uint256 feePaid;
        bool    outcomeRecorded;
        bool    outcomeCorrect;
        // No verifier field — settlement is trustless via Chainlink
    }

    // ── Errors ────────────────────────────────────────────────────────────────

    error PA__Paused();
    error PA__NotSeller();
    error PA__InvalidStatus(uint256 requestId, uint8 expected, uint8 actual);
    error PA__WindowNotOpen();
    error PA__WindowNotClosed();
    error PA__RevealDeadlinePassed();
    error PA__RevealDeadlineNotReached();
    error PA__HashMismatch();
    error PA__NotBuyer();
    error PA__InvalidAddress();
    error PA__InvalidFee();
    error PA__TransferFailed();
    error PA__RequestNotFound(uint256 requestId);
    error PA__RenounceDisabled();
    error PA__FeedNotSet(string tokenSymbol);
    error PA__FeedStale(string tokenSymbol, uint256 updatedAt, uint256 maxStaleness);
    error PA__FeedNegativePrice(string tokenSymbol, int256 price);
    error PA__NotRevealed(uint256 requestId);

    // ── Events ────────────────────────────────────────────────────────────────

    event RequestCreated(uint256 indexed requestId, address indexed buyer, string tokenSymbol, uint256 windowOpen, uint256 windowClose, uint256 fee);
    event SignalCommitted(uint256 indexed requestId, bytes32 commitHash);
    event SignalRevealed(uint256 indexed requestId, bytes32 direction, uint256 targetPrice, uint256 confidenceBandBps, uint256 signalTimestamp, uint256 nonce);
    event OutcomeSettled(uint256 indexed requestId, uint256 settlementPrice, bool targetHit);
    event RequestSettled(uint256 indexed requestId, address indexed seller, uint256 amount);
    event RequestRefunded(uint256 indexed requestId, address indexed buyer, uint256 amount);
    event FeeUpdated(uint256 oldFee, uint256 newFee);
    event SellerUpdated(address oldSeller, address newSeller);
    event FeedSet(string indexed tokenSymbol, address indexed feed);
    event MaxStalenessUpdated(uint256 oldValue, uint256 newValue);
    event Paused(address by);
    event Unpaused(address by);

    // ── State ─────────────────────────────────────────────────────────────────

    address public seller;
    uint256 public signalFeeUsdc;
    uint256 public revealDeadlineOffset;   // default 3600 (1h)
    uint256 public outcomeDeadlineOffset;  // default 86400 (24h) — buyer escape hatch
    bool    public paused;

    mapping(uint256 => SignalRequest)  public requests;
    uint256 public nextRequestId;
    mapping(address => uint256) public settledCount;
    mapping(address => uint256) public refundedCount;

    /// token symbol → Chainlink aggregator address
    mapping(string => address) public priceFeeds;

    // ── Constructor ───────────────────────────────────────────────────────────

    constructor(address _seller, uint256 _signalFeeUsdc, address _initialOwner)
        Ownable(_initialOwner)
    {
        if (_seller == address(0) || _initialOwner == address(0)) revert PA__InvalidAddress();
        if (_signalFeeUsdc == 0) revert PA__InvalidFee();
        seller = _seller;
        signalFeeUsdc = _signalFeeUsdc;
        revealDeadlineOffset  = 3600;
        outcomeDeadlineOffset = 86400;
        nextRequestId = 1;
    }

    // ── Core flow ─────────────────────────────────────────────────────────────

    /**
     * @notice Buyer deposits USDC to request a signal for `tokenSymbol`.
     * @param tokenSymbol  e.g. "BTC", "ETH"
     * @param windowOpen   Unix timestamp when signal window opens
     * @param windowClose  Unix timestamp when signal window closes
     * @return requestId   Unique ID for this request
     */
    function requestSignal(
        string calldata tokenSymbol,
        uint256 windowOpen,
        uint256 windowClose
    ) external nonReentrant returns (uint256 requestId) {
        if (paused) revert PA__Paused();
        if (windowOpen <= block.timestamp || windowClose <= windowOpen) revert PA__WindowNotOpen();
        // Require a feed is set for this token so settlement is possible
        if (priceFeeds[tokenSymbol] == address(0)) revert PA__FeedNotSet(tokenSymbol);

        bool ok = IERC20(USDC).transferFrom(msg.sender, address(this), signalFeeUsdc);
        if (!ok) revert PA__TransferFailed();

        requestId = nextRequestId++;
        SignalRequest storage req = requests[requestId];
        req.requestId    = requestId;
        req.buyer        = msg.sender;
        req.tokenSymbol  = tokenSymbol;
        req.windowOpen   = windowOpen;
        req.windowClose  = windowClose;
        req.feePaid      = signalFeeUsdc;
        req.status       = RequestStatus.PENDING;

        emit RequestCreated(requestId, msg.sender, tokenSymbol, windowOpen, windowClose, signalFeeUsdc);
    }

    /**
     * @notice Seller commits the hash of the signal before the window opens.
     *         Hash preimage: keccak256(abi.encodePacked(
     *             requestId, direction, targetPrice, confidenceBandBps, signalTimestamp, nonce))
     */
    function commitSignal(uint256 requestId, bytes32 commitHash) external {
        if (msg.sender != seller) revert PA__NotSeller();
        SignalRequest storage req = _getExistingRequest(requestId);
        _requireStatus(requestId, req.status, RequestStatus.PENDING);
        if (block.timestamp >= req.windowOpen) revert PA__WindowNotOpen();

        req.commitHash = commitHash;
        req.status = RequestStatus.COMMITTED;
        emit SignalCommitted(requestId, commitHash);
    }

    /**
     * @notice Seller reveals the signal after the window closes.
     *         Must be called within revealDeadlineOffset seconds of windowClose.
     */
    function revealSignal(
        uint256 requestId,
        bytes32 direction,
        uint256 targetPrice,
        uint256 confidenceBandBps,
        uint256 signalTimestamp,
        uint256 nonce
    ) external {
        if (msg.sender != seller) revert PA__NotSeller();
        SignalRequest storage req = _getExistingRequest(requestId);
        _requireStatus(requestId, req.status, RequestStatus.COMMITTED);
        if (block.timestamp < req.windowClose)                             revert PA__WindowNotClosed();
        if (block.timestamp > req.windowClose + revealDeadlineOffset)     revert PA__RevealDeadlinePassed();

        bytes32 expected = keccak256(
            abi.encodePacked(requestId, direction, targetPrice, confidenceBandBps, signalTimestamp, nonce)
        );
        if (expected != req.commitHash) revert PA__HashMismatch();

        req.revealedDirection         = direction;
        req.revealedTargetPrice       = targetPrice;
        req.revealedConfidenceBandBps = confidenceBandBps;
        req.revealedTimestamp         = signalTimestamp;
        req.revealedNonce             = nonce;
        req.status                    = RequestStatus.REVEALED;

        emit SignalRevealed(requestId, direction, targetPrice, confidenceBandBps, signalTimestamp, nonce);
    }

    /**
     * @notice Trustless settlement: reads the Chainlink price feed and checks
     *         whether the target was hit within the confidence band.
     *         Anyone can call this once the request is REVEALED.
     *
     *         Target hit = |feed_price_6dec - revealedTargetPrice| / revealedTargetPrice
     *                      <= revealedConfidenceBandBps / 10_000
     *
     * @param requestId The request to settle
     */
    function settleWithChainlink(uint256 requestId) external nonReentrant {
        SignalRequest storage req = _getExistingRequest(requestId);
        _requireStatus(requestId, req.status, RequestStatus.REVEALED);

        // Read Chainlink price feed
        uint256 feedPrice6dec = _readFeedPrice(req.tokenSymbol);

        // Check whether target was hit within confidence band
        uint256 target  = req.revealedTargetPrice;
        uint256 bandBps = req.revealedConfidenceBandBps;
        // |feed - target| / target <= band / 10_000
        // Use integer arithmetic: |feed - target| * 10_000 <= target * band
        uint256 diff = feedPrice6dec >= target
            ? feedPrice6dec - target
            : target - feedPrice6dec;
        bool targetHit = (diff * 10_000) <= (target * bandBps);

        req.outcomeRecorded = true;
        req.outcomeCorrect  = targetHit;

        emit OutcomeSettled(requestId, feedPrice6dec, targetHit);

        if (targetHit) {
            _settle(requestId);
        } else {
            _refund(requestId);
        }
    }

    // ── Chainlink Automation ──────────────────────────────────────────────────

    /**
     * @notice Chainlink Automation: check if any REVEALED request is ready to settle.
     * @dev checkData encodes a range [fromId, toId] to scan. The Upkeep should
     *      be configured with a small batch (e.g. 10 IDs) to stay within gas limits.
     *      Encode: abi.encode(uint256 fromId, uint256 toId)
     */
    function checkUpkeep(bytes calldata checkData)
        external
        view
        override
        returns (bool upkeepNeeded, bytes memory performData)
    {
        (uint256 fromId, uint256 toId) = abi.decode(checkData, (uint256, uint256));
        // Cap to nextRequestId
        if (toId >= nextRequestId) toId = nextRequestId - 1;

        for (uint256 i = fromId; i <= toId; i++) {
            SignalRequest storage req = requests[i];
            if (req.status == RequestStatus.REVEALED) {
                // Check feed is available and not stale before reporting as ready
                address feed = priceFeeds[req.tokenSymbol];
                if (feed != address(0)) {
                    try AggregatorV3Interface(feed).latestRoundData() returns (
                        uint80, int256 answer, uint256, uint256 updatedAt, uint80
                    ) {
                        if (answer > 0 && block.timestamp - updatedAt <= maxStaleness) {
                            return (true, abi.encode(i));
                        }
                    } catch {} // feed call failed — skip
                }
            }
        }
        return (false, bytes(""));
    }

    /**
     * @notice Chainlink Automation: settle the request identified in performData.
     * @dev performData = abi.encode(uint256 requestId)
     */
    function performUpkeep(bytes calldata performData) external override nonReentrant {
        uint256 requestId = abi.decode(performData, (uint256));
        SignalRequest storage req = _getExistingRequest(requestId);
        // Only settle REVEALED requests (idempotency guard)
        if (req.status != RequestStatus.REVEALED) return;

        uint256 feedPrice6dec = _readFeedPrice(req.tokenSymbol);

        uint256 target  = req.revealedTargetPrice;
        uint256 bandBps = req.revealedConfidenceBandBps;
        uint256 diff    = feedPrice6dec >= target ? feedPrice6dec - target : target - feedPrice6dec;
        bool targetHit  = (diff * 10_000) <= (target * bandBps);

        req.outcomeRecorded = true;
        req.outcomeCorrect  = targetHit;
        emit OutcomeSettled(requestId, feedPrice6dec, targetHit);

        if (targetHit) { _settle(requestId); } else { _refund(requestId); }
    }

    // ── Buyer escape hatch (unchanged from PredictAgent) ─────────────────────

    function claimRefund(uint256 requestId) external nonReentrant {
        SignalRequest storage req = _getExistingRequest(requestId);
        if (msg.sender != req.buyer) revert PA__NotBuyer();

        if (
            req.status != RequestStatus.PENDING &&
            req.status != RequestStatus.COMMITTED &&
            req.status != RequestStatus.REVEALED
        ) {
            revert PA__InvalidStatus(requestId, uint8(RequestStatus.REVEALED), uint8(req.status));
        }

        if (req.status == RequestStatus.REVEALED) {
            if (block.timestamp <= req.windowClose + revealDeadlineOffset + outcomeDeadlineOffset) {
                revert PA__RevealDeadlineNotReached();
            }
        } else if (block.timestamp <= req.windowClose + revealDeadlineOffset) {
            revert PA__RevealDeadlineNotReached();
        }

        _refund(requestId);
    }

    // ── Owner functions ───────────────────────────────────────────────────────

    /**
     * @notice Set the Chainlink Data Feed address for a token symbol.
     *         Must be set before buyers can request signals for that token.
     * @param tokenSymbol e.g. "BTC"
     * @param feed        Chainlink AggregatorV3 proxy address on Arc mainnet
     */
    function setPriceFeed(string calldata tokenSymbol, address feed) external onlyOwner {
        if (feed == address(0)) revert PA__InvalidAddress();
        priceFeeds[tokenSymbol] = feed;
        emit FeedSet(tokenSymbol, feed);
    }

    function setMaxStaleness(uint256 staleness) external onlyOwner {
        uint256 old = maxStaleness;
        maxStaleness = staleness;
        emit MaxStalenessUpdated(old, staleness);
    }

    function setFee(uint256 newFee) external onlyOwner {
        if (newFee == 0) revert PA__InvalidFee();
        uint256 old = signalFeeUsdc;
        signalFeeUsdc = newFee;
        emit FeeUpdated(old, newFee);
    }

    function setSeller(address newSeller) external onlyOwner {
        if (newSeller == address(0)) revert PA__InvalidAddress();
        address old = seller;
        seller = newSeller;
        emit SellerUpdated(old, newSeller);
    }

    function setRevealDeadlineOffset(uint256 offset) external onlyOwner {
        revealDeadlineOffset = offset;
    }

    function setOutcomeDeadlineOffset(uint256 offset) external onlyOwner {
        outcomeDeadlineOffset = offset;
    }

    function pause()   external onlyOwner { paused = true;  emit Paused(msg.sender);   }
    function unpause() external onlyOwner { paused = false; emit Unpaused(msg.sender); }

    function renounceOwnership() public override onlyOwner {
        if (paused) revert PA__RenounceDisabled();
        super.renounceOwnership();
    }

    // ── View functions ────────────────────────────────────────────────────────

    function getRequest(uint256 requestId) external view returns (SignalRequest memory) {
        return requests[requestId];
    }

    function getReputation(address addr) external view returns (uint256 settled, uint256 refunded) {
        settled  = settledCount[addr];
        refunded = refundedCount[addr];
    }

    /**
     * @notice Read the current Chainlink price for a token, normalised to
     *         6-decimal USDC units. Reverts on stale or missing data.
     */
    function getChainlinkPrice(string calldata tokenSymbol) external view returns (uint256 price6dec) {
        return _readFeedPrice(tokenSymbol);
    }

    // ── Internal ──────────────────────────────────────────────────────────────

    function _readFeedPrice(string memory tokenSymbol) internal view returns (uint256 price6dec) {
        address feedAddr = priceFeeds[tokenSymbol];
        if (feedAddr == address(0)) revert PA__FeedNotSet(tokenSymbol);

        AggregatorV3Interface feed = AggregatorV3Interface(feedAddr);
        (, int256 answer, , uint256 updatedAt,) = feed.latestRoundData();

        if (block.timestamp - updatedAt > maxStaleness) {
            revert PA__FeedStale(tokenSymbol, updatedAt, maxStaleness);
        }
        if (answer <= 0) revert PA__FeedNegativePrice(tokenSymbol, answer);

        uint8 dec = feed.decimals();
        // Normalise to 6 decimals
        if (dec >= 6) {
            price6dec = uint256(answer) / (10 ** (dec - 6));
        } else {
            price6dec = uint256(answer) * (10 ** (6 - dec));
        }
    }

    function _settle(uint256 requestId) internal {
        SignalRequest storage req = requests[requestId];
        req.status = RequestStatus.SETTLED;
        settledCount[seller] += 1;
        bool ok = IERC20(USDC).transfer(seller, req.feePaid);
        if (!ok) revert PA__TransferFailed();
        emit RequestSettled(requestId, seller, req.feePaid);
    }

    function _refund(uint256 requestId) internal {
        SignalRequest storage req = requests[requestId];
        req.status = RequestStatus.REFUNDED;
        refundedCount[req.buyer] += 1;
        bool ok = IERC20(USDC).transfer(req.buyer, req.feePaid);
        if (!ok) revert PA__TransferFailed();
        emit RequestRefunded(requestId, req.buyer, req.feePaid);
    }

    function _requireStatus(uint256 requestId, RequestStatus actual, RequestStatus expected) internal pure {
        if (actual != expected) revert PA__InvalidStatus(requestId, uint8(expected), uint8(actual));
    }

    function _getExistingRequest(uint256 requestId) internal view returns (SignalRequest storage req) {
        req = requests[requestId];
        if (req.requestId != requestId || requestId == 0) revert PA__RequestNotFound(requestId);
    }
}
