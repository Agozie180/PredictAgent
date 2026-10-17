// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, console2} from "forge-std/Test.sol";
import {PredictAgent} from "../PredictAgent.sol";
import {MockERC20}    from "../test-helpers/MockERC20.sol";

/**
 * @title PredictAgentTest
 * @notice Foundry unit-test suite covering all specified behaviours of PredictAgent.
 *
 * USDC is a hardcoded constant at 0x3600…0000.
 * We deploy MockERC20 to a throwaway address, then copy its runtime bytecode to the
 * canonical USDC address with vm.etch, and re-bind the handle.  Storage is empty
 * after vm.etch, so we seed balances with usdc.mint(...).
 */
contract PredictAgentTest is Test {

    // ─── canonical USDC address (matches PredictAgent.USDC) ─────────────────
    address internal constant USDC_ADDR = 0x3600000000000000000000000000000000000000;

    // ─── actors ──────────────────────────────────────────────────────────────
    address internal owner    = makeAddr("owner");
    address internal sellerAcc = makeAddr("seller");
    address internal buyer    = makeAddr("buyer");
    address internal verifier = makeAddr("verifier");
    address internal stranger = makeAddr("stranger");

    // ─── contracts ───────────────────────────────────────────────────────────
    PredictAgent internal agent;
    MockERC20    internal usdc;

    // ─── constants ───────────────────────────────────────────────────────────
    uint256 internal constant FEE = 10e6;           // 10 USDC (6 decimals)
    uint256 internal constant REVEAL_OFFSET  = 3600;  // default in constructor
    uint256 internal constant OUTCOME_OFFSET = 86400; // default outcomeDeadlineOffset
    uint256 internal constant MIN_REVEAL_OFFSET = 3600;   // default minRevealOffset
    uint256 internal constant MAX_REVEAL_OFFSET = 172800; // default maxRevealOffset

    // ─── timing helpers ──────────────────────────────────────────────────────
    uint256 internal T0;          // "now" at setUp
    uint256 internal WINDOW_OPEN; // T0 + 1 h  → buyer requests before this
    uint256 internal WINDOW_CLOSE;// T0 + 2 h  → seller reveals after this

    // ─── common signal data ──────────────────────────────────────────────────
    bytes32 internal constant DIRECTION     = keccak256("LONG");
    uint256 internal constant TARGET_PRICE  = 50_000e8;
    uint256 internal constant CONFIDENCE    = 500; // 5 %
    uint256 internal constant SIG_TIMESTAMP = 1_700_000_000;
    uint256 internal constant NONCE         = 42;

    // ─────────────────────────────────────────────────────────────────────────
    //  setUp
    // ─────────────────────────────────────────────────────────────────────────
    function setUp() public {
        // Fix a known timestamp so all window arithmetic is deterministic.
        T0           = 1_000_000;
        WINDOW_OPEN  = T0 + 1 hours;
        WINDOW_CLOSE = T0 + 2 hours;
        vm.warp(T0);

        // 1. Deploy a MockERC20 to a throwaway address.
        MockERC20 mock = new MockERC20("Mock USDC", "mUSDC", 6);

        // 2. Copy runtime bytecode to the canonical USDC constant address.
        vm.etch(USDC_ADDR, address(mock).code);

        // 3. Bind the canonical handle (storage starts empty).
        usdc = MockERC20(USDC_ADDR);

        // 4. Deploy PredictAgent — USDC constant now has code behind it.
        vm.prank(owner);
        agent = new PredictAgent(sellerAcc, FEE, owner);

        // 5. Fund buyer and grant allowance to agent.
        usdc.mint(buyer, 1_000e6);
        vm.prank(buyer);
        usdc.approve(address(agent), type(uint256).max);
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Internal helpers
    // ─────────────────────────────────────────────────────────────────────────

    /// Compute the commit hash the seller would create for the canonical signal data.
    function _makeCommitHash(uint256 requestId) internal pure returns (bytes32) {
        return keccak256(
            abi.encodePacked(requestId, DIRECTION, TARGET_PRICE, CONFIDENCE, SIG_TIMESTAMP, NONCE)
        );
    }

    /// Walk the contract from PENDING all the way to COMMITTED.
    /// Returns the requestId.  Passes buyerRevealOffset=0 (use global default).
    function _doRequest() internal returns (uint256 requestId) {
        vm.prank(buyer);
        requestId = agent.requestSignal("BTC", WINDOW_OPEN, WINDOW_CLOSE, 0);
    }

    /// Walk from PENDING → COMMITTED (also calls _doRequest internally).
    function _doRequestAndCommit() internal returns (uint256 requestId) {
        requestId = _doRequest();

        // seller commits before window opens
        bytes32 h = _makeCommitHash(requestId);
        vm.prank(sellerAcc);
        agent.commitSignal(requestId, h);
    }

    /// Walk from PENDING → COMMITTED → REVEALED.
    function _doRequestCommitReveal() internal returns (uint256 requestId) {
        requestId = _doRequestAndCommit();

        // warp past windowClose but within revealDeadline
        vm.warp(WINDOW_CLOSE + 1);

        vm.prank(sellerAcc);
        agent.revealSignal(
            requestId,
            DIRECTION,
            TARGET_PRICE,
            CONFIDENCE,
            SIG_TIMESTAMP,
            NONCE
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  1. Happy path: full cycle → SETTLED, seller receives USDC
    // ─────────────────────────────────────────────────────────────────────────
    function test_FullCycle_SettledSellerReceivesUSDC() public {
        uint256 requestId = _doRequestCommitReveal();

        // Set verifier on the request so we can call recordOutcome.
        vm.prank(owner);
        agent.setVerifier(requestId, verifier);

        uint256 sellerBefore = usdc.balanceOf(sellerAcc);

        // Expect events for outcome and settlement.
        vm.expectEmit(true, true, false, true, address(agent));
        emit PredictAgent.OutcomeRecorded(requestId, verifier, true);

        // Settlement amount matches req.feePaid (which equals FEE at request time).
        vm.expectEmit(true, true, false, true, address(agent));
        emit PredictAgent.RequestSettled(requestId, sellerAcc, FEE);

        vm.prank(verifier);
        agent.recordOutcome(requestId, true);

        // Seller received exactly req.feePaid.
        assertEq(usdc.balanceOf(sellerAcc), sellerBefore + FEE, "seller balance mismatch");

        // Status is SETTLED.
        PredictAgent.SignalRequest memory req = agent.getRequest(requestId);
        assertEq(uint8(req.status), uint8(PredictAgent.RequestStatus.SETTLED), "not SETTLED");
        assertTrue(req.outcomeRecorded, "outcome not recorded");
        assertTrue(req.outcomeCorrect,  "outcome should be correct");
        assertEq(req.feePaid, FEE, "req.feePaid mismatch after settle");

        // settledCount incremented.
        (uint256 settled,) = agent.getReputation(sellerAcc);
        assertEq(settled, 1, "settledCount mismatch");
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  2. Missed reveal refund: buyer claimRefund after revealDeadlineOffset
    // ─────────────────────────────────────────────────────────────────────────
    function test_ClaimRefund_AfterRevealDeadline_PENDING() public {
        uint256 requestId = _doRequest(); // stays PENDING

        // Warp past windowClose + revealDeadlineOffset
        vm.warp(WINDOW_CLOSE + REVEAL_OFFSET + 1);

        uint256 buyerBefore = usdc.balanceOf(buyer);

        vm.expectEmit(true, true, false, true, address(agent));
        emit PredictAgent.RequestRefunded(requestId, buyer, FEE);

        vm.prank(buyer);
        agent.claimRefund(requestId);

        assertEq(usdc.balanceOf(buyer), buyerBefore + FEE, "buyer refund amount mismatch");

        PredictAgent.SignalRequest memory req = agent.getRequest(requestId);
        assertEq(uint8(req.status), uint8(PredictAgent.RequestStatus.REFUNDED), "not REFUNDED");
        assertEq(req.feePaid, FEE, "req.feePaid mismatch after refund");
    }

    function test_ClaimRefund_AfterRevealDeadline_COMMITTED() public {
        uint256 requestId = _doRequestAndCommit(); // COMMITTED state

        // Warp past windowClose + revealDeadlineOffset
        vm.warp(WINDOW_CLOSE + REVEAL_OFFSET + 1);

        uint256 buyerBefore = usdc.balanceOf(buyer);

        vm.prank(buyer);
        agent.claimRefund(requestId);

        assertEq(usdc.balanceOf(buyer), buyerBefore + FEE, "buyer refund amount mismatch (committed)");

        PredictAgent.SignalRequest memory req = agent.getRequest(requestId);
        assertEq(uint8(req.status), uint8(PredictAgent.RequestStatus.REFUNDED), "not REFUNDED");
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  NEW: claimRefund from REVEALED after outcomeDeadlineOffset has passed
    // ─────────────────────────────────────────────────────────────────────────

    /// Happy path: buyer can claimRefund once the outcome window has expired.
    function test_ClaimRefund_AfterOutcomeDeadline_REVEALED() public {
        uint256 requestId = _doRequestCommitReveal(); // status → REVEALED

        // Must warp past windowClose + revealDeadlineOffset + outcomeDeadlineOffset.
        vm.warp(WINDOW_CLOSE + REVEAL_OFFSET + OUTCOME_OFFSET + 1);

        uint256 buyerBefore = usdc.balanceOf(buyer);

        vm.expectEmit(true, true, false, true, address(agent));
        emit PredictAgent.RequestRefunded(requestId, buyer, FEE);

        vm.prank(buyer);
        agent.claimRefund(requestId);

        // Buyer got feePaid back.
        assertEq(usdc.balanceOf(buyer), buyerBefore + FEE, "buyer refund mismatch from REVEALED");

        PredictAgent.SignalRequest memory req = agent.getRequest(requestId);
        assertEq(uint8(req.status), uint8(PredictAgent.RequestStatus.REFUNDED), "not REFUNDED");
        assertEq(req.feePaid, FEE, "req.feePaid mismatch");
    }

    /// Boundary: claimRefund from REVEALED reverts if the outcome window has NOT expired.
    function test_ClaimRefund_BeforeOutcomeDeadline_REVEALED_Reverts() public {
        uint256 requestId = _doRequestCommitReveal(); // status → REVEALED

        // Warp to exactly the boundary — condition is strictly >, so still reverts.
        vm.warp(WINDOW_CLOSE + REVEAL_OFFSET + OUTCOME_OFFSET);

        vm.expectRevert(PredictAgent.PredictAgent__RevealDeadlineNotReached.selector);
        vm.prank(buyer);
        agent.claimRefund(requestId);
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  3. Hash mismatch refund: revealSignal with wrong data → HashMismatch
    // ─────────────────────────────────────────────────────────────────────────
    function test_RevealSignal_HashMismatch_Reverts() public {
        uint256 requestId = _doRequestAndCommit();

        // Warp past windowClose
        vm.warp(WINDOW_CLOSE + 1);

        // Reveal with wrong nonce (so hash won't match)
        vm.expectRevert(PredictAgent.PredictAgent__HashMismatch.selector);
        vm.prank(sellerAcc);
        agent.revealSignal(
            requestId,
            DIRECTION,
            TARGET_PRICE,
            CONFIDENCE,
            SIG_TIMESTAMP,
            NONCE + 1  // wrong nonce
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  4. Unauthorized commit: non-seller calling commitSignal → NotSeller
    // ─────────────────────────────────────────────────────────────────────────
    function test_CommitSignal_NonSeller_Reverts() public {
        uint256 requestId = _doRequest();
        bytes32 h = _makeCommitHash(requestId);

        vm.expectRevert(PredictAgent.PredictAgent__NotSeller.selector);
        vm.prank(stranger);
        agent.commitSignal(requestId, h);
    }

    function test_CommitSignal_Buyer_Reverts() public {
        uint256 requestId = _doRequest();
        bytes32 h = _makeCommitHash(requestId);

        vm.expectRevert(PredictAgent.PredictAgent__NotSeller.selector);
        vm.prank(buyer);
        agent.commitSignal(requestId, h);
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  5. Pause behaviour
    // ─────────────────────────────────────────────────────────────────────────
    function test_RequestSignal_RevertsWhenPaused() public {
        vm.prank(owner);
        agent.pause();

        vm.expectRevert(PredictAgent.PredictAgent__Paused.selector);
        vm.prank(buyer);
        agent.requestSignal("BTC", WINDOW_OPEN, WINDOW_CLOSE, 0);
    }

    function test_RequestSignal_SucceedsAfterUnpause() public {
        // Pause then unpause.
        vm.startPrank(owner);
        agent.pause();
        agent.unpause();
        vm.stopPrank();

        assertFalse(agent.paused(), "should be unpaused");

        // Request should succeed.
        vm.prank(buyer);
        uint256 requestId = agent.requestSignal("BTC", WINDOW_OPEN, WINDOW_CLOSE, 0);
        assertEq(requestId, 1, "requestId should be 1");
    }

    function test_Pause_EmitsEvent() public {
        vm.expectEmit(true, false, false, false, address(agent));
        emit PredictAgent.Paused(owner);
        vm.prank(owner);
        agent.pause();

        assertTrue(agent.paused(), "should be paused");
    }

    function test_Unpause_EmitsEvent() public {
        vm.prank(owner);
        agent.pause();

        vm.expectEmit(true, false, false, false, address(agent));
        emit PredictAgent.Unpaused(owner);
        vm.prank(owner);
        agent.unpause();
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  NEW: renounceOwnership reverts when paused
    // ─────────────────────────────────────────────────────────────────────────
    function test_RenounceOwnership_RevertsWhenPaused() public {
        // Pause the contract first.
        vm.prank(owner);
        agent.pause();

        // renounceOwnership should revert with PredictAgent__RenounceDisabled.
        vm.expectRevert(PredictAgent.PredictAgent__RenounceDisabled.selector);
        vm.prank(owner);
        agent.renounceOwnership();

        // Ownership must be unchanged.
        assertEq(agent.owner(), owner, "owner should be unchanged");
    }

    /// renounceOwnership succeeds when NOT paused (happy path for the override).
    function test_RenounceOwnership_SucceedsWhenNotPaused() public {
        assertFalse(agent.paused(), "pre-condition: not paused");

        vm.prank(owner);
        agent.renounceOwnership();

        assertEq(agent.owner(), address(0), "owner should be zero after renounce");
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  6. recordOutcome(false) → REFUNDED, buyer receives USDC
    // ─────────────────────────────────────────────────────────────────────────
    function test_RecordOutcome_False_BuyerRefunded() public {
        uint256 requestId = _doRequestCommitReveal();

        vm.prank(owner);
        agent.setVerifier(requestId, verifier);

        uint256 buyerBefore = usdc.balanceOf(buyer);

        vm.expectEmit(true, true, false, true, address(agent));
        emit PredictAgent.OutcomeRecorded(requestId, verifier, false);

        vm.expectEmit(true, true, false, true, address(agent));
        emit PredictAgent.RequestRefunded(requestId, buyer, FEE);

        vm.prank(verifier);
        agent.recordOutcome(requestId, false);

        assertEq(usdc.balanceOf(buyer), buyerBefore + FEE, "buyer refund mismatch");

        PredictAgent.SignalRequest memory req = agent.getRequest(requestId);
        assertEq(uint8(req.status), uint8(PredictAgent.RequestStatus.REFUNDED), "not REFUNDED");
        assertTrue(req.outcomeRecorded,  "outcomeRecorded should be true");
        assertFalse(req.outcomeCorrect,  "outcomeCorrect should be false");
        assertEq(req.feePaid, FEE, "req.feePaid mismatch after refund via outcome");

        // refundedCount incremented.
        (, uint256 refunded) = agent.getReputation(buyer);
        assertEq(refunded, 1, "refundedCount mismatch");
    }

    // Also test owner (no verifier set) can call recordOutcome.
    function test_RecordOutcome_ByOwner_Succeeds() public {
        uint256 requestId = _doRequestCommitReveal();
        // No setVerifier — owner is authorized directly.

        vm.prank(owner);
        agent.recordOutcome(requestId, true);

        PredictAgent.SignalRequest memory req = agent.getRequest(requestId);
        assertEq(uint8(req.status), uint8(PredictAgent.RequestStatus.SETTLED), "not SETTLED");
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  7. Buyer cannot claimRefund before deadline
    // ─────────────────────────────────────────────────────────────────────────
    function test_ClaimRefund_BeforeDeadline_Reverts() public {
        uint256 requestId = _doRequest();

        // We are still at T0 — far before windowClose + revealDeadlineOffset.
        vm.expectRevert(PredictAgent.PredictAgent__RevealDeadlineNotReached.selector);
        vm.prank(buyer);
        agent.claimRefund(requestId);
    }

    function test_ClaimRefund_ExactlyAtDeadline_Reverts() public {
        uint256 requestId = _doRequest();

        // Warp to EXACTLY the deadline — condition is strictly >, so still reverts.
        vm.warp(WINDOW_CLOSE + REVEAL_OFFSET);

        vm.expectRevert(PredictAgent.PredictAgent__RevealDeadlineNotReached.selector);
        vm.prank(buyer);
        agent.claimRefund(requestId);
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  8. Reveal before windowClose fails → WindowNotClosed
    // ─────────────────────────────────────────────────────────────────────────
    function test_RevealSignal_BeforeWindowClose_Reverts() public {
        uint256 requestId = _doRequestAndCommit();

        // Still before WINDOW_CLOSE — do not warp forward.
        // block.timestamp is T0, window closes at T0 + 2h.
        vm.expectRevert(PredictAgent.PredictAgent__WindowNotClosed.selector);
        vm.prank(sellerAcc);
        agent.revealSignal(
            requestId,
            DIRECTION,
            TARGET_PRICE,
            CONFIDENCE,
            SIG_TIMESTAMP,
            NONCE
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  9. Reveal after revealDeadlineOffset fails → RevealDeadlinePassed
    // ─────────────────────────────────────────────────────────────────────────
    function test_RevealSignal_AfterRevealDeadline_Reverts() public {
        uint256 requestId = _doRequestAndCommit();

        // Warp past windowClose + revealDeadlineOffset.
        vm.warp(WINDOW_CLOSE + REVEAL_OFFSET + 1);

        vm.expectRevert(PredictAgent.PredictAgent__RevealDeadlinePassed.selector);
        vm.prank(sellerAcc);
        agent.revealSignal(
            requestId,
            DIRECTION,
            TARGET_PRICE,
            CONFIDENCE,
            SIG_TIMESTAMP,
            NONCE
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  10. Non-verifier/non-owner cannot call recordOutcome → NotAuthorized
    // ─────────────────────────────────────────────────────────────────────────
    function test_RecordOutcome_Stranger_Reverts() public {
        uint256 requestId = _doRequestCommitReveal();

        vm.prank(owner);
        agent.setVerifier(requestId, verifier);

        vm.expectRevert(PredictAgent.PredictAgent__NotAuthorized.selector);
        vm.prank(stranger);
        agent.recordOutcome(requestId, true);
    }

    function test_RecordOutcome_Seller_Reverts() public {
        // seller is not owner and not verifier
        uint256 requestId = _doRequestCommitReveal();

        vm.expectRevert(PredictAgent.PredictAgent__NotAuthorized.selector);
        vm.prank(sellerAcc);
        agent.recordOutcome(requestId, true);
    }

    function test_RecordOutcome_Buyer_Reverts() public {
        uint256 requestId = _doRequestCommitReveal();

        vm.expectRevert(PredictAgent.PredictAgent__NotAuthorized.selector);
        vm.prank(buyer);
        agent.recordOutcome(requestId, true);
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Additional: deployment / initialization
    // ─────────────────────────────────────────────────────────────────────────
    function test_Deployment_InitialState() public view {
        assertEq(agent.seller(),               sellerAcc,         "seller mismatch");
        assertEq(agent.signalFeeUsdc(),        FEE,               "fee mismatch");
        assertEq(agent.revealDeadlineOffset(), REVEAL_OFFSET,     "reveal offset mismatch");
        assertEq(agent.outcomeDeadlineOffset(), OUTCOME_OFFSET,   "outcome offset mismatch");
        assertEq(agent.nextRequestId(),        1,                 "nextRequestId should start at 1");
        assertFalse(agent.paused(),                               "should not be paused");
        assertEq(agent.owner(),                owner,             "owner mismatch");
        // New in updated contract: reveal offset bounds
        assertEq(agent.minRevealOffset(), MIN_REVEAL_OFFSET, "minRevealOffset mismatch");
        assertEq(agent.maxRevealOffset(), MAX_REVEAL_OFFSET, "maxRevealOffset mismatch");
    }

    function test_Deployment_InvalidSeller_Reverts() public {
        vm.expectRevert(PredictAgent.PredictAgent__InvalidAddress.selector);
        new PredictAgent(address(0), FEE, owner);
    }

    function test_Deployment_ZeroFee_Reverts() public {
        vm.expectRevert(PredictAgent.PredictAgent__InvalidFee.selector);
        new PredictAgent(sellerAcc, 0, owner);
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Additional: requestSignal happy path — feePaid stored on request
    // ─────────────────────────────────────────────────────────────────────────
    function test_RequestSignal_HappyPath_EmitsEvent() public {
        vm.expectEmit(true, true, false, true, address(agent));
        emit PredictAgent.RequestCreated(1, buyer, "BTC", WINDOW_OPEN, WINDOW_CLOSE, FEE);

        vm.prank(buyer);
        uint256 requestId = agent.requestSignal("BTC", WINDOW_OPEN, WINDOW_CLOSE, 0);

        assertEq(requestId, 1, "first requestId should be 1");
        assertEq(agent.nextRequestId(), 2, "nextRequestId should be 2");

        // Fee deducted from buyer.
        assertEq(usdc.balanceOf(buyer), 1_000e6 - FEE, "buyer balance mismatch");

        PredictAgent.SignalRequest memory req = agent.getRequest(requestId);
        assertEq(req.buyer,       buyer,  "req.buyer mismatch");
        assertEq(req.tokenSymbol, "BTC",  "req.tokenSymbol mismatch");
        assertEq(uint8(req.status), uint8(PredictAgent.RequestStatus.PENDING), "not PENDING");
        // feePaid must be snapshotted at the fee active when the request was created.
        assertEq(req.feePaid, FEE, "req.feePaid not stored correctly");
        // Default offset: buyerRevealDeadline == global revealDeadlineOffset (3600)
        assertEq(req.buyerRevealDeadline, REVEAL_OFFSET, "buyerRevealDeadline should default to revealDeadlineOffset");
    }

    function test_RequestSignal_InvalidWindow_Reverts() public {
        // windowOpen in the past
        vm.expectRevert(PredictAgent.PredictAgent__WindowNotOpen.selector);
        vm.prank(buyer);
        agent.requestSignal("BTC", T0 - 1, WINDOW_CLOSE, 0);
    }

    function test_RequestSignal_WindowCloseBeforeOpen_Reverts() public {
        vm.expectRevert(PredictAgent.PredictAgent__WindowNotOpen.selector);
        vm.prank(buyer);
        agent.requestSignal("BTC", WINDOW_OPEN, WINDOW_OPEN - 1, 0);
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  NEW: requestSignal with buyer-chosen buyerRevealOffset
    // ─────────────────────────────────────────────────────────────────────────

    /// Buyer passes a valid custom offset (7200 = 2h); req.buyerRevealDeadline must match.
    function test_RequestSignal_BuyerRevealOffset_WithinBounds() public {
        uint256 customOffset = 7200; // 2 hours — within [3600, 172800]

        vm.prank(buyer);
        uint256 requestId = agent.requestSignal("ETH", WINDOW_OPEN, WINDOW_CLOSE, customOffset);

        PredictAgent.SignalRequest memory req = agent.getRequest(requestId);
        assertEq(req.buyerRevealDeadline, customOffset, "buyerRevealDeadline should equal customOffset");
    }

    /// Buyer passes an offset below minRevealOffset (100 < 3600) → RevealOffsetOutOfBounds.
    function test_RequestSignal_BuyerRevealOffset_TooLow() public {
        uint256 tooLow = 100; // below minRevealOffset=3600

        vm.expectRevert(
            abi.encodeWithSelector(
                PredictAgent.PredictAgent__RevealOffsetOutOfBounds.selector,
                tooLow,
                MIN_REVEAL_OFFSET,
                MAX_REVEAL_OFFSET
            )
        );
        vm.prank(buyer);
        agent.requestSignal("ETH", WINDOW_OPEN, WINDOW_CLOSE, tooLow);
    }

    /// Buyer passes an offset above maxRevealOffset (999999 > 172800) → RevealOffsetOutOfBounds.
    function test_RequestSignal_BuyerRevealOffset_TooHigh() public {
        uint256 tooHigh = 999_999; // above maxRevealOffset=172800

        vm.expectRevert(
            abi.encodeWithSelector(
                PredictAgent.PredictAgent__RevealOffsetOutOfBounds.selector,
                tooHigh,
                MIN_REVEAL_OFFSET,
                MAX_REVEAL_OFFSET
            )
        );
        vm.prank(buyer);
        agent.requestSignal("ETH", WINDOW_OPEN, WINDOW_CLOSE, tooHigh);
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  NEW: setRevealOffsetBounds
    // ─────────────────────────────────────────────────────────────────────────

    /// Owner updates bounds; state reflects new values and RevealOffsetBoundsUpdated is emitted.
    function test_SetRevealOffsetBounds_UpdatesAndEmits() public {
        uint256 newMin = 7200;
        uint256 newMax = 86400;

        vm.expectEmit(false, false, false, true, address(agent));
        emit PredictAgent.RevealOffsetBoundsUpdated(newMin, newMax);

        vm.prank(owner);
        agent.setRevealOffsetBounds(newMin, newMax);

        assertEq(agent.minRevealOffset(), newMin, "minRevealOffset not updated");
        assertEq(agent.maxRevealOffset(), newMax, "maxRevealOffset not updated");
    }

    /// Non-owner calling setRevealOffsetBounds reverts (OwnableUnauthorizedAccount).
    function test_SetRevealOffsetBounds_NonOwner_Reverts() public {
        vm.expectRevert(); // OwnableUnauthorizedAccount
        vm.prank(stranger);
        agent.setRevealOffsetBounds(7200, 86400);
    }

    /// Owner sets newMin=0 → require("invalid bounds") revert.
    function test_SetRevealOffsetBounds_InvalidBounds_Reverts() public {
        vm.expectRevert(bytes("invalid bounds"));
        vm.prank(owner);
        agent.setRevealOffsetBounds(0, 86400);
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  NEW: buyer-chosen buyerRevealOffset (aliased entry-point tests)
    // ─────────────────────────────────────────────────────────────────────────

    /// Pass offset=7200; req.buyerRevealDeadline must equal 7200.
    function test_BuyerRevealOffset_Custom_SetsDeadline() public {
        uint256 customOffset = 7200; // 2 hours — within [3600, 172800]

        vm.prank(buyer);
        uint256 requestId = agent.requestSignal("BTC", WINDOW_OPEN, WINDOW_CLOSE, customOffset);

        PredictAgent.SignalRequest memory req = agent.getRequest(requestId);
        assertEq(req.buyerRevealDeadline, customOffset, "buyerRevealDeadline should equal 7200");
    }

    /// Pass offset=100 (below minRevealOffset 3600) → RevealOffsetOutOfBounds.
    function test_BuyerRevealOffset_TooLow_Reverts() public {
        uint256 tooLow = 100;

        vm.expectRevert(
            abi.encodeWithSelector(
                PredictAgent.PredictAgent__RevealOffsetOutOfBounds.selector,
                tooLow,
                MIN_REVEAL_OFFSET,
                MAX_REVEAL_OFFSET
            )
        );
        vm.prank(buyer);
        agent.requestSignal("BTC", WINDOW_OPEN, WINDOW_CLOSE, tooLow);
    }

    /// Pass offset=999999 (above maxRevealOffset 172800) → RevealOffsetOutOfBounds.
    function test_BuyerRevealOffset_TooHigh_Reverts() public {
        uint256 tooHigh = 999_999;

        vm.expectRevert(
            abi.encodeWithSelector(
                PredictAgent.PredictAgent__RevealOffsetOutOfBounds.selector,
                tooHigh,
                MIN_REVEAL_OFFSET,
                MAX_REVEAL_OFFSET
            )
        );
        vm.prank(buyer);
        agent.requestSignal("BTC", WINDOW_OPEN, WINDOW_CLOSE, tooHigh);
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Additional: commitSignal happy path
    // ─────────────────────────────────────────────────────────────────────────
    function test_CommitSignal_HappyPath_EmitsEvent() public {
        uint256 requestId = _doRequest();
        bytes32 h = _makeCommitHash(requestId);

        vm.expectEmit(true, false, false, true, address(agent));
        emit PredictAgent.SignalCommitted(requestId, h);

        vm.prank(sellerAcc);
        agent.commitSignal(requestId, h);

        PredictAgent.SignalRequest memory req = agent.getRequest(requestId);
        assertEq(req.commitHash, h, "commitHash mismatch");
        assertEq(uint8(req.status), uint8(PredictAgent.RequestStatus.COMMITTED), "not COMMITTED");
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Additional: revealSignal happy path
    // ─────────────────────────────────────────────────────────────────────────
    function test_RevealSignal_HappyPath_EmitsEvent() public {
        uint256 requestId = _doRequestAndCommit();

        vm.warp(WINDOW_CLOSE + 1);

        vm.expectEmit(true, false, false, true, address(agent));
        emit PredictAgent.SignalRevealed(
            requestId, DIRECTION, TARGET_PRICE, CONFIDENCE, SIG_TIMESTAMP, NONCE
        );

        vm.prank(sellerAcc);
        agent.revealSignal(requestId, DIRECTION, TARGET_PRICE, CONFIDENCE, SIG_TIMESTAMP, NONCE);

        PredictAgent.SignalRequest memory req = agent.getRequest(requestId);
        assertEq(uint8(req.status), uint8(PredictAgent.RequestStatus.REVEALED), "not REVEALED");
        assertEq(req.revealedDirection,         DIRECTION,    "direction mismatch");
        assertEq(req.revealedTargetPrice,       TARGET_PRICE, "target price mismatch");
        assertEq(req.revealedConfidenceBandBps, CONFIDENCE,   "confidence mismatch");
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Additional: setFee / setSeller owner gates
    // ─────────────────────────────────────────────────────────────────────────
    function test_SetFee_OnlyOwner() public {
        vm.expectEmit(false, false, false, true, address(agent));
        emit PredictAgent.FeeUpdated(FEE, 20e6);

        vm.prank(owner);
        agent.setFee(20e6);
        assertEq(agent.signalFeeUsdc(), 20e6, "fee not updated");
    }

    function test_SetFee_ZeroReverts() public {
        vm.expectRevert(PredictAgent.PredictAgent__InvalidFee.selector);
        vm.prank(owner);
        agent.setFee(0);
    }

    function test_SetSeller_OnlyOwner() public {
        address newSeller = makeAddr("newSeller");
        vm.prank(owner);
        agent.setSeller(newSeller);
        assertEq(agent.seller(), newSeller, "seller not updated");
    }

    function test_SetSeller_ZeroAddressReverts() public {
        vm.expectRevert(PredictAgent.PredictAgent__InvalidAddress.selector);
        vm.prank(owner);
        agent.setSeller(address(0));
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  NEW: setVerifier emits VerifierUpdated
    // ─────────────────────────────────────────────────────────────────────────

    /// Happy path: setVerifier stores the new verifier and emits VerifierUpdated.
    function test_SetVerifier_EmitsVerifierUpdated() public {
        uint256 requestId = _doRequest(); // request exists

        // First set: oldVerifier is address(0).
        vm.expectEmit(true, true, true, false, address(agent));
        emit PredictAgent.VerifierUpdated(requestId, address(0), verifier);

        vm.prank(owner);
        agent.setVerifier(requestId, verifier);

        PredictAgent.SignalRequest memory req = agent.getRequest(requestId);
        assertEq(req.verifier, verifier, "verifier not stored");
    }

    /// setVerifier can update the verifier a second time; both indexed args match.
    function test_SetVerifier_UpdateExisting_EmitsVerifierUpdated() public {
        uint256 requestId = _doRequest();
        address newVerifier = makeAddr("newVerifier");

        vm.prank(owner);
        agent.setVerifier(requestId, verifier); // first set

        // Second set: oldVerifier is now `verifier`.
        vm.expectEmit(true, true, true, false, address(agent));
        emit PredictAgent.VerifierUpdated(requestId, verifier, newVerifier);

        vm.prank(owner);
        agent.setVerifier(requestId, newVerifier);

        PredictAgent.SignalRequest memory req = agent.getRequest(requestId);
        assertEq(req.verifier, newVerifier, "verifier not updated to new value");
    }

    /// setVerifier with zero address reverts.
    function test_SetVerifier_ZeroAddress_Reverts() public {
        uint256 requestId = _doRequest();

        vm.expectRevert(PredictAgent.PredictAgent__InvalidAddress.selector);
        vm.prank(owner);
        agent.setVerifier(requestId, address(0));
    }

    /// Non-owner cannot call setVerifier.
    function test_SetVerifier_NonOwner_Reverts() public {
        uint256 requestId = _doRequest();

        vm.expectRevert();  // OwnableUnauthorizedAccount
        vm.prank(stranger);
        agent.setVerifier(requestId, verifier);
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  NEW: setOutcomeDeadlineOffset — owner function with event
    // ─────────────────────────────────────────────────────────────────────────
    function test_SetOutcomeDeadlineOffset_UpdatesAndEmits() public {
        uint256 newOffset = 172800; // 2 days

        vm.expectEmit(false, false, false, true, address(agent));
        emit PredictAgent.OutcomeDeadlineOffsetUpdated(OUTCOME_OFFSET, newOffset);

        vm.prank(owner);
        agent.setOutcomeDeadlineOffset(newOffset);

        assertEq(agent.outcomeDeadlineOffset(), newOffset, "offset not updated");
    }

    function test_SetOutcomeDeadlineOffset_NonOwner_Reverts() public {
        vm.expectRevert(); // OwnableUnauthorizedAccount
        vm.prank(stranger);
        agent.setOutcomeDeadlineOffset(999);
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Fuzz: fee is always moved correctly across request/settle cycle
    // ─────────────────────────────────────────────────────────────────────────
    function testFuzz_SettleCyclePreservesUSDC(uint256 feeAmount) public {
        // Bound fee to a sane range: 1 unit → 100,000 USDC
        feeAmount = bound(feeAmount, 1, 100_000e6);

        // Reset agent with fuzzed fee.
        vm.prank(owner);
        agent.setFee(feeAmount);

        // Top up buyer.
        usdc.mint(buyer, feeAmount); // ensures buyer has enough

        uint256 buyerBefore  = usdc.balanceOf(buyer);
        uint256 sellerBefore = usdc.balanceOf(sellerAcc);

        // Full cycle.
        vm.prank(buyer);
        uint256 requestId = agent.requestSignal("ETH", WINDOW_OPEN, WINDOW_CLOSE, 0);

        // Verify feePaid was snapshotted correctly at request time.
        PredictAgent.SignalRequest memory reqSnap = agent.getRequest(requestId);
        assertEq(reqSnap.feePaid, feeAmount, "fuzz: feePaid snapshot mismatch");

        bytes32 h = keccak256(
            abi.encodePacked(requestId, DIRECTION, TARGET_PRICE, CONFIDENCE, SIG_TIMESTAMP, NONCE)
        );
        vm.prank(sellerAcc);
        agent.commitSignal(requestId, h);

        vm.warp(WINDOW_CLOSE + 1);
        vm.prank(sellerAcc);
        agent.revealSignal(requestId, DIRECTION, TARGET_PRICE, CONFIDENCE, SIG_TIMESTAMP, NONCE);

        vm.prank(owner);
        agent.recordOutcome(requestId, true);

        // Seller gained exactly req.feePaid, buyer spent exactly that much.
        assertEq(usdc.balanceOf(sellerAcc), sellerBefore + feeAmount, "fuzz: seller balance");
        assertEq(usdc.balanceOf(buyer),     buyerBefore  - feeAmount, "fuzz: buyer balance");
    }
}
