// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract PredictAgent is Ownable, ReentrancyGuard {
    address public constant USDC = 0x3600000000000000000000000000000000000000;

    enum RequestStatus {
        PENDING,
        COMMITTED,
        REVEALED,
        SETTLED,
        REFUNDED
    }

    struct SignalRequest {
        uint256 requestId;
        address buyer;
        string tokenSymbol;
        uint256 windowOpen;
        uint256 windowClose;
        bytes32 commitHash;
        bytes32 revealedDirection;
        uint256 revealedTargetPrice;
        uint256 revealedConfidenceBandBps;
        uint256 revealedTimestamp;
        uint256 revealedNonce;
        RequestStatus status;
        address verifier;
        uint256 feePaid;
        bool outcomeRecorded;
        bool outcomeCorrect;
    }

    error PredictAgent__Paused();
    error PredictAgent__NotSeller();
    error PredictAgent__InvalidStatus(uint256 requestId, uint8 expected, uint8 actual);
    error PredictAgent__WindowNotOpen();
    error PredictAgent__WindowNotClosed();
    error PredictAgent__RevealDeadlinePassed();
    error PredictAgent__RevealDeadlineNotReached();
    error PredictAgent__HashMismatch();
    error PredictAgent__NotBuyer();
    error PredictAgent__InvalidAddress();
    error PredictAgent__InvalidFee();
    error PredictAgent__OutcomeNotRecorded();
    error PredictAgent__NotAuthorized();
    error PredictAgent__TransferFailed();
    error PredictAgent__RequestNotFound(uint256 requestId);
    error PredictAgent__RenounceDisabled();

    event RequestCreated(
        uint256 indexed requestId,
        address indexed buyer,
        string tokenSymbol,
        uint256 windowOpen,
        uint256 windowClose,
        uint256 fee
    );
    event SignalCommitted(uint256 indexed requestId, bytes32 commitHash);
    event SignalRevealed(
        uint256 indexed requestId,
        bytes32 direction,
        uint256 targetPrice,
        uint256 confidenceBandBps,
        uint256 signalTimestamp,
        uint256 nonce
    );
    event OutcomeRecorded(uint256 indexed requestId, address indexed verifier, bool correct);
    event RequestSettled(uint256 indexed requestId, address indexed seller, uint256 amount);
    event RequestRefunded(uint256 indexed requestId, address indexed buyer, uint256 amount);
    event FeeUpdated(uint256 oldFee, uint256 newFee);
    event SellerUpdated(address oldSeller, address newSeller);
    event VerifierUpdated(uint256 indexed requestId, address indexed oldVerifier, address indexed newVerifier);
    event OutcomeDeadlineOffsetUpdated(uint256 oldOffset, uint256 newOffset);
    event Paused(address by);
    event Unpaused(address by);

    address public seller;
    uint256 public signalFeeUsdc;
    uint256 public revealDeadlineOffset;
    uint256 public outcomeDeadlineOffset;
    bool public paused;

    mapping(uint256 => SignalRequest) public requests;
    uint256 public nextRequestId;
    mapping(address => uint256) public settledCount;
    mapping(address => uint256) public refundedCount;

    constructor(address _seller, uint256 _signalFeeUsdc, address _initialOwner) Ownable(_initialOwner) {
        if (_seller == address(0) || _initialOwner == address(0)) {
            revert PredictAgent__InvalidAddress();
        }
        if (_signalFeeUsdc == 0) {
            revert PredictAgent__InvalidFee();
        }

        seller = _seller;
        signalFeeUsdc = _signalFeeUsdc;
        revealDeadlineOffset = 3600;
        outcomeDeadlineOffset = 86400;
        nextRequestId = 1;
    }

    function requestSignal(
        string calldata tokenSymbol,
        uint256 windowOpen,
        uint256 windowClose
    ) external nonReentrant returns (uint256 requestId) {
        if (paused) {
            revert PredictAgent__Paused();
        }
        if (windowOpen <= block.timestamp || windowClose <= windowOpen) {
            revert PredictAgent__WindowNotOpen();
        }

        bool ok = IERC20(USDC).transferFrom(msg.sender, address(this), signalFeeUsdc);
        if (!ok) {
            revert PredictAgent__TransferFailed();
        }

        requestId = nextRequestId;
        nextRequestId = requestId + 1;

        SignalRequest storage req = requests[requestId];
        req.requestId = requestId;
        req.buyer = msg.sender;
        req.tokenSymbol = tokenSymbol;
        req.windowOpen = windowOpen;
        req.windowClose = windowClose;
        req.feePaid = signalFeeUsdc;
        req.status = RequestStatus.PENDING;

        emit RequestCreated(requestId, msg.sender, tokenSymbol, windowOpen, windowClose, signalFeeUsdc);
    }

    function commitSignal(uint256 requestId, bytes32 commitHash) external {
        if (msg.sender != seller) {
            revert PredictAgent__NotSeller();
        }

        SignalRequest storage req = _getExistingRequest(requestId);
        _requireStatus(requestId, req.status, RequestStatus.PENDING);

        if (block.timestamp >= req.windowOpen) {
            revert PredictAgent__WindowNotOpen();
        }

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
        if (msg.sender != seller) {
            revert PredictAgent__NotSeller();
        }

        SignalRequest storage req = _getExistingRequest(requestId);
        _requireStatus(requestId, req.status, RequestStatus.COMMITTED);

        if (block.timestamp < req.windowClose) {
            revert PredictAgent__WindowNotClosed();
        }
        if (block.timestamp > req.windowClose + revealDeadlineOffset) {
            revert PredictAgent__RevealDeadlinePassed();
        }

        bytes32 expectedHash = keccak256(
            abi.encodePacked(requestId, direction, targetPrice, confidenceBandBps, signalTimestamp, nonce)
        );
        if (expectedHash != req.commitHash) {
            revert PredictAgent__HashMismatch();
        }

        req.revealedDirection = direction;
        req.revealedTargetPrice = targetPrice;
        req.revealedConfidenceBandBps = confidenceBandBps;
        req.revealedTimestamp = signalTimestamp;
        req.revealedNonce = nonce;
        req.status = RequestStatus.REVEALED;

        emit SignalRevealed(requestId, direction, targetPrice, confidenceBandBps, signalTimestamp, nonce);
    }

    function recordOutcome(uint256 requestId, bool correct) external nonReentrant {
        SignalRequest storage req = _getExistingRequest(requestId);
        if (msg.sender != req.verifier && msg.sender != owner()) {
            revert PredictAgent__NotAuthorized();
        }

        _requireStatus(requestId, req.status, RequestStatus.REVEALED);

        req.outcomeRecorded = true;
        req.outcomeCorrect = correct;

        emit OutcomeRecorded(requestId, msg.sender, correct);

        if (correct) {
            _settle(requestId);
        } else {
            _refund(requestId);
        }
    }

    function claimRefund(uint256 requestId) external nonReentrant {
        SignalRequest storage req = _getExistingRequest(requestId);
        if (msg.sender != req.buyer) {
            revert PredictAgent__NotBuyer();
        }

        if (
            req.status != RequestStatus.PENDING && req.status != RequestStatus.COMMITTED
                && req.status != RequestStatus.REVEALED
        ) {
            revert PredictAgent__InvalidStatus(requestId, uint8(RequestStatus.REVEALED), uint8(req.status));
        }

        if (req.status == RequestStatus.REVEALED) {
            if (block.timestamp <= req.windowClose + revealDeadlineOffset + outcomeDeadlineOffset) {
                revert PredictAgent__RevealDeadlineNotReached();
            }
        } else if (block.timestamp <= req.windowClose + revealDeadlineOffset) {
            revert PredictAgent__RevealDeadlineNotReached();
        }

        _refund(requestId);
    }

    function setFee(uint256 newFee) external onlyOwner {
        if (newFee == 0) {
            revert PredictAgent__InvalidFee();
        }

        uint256 oldFee = signalFeeUsdc;
        signalFeeUsdc = newFee;

        emit FeeUpdated(oldFee, newFee);
    }

    function setSeller(address newSeller) external onlyOwner {
        if (newSeller == address(0)) {
            revert PredictAgent__InvalidAddress();
        }

        address oldSeller = seller;
        seller = newSeller;

        emit SellerUpdated(oldSeller, newSeller);
    }

    function setVerifier(uint256 requestId, address verifier) external onlyOwner {
        if (verifier == address(0)) {
            revert PredictAgent__InvalidAddress();
        }

        SignalRequest storage req = _getExistingRequest(requestId);
        address oldVerifier = req.verifier;
        req.verifier = verifier;

        emit VerifierUpdated(requestId, oldVerifier, verifier);
    }

    function setRevealDeadlineOffset(uint256 offset) external onlyOwner {
        revealDeadlineOffset = offset;
    }

    function setOutcomeDeadlineOffset(uint256 offset) external onlyOwner {
        uint256 oldOffset = outcomeDeadlineOffset;
        outcomeDeadlineOffset = offset;

        emit OutcomeDeadlineOffsetUpdated(oldOffset, offset);
    }

    function pause() external onlyOwner {
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit Unpaused(msg.sender);
    }

    function renounceOwnership() public override onlyOwner {
        if (paused) {
            revert PredictAgent__RenounceDisabled();
        }

        super.renounceOwnership();
    }

    function getRequest(uint256 requestId) external view returns (SignalRequest memory) {
        return requests[requestId];
    }

    function getReputation(address addr) external view returns (uint256 settled, uint256 refunded) {
        settled = settledCount[addr];
        refunded = refundedCount[addr];
    }

    function _settle(uint256 requestId) internal {
        SignalRequest storage req = requests[requestId];

        req.status = RequestStatus.SETTLED;
        settledCount[seller] += 1;

        bool ok = IERC20(USDC).transfer(seller, req.feePaid);
        if (!ok) {
            revert PredictAgent__TransferFailed();
        }

        emit RequestSettled(requestId, seller, req.feePaid);
    }

    function _refund(uint256 requestId) internal {
        SignalRequest storage req = requests[requestId];

        req.status = RequestStatus.REFUNDED;
        refundedCount[req.buyer] += 1;

        bool ok = IERC20(USDC).transfer(req.buyer, req.feePaid);
        if (!ok) {
            revert PredictAgent__TransferFailed();
        }

        emit RequestRefunded(requestId, req.buyer, req.feePaid);
    }

    function _requireStatus(uint256 requestId, RequestStatus actual, RequestStatus expected) internal pure {
        if (actual != expected) {
            revert PredictAgent__InvalidStatus(requestId, uint8(expected), uint8(actual));
        }
    }

    function _getExistingRequest(uint256 requestId) internal view returns (SignalRequest storage req) {
        req = requests[requestId];
        if (req.requestId != requestId || requestId == 0) {
            revert PredictAgent__RequestNotFound(requestId);
        }
    }
}
