// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

contract Stake is Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    IERC20 public stakeToken;
    IERC20 public rewardToken;
    bool public immutable isEthStake;

    // 总质押量
    uint256 public totalStake;
    uint256 public minStakeAmount;
    // 每秒多少代币奖励   e.g. 1 ether
    uint256 public rewardRate;
    // 每单位质押累计奖励
    uint256 public rewardPerTokenStored;
    uint256 public lastUpdateTime;

    // 每个用户质押了多少
    mapping(address => uint256) public balances;
    // 每个用户尚未提取的奖励
    mapping(address => uint256) public rewards;
    // 每个用户的检查点
    mapping(address => uint256) public userRewardPerTokenPaid;

    constructor(address _stakeToken, address _rewardToken, uint256 _minStakeAmount, uint256 _rewardRate)
        Ownable(msg.sender)
    {
        require(
            _rewardToken != address(0) && (_stakeToken == address(0) || _stakeToken != _rewardToken),
            Stake__InvalidAddress()
        );

        stakeToken = IERC20(_stakeToken);
        rewardToken = IERC20(_rewardToken);
        isEthStake = _stakeToken == address(0);
        minStakeAmount = _minStakeAmount;
        rewardRate = _rewardRate;
        lastUpdateTime = block.timestamp;
    }

    error Stake__InvalidAddress();
    error Stake__InsufficientStake(uint256 amount, uint256 minAmount);
    error Stake__InsufficientBalance(uint256 amount, uint256 balance);
    error Stake__InsufficientRewardBalance(uint256 amount, uint256 balance);
    error Stake__WithdrawAmountMustGreaterThanZero();
    error Stake__RewardIsZero();
    error Stake__EthTransferFailed();
    error Stake__InvalidEthAmount(uint256 amount, uint256 value);

    event Staked(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event RewardClaimed(address indexed user, uint256 amount);
    event RewardRateUpdated(uint256 oldRate, uint256 newRate);
    event MinStakeAmountUpdated(uint256 oldAmount, uint256 newAmount);

    // 计算截止到目前每单位token的奖励量
    function calRewardPerToken() public view returns (uint256) {
        if (totalStake == 0) {
            return rewardPerTokenStored;
        }
        return rewardPerTokenStored + (rewardRate * (block.timestamp - lastUpdateTime) * 1e18 / totalStake);
    }

    // 更新用户可提取的奖励
    function _updateRewards(address user) internal {
        require(user != address(0), Stake__InvalidAddress());

        rewardPerTokenStored = calRewardPerToken();
        lastUpdateTime = block.timestamp;
        rewards[user] = rewards[user] + (balances[user] * (rewardPerTokenStored - userRewardPerTokenPaid[user]) / 1e18);
        userRewardPerTokenPaid[user] = rewardPerTokenStored;
    }

    // 质押
    function stake(uint256 amount) external payable nonReentrant whenNotPaused {
        if (isEthStake) {
            require(msg.value == amount, Stake__InvalidEthAmount(amount, msg.value));
        } else {
            require(msg.value == 0, Stake__InvalidEthAmount(amount, msg.value));
        }
        require(amount > 0 && amount >= minStakeAmount, Stake__InsufficientStake(amount, minStakeAmount));

        _updateRewards(msg.sender);

        totalStake += amount;
        balances[msg.sender] += amount;

        if (!isEthStake) {
            stakeToken.safeTransferFrom(msg.sender, address(this), amount);
        }

        emit Staked(msg.sender, amount);
    }

    // 解质押
    function withdraw(uint256 amount) external nonReentrant {
        require(amount > 0, Stake__WithdrawAmountMustGreaterThanZero());
        require(amount <= balances[msg.sender], Stake__InsufficientBalance(amount, balances[msg.sender]));

        _updateRewards(msg.sender);
        totalStake -= amount;
        balances[msg.sender] -= amount;

        if (isEthStake) {
            (bool success,) = msg.sender.call{value: amount}("");
            require(success, Stake__EthTransferFailed());
        } else {
            stakeToken.safeTransfer(msg.sender, amount);
        }

        emit Withdrawn(msg.sender, amount);
    }

    // 查询当前收益
    function earned(address user) public view returns (uint256) {
        return rewards[user] + (calRewardPerToken() - userRewardPerTokenPaid[user]) * balances[user] / 1e18;
    }

    // 领取奖励
    function claimReward() external nonReentrant {
        _updateRewards(msg.sender);

        uint256 reward = rewards[msg.sender];

        if (reward > 0) {
            // 合约没有足够的奖励代币
            uint256 rewardBalance = rewardToken.balanceOf(address(this));
            if (rewardBalance == 0) {
                revert Stake__InsufficientRewardBalance(reward, rewardBalance);
            } else if (rewardBalance < reward) {
                reward = rewardBalance;
            }

            rewards[msg.sender] -= reward;

            rewardToken.safeTransfer(msg.sender, reward);

            emit RewardClaimed(msg.sender, reward);
        } else {
            revert Stake__RewardIsZero();
        }
    }

    function setRewardRate(uint256 newRate) external onlyOwner {
        _updateRewards(msg.sender);

        uint256 oldRate = rewardRate;
        rewardRate = newRate;

        emit RewardRateUpdated(oldRate, newRate);
    }

    function setMinStake(uint256 newAmount) external onlyOwner {
        uint256 oldAmount = minStakeAmount;
        minStakeAmount = newAmount;

        emit MinStakeAmountUpdated(oldAmount, newAmount);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}
