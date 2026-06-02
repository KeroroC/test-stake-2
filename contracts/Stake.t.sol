// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {Stake} from "./Stake.sol";
import {MyToken} from "./MyToken.sol";

contract StakeTest is Test {
    uint256 constant TOTAL_SUPPLY = 1_000_000 ether;
    uint256 constant USER_INITIAL_BALANCE = 1_000 ether;
    uint256 constant MIN_STAKE = 10 ether;
    uint256 constant STAKE_AMOUNT = 100 ether;
    uint256 constant REWARD_RATE = 1 ether;

    address constant ALICE = address(0xA11CE);
    address constant BOB = address(0xB0B);

    Stake stake;
    MyToken stakeToken;
    MyToken rewardToken;

    event Staked(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event RewardClaimed(address indexed user, uint256 amount);
    event RewardRateUpdated(uint256 oldRate, uint256 newRate);
    event MinStakeAmountUpdated(uint256 oldAmount, uint256 newAmount);

    function setUp() public {
        _deployStake(true);
    }

    function _deployStake(bool fundRewards) internal {
        // 每个测试都重新部署一套合约，避免测试之间共享状态。
        stakeToken = new MyToken("Stake Token", "STK", TOTAL_SUPPLY);
        rewardToken = new MyToken("Reward Token", "RWD", TOTAL_SUPPLY);
        stake = new Stake(address(stakeToken), address(rewardToken), MIN_STAKE);

        // 给测试用户分配质押币，并让他们提前授权给 Stake 合约。
        stakeToken.transfer(ALICE, USER_INITIAL_BALANCE);
        stakeToken.transfer(BOB, USER_INITIAL_BALANCE);

        vm.prank(ALICE);
        stakeToken.approve(address(stake), type(uint256).max);

        vm.prank(BOB);
        stakeToken.approve(address(stake), type(uint256).max);

        if (fundRewards) {
            // 默认场景下预先充值奖励池，领取奖励时不会因为余额不足失败。
            rewardToken.transfer(address(stake), TOTAL_SUPPLY);
        }
    }

    function test_Deployment() public view {
        assertEq(address(stake.stakeToken()), address(stakeToken));
        assertEq(address(stake.rewardToken()), address(rewardToken));
        assertEq(stake.minStakeAmount(), MIN_STAKE);
        assertEq(stake.totalStake(), 0);
        assertEq(stake.rewardRate(), 0);
        assertGt(stake.lastUpdateTime(), 0);
    }

    function test_RevertIfTokenAddressIsZero() public {
        vm.expectRevert(Stake.Stake__InvalidAddress.selector);
        new Stake(address(0), address(rewardToken), MIN_STAKE);
    }

    function test_RevertIfStakeTokenAndRewardTokenAreSame() public {
        MyToken token = new MyToken("Token", "TOK", TOTAL_SUPPLY);

        vm.expectRevert(Stake.Stake__InvalidAddress.selector);
        new Stake(address(token), address(token), MIN_STAKE);
    }

    function test_StakeUpdatesAccounting() public {
        vm.prank(ALICE);
        vm.expectEmit(true, false, false, true);
        emit Staked(ALICE, STAKE_AMOUNT);
        stake.stake(STAKE_AMOUNT);

        // 同时检查合约内部账本和质押池真实持有的 ERC20 余额。
        assertEq(stake.totalStake(), STAKE_AMOUNT);
        assertEq(stake.balances(ALICE), STAKE_AMOUNT);
        assertEq(stakeToken.balanceOf(address(stake)), STAKE_AMOUNT);
        assertEq(stakeToken.balanceOf(ALICE), USER_INITIAL_BALANCE - STAKE_AMOUNT);
    }

    function test_TracksMultipleStakers() public {
        uint256 bobAmount = 30 ether;

        vm.prank(ALICE);
        stake.stake(STAKE_AMOUNT);

        vm.prank(BOB);
        stake.stake(bobAmount);

        assertEq(stake.balances(ALICE), STAKE_AMOUNT);
        assertEq(stake.balances(BOB), bobAmount);
        assertEq(stake.totalStake(), STAKE_AMOUNT + bobAmount);
    }

    function test_RevertIfStakeAmountIsZero() public {
        vm.prank(ALICE);
        vm.expectRevert(abi.encodeWithSelector(Stake.Stake__InsufficientStake.selector, 0, MIN_STAKE));
        stake.stake(0);
    }

    function test_RevertIfStakeAmountIsLessThanMinimum() public {
        uint256 amount = MIN_STAKE - 1;

        vm.prank(ALICE);
        vm.expectRevert(abi.encodeWithSelector(Stake.Stake__InsufficientStake.selector, amount, MIN_STAKE));
        stake.stake(amount);
    }

    function test_RevertIfStakeWhenPaused() public {
        stake.pause();

        vm.prank(ALICE);
        vm.expectRevert();
        stake.stake(STAKE_AMOUNT);
    }

    function test_RevertIfWithdrawAmountIsZero() public {
        vm.prank(ALICE);
        vm.expectRevert(Stake.Stake__WithdrawAmountMustGreaterThanZero.selector);
        stake.withdraw(0);
    }

    function test_RevertIfWithdrawAmountExceedsBalance() public {
        vm.prank(ALICE);
        vm.expectRevert(abi.encodeWithSelector(Stake.Stake__InsufficientBalance.selector, 1, 0));
        stake.withdraw(1);
    }

    function test_WithdrawUpdatesAccounting() public {
        uint256 withdrawAmount = 40 ether;

        vm.prank(ALICE);
        stake.stake(STAKE_AMOUNT);

        vm.prank(ALICE);
        vm.expectEmit(true, false, false, true);
        emit Withdrawn(ALICE, withdrawAmount);
        stake.withdraw(withdrawAmount);

        // 提现后，账本减少，用户拿回对应数量的质押币。
        assertEq(stake.balances(ALICE), STAKE_AMOUNT - withdrawAmount);
        assertEq(stake.totalStake(), STAKE_AMOUNT - withdrawAmount);
        assertEq(stakeToken.balanceOf(ALICE), USER_INITIAL_BALANCE - STAKE_AMOUNT + withdrawAmount);
    }

    function test_CanWithdrawWhilePaused() public {
        vm.prank(ALICE);
        stake.stake(STAKE_AMOUNT);

        stake.pause();

        vm.prank(ALICE);
        stake.withdraw(STAKE_AMOUNT);

        assertEq(stake.balances(ALICE), 0);
        assertEq(stake.totalStake(), 0);
    }

    function test_CalRewardPerTokenReturnsStoredValueWhenNothingIsStaked() public view {
        assertEq(stake.calRewardPerToken(), 0);
    }

    function test_EarnedRewardsOverTime() public {
        stake.setRewardRate(REWARD_RATE);

        vm.prank(ALICE);
        stake.stake(STAKE_AMOUNT);

        // vm.warp 直接修改当前区块时间，模拟质押后经过 10 秒。
        vm.warp(block.timestamp + 10);

        assertEq(stake.earned(ALICE), 10 ether);
    }

    function test_SplitsRewardsProportionallyBetweenStakers() public {
        vm.prank(ALICE);
        stake.stake(100 ether);

        vm.prank(BOB);
        stake.stake(100 ether);

        // 两个用户仓位相同后再开启奖励，避免质押先后顺序带来额外奖励。
        stake.setRewardRate(REWARD_RATE);
        vm.warp(block.timestamp + 10);

        assertEq(stake.earned(ALICE), 5 ether);
        assertEq(stake.earned(BOB), 5 ether);
    }

    function test_ClaimReward() public {
        stake.setRewardRate(REWARD_RATE);

        vm.prank(ALICE);
        stake.stake(STAKE_AMOUNT);

        // 把领取交易放到 10 秒后执行，因此用户应领取 10 个奖励代币。
        vm.warp(block.timestamp + 10);

        vm.prank(ALICE);
        vm.expectEmit(true, false, false, true);
        emit RewardClaimed(ALICE, 10 ether);
        stake.claimReward();

        assertEq(rewardToken.balanceOf(ALICE), 10 ether);
        assertEq(stake.rewards(ALICE), 0);
    }

    function test_RevertIfClaimRewardIsZero() public {
        vm.prank(ALICE);
        vm.expectRevert(Stake.Stake__RewardIsZero.selector);
        stake.claimReward();
    }

    function test_RevertIfRewardsAreOwedButPoolIsEmpty() public {
        _deployStake(false);
        stake.setRewardRate(REWARD_RATE);

        vm.prank(ALICE);
        stake.stake(STAKE_AMOUNT);

        vm.warp(block.timestamp + 10);

        vm.prank(ALICE);
        vm.expectRevert(abi.encodeWithSelector(Stake.Stake__InsufficientRewardBalance.selector, 10 ether, 0));
        stake.claimReward();
    }

    function test_AllowsPartialRewardClaim() public {
        _deployStake(false);

        // 只充值 3 个奖励代币，但用户会累积 10 个奖励，用来测试部分领取。
        rewardToken.transfer(address(stake), 3 ether);
        stake.setRewardRate(REWARD_RATE);

        vm.prank(ALICE);
        stake.stake(STAKE_AMOUNT);

        vm.warp(block.timestamp + 10);

        vm.prank(ALICE);
        vm.expectEmit(true, false, false, true);
        emit RewardClaimed(ALICE, 3 ether);
        stake.claimReward();

        assertEq(rewardToken.balanceOf(ALICE), 3 ether);
        assertEq(stake.rewards(ALICE), 7 ether);
    }

    function test_OwnerCanUpdateRewardRate() public {
        vm.expectEmit(false, false, false, true);
        emit RewardRateUpdated(0, REWARD_RATE);
        stake.setRewardRate(REWARD_RATE);

        assertEq(stake.rewardRate(), REWARD_RATE);
    }

    function test_NonOwnerCannotUpdateRewardRate() public {
        vm.prank(ALICE);
        vm.expectRevert();
        stake.setRewardRate(REWARD_RATE);
    }

    function test_OwnerCanUpdateMinStake() public {
        uint256 newMinStake = 20 ether;

        vm.expectEmit(false, false, false, true);
        emit MinStakeAmountUpdated(MIN_STAKE, newMinStake);
        stake.setMinStake(newMinStake);

        assertEq(stake.minStakeAmount(), newMinStake);
    }

    function test_OwnerCanPauseAndUnpause() public {
        stake.pause();
        assertTrue(stake.paused());

        stake.unpause();
        assertFalse(stake.paused());
    }

    function test_NonOwnerCannotPause() public {
        vm.prank(ALICE);
        vm.expectRevert();
        stake.pause();
    }
}
