import { expect } from "chai";
import { network } from "hardhat";

const { ethers, networkHelpers } = await network.create();

describe("Stake", function () {
  const TOTAL_SUPPLY = ethers.parseEther("1000000");
  const USER_INITIAL_BALANCE = ethers.parseEther("1000");
  const MIN_STAKE = ethers.parseEther("10");
  const STAKE_AMOUNT = ethers.parseEther("100");
  const REWARD_RATE = ethers.parseEther("1");

  // 公共初始化：部署合约、给测试用户发币并授权质押，
  // 同时预先给质押合约充值奖励池；loadFixture 会为每个测试恢复快照。
  async function deployStakeFixture() {
    const [owner, alice, bob] = await ethers.getSigners();

    const stakeToken = await ethers.deployContract("MyToken", [
      "Stake Token",
      "STK",
      TOTAL_SUPPLY,
    ]);
    const rewardToken = await ethers.deployContract("MyToken", [
      "Reward Token",
      "RWD",
      TOTAL_SUPPLY,
    ]);
    const stake = await ethers.deployContract("Stake", [
      await stakeToken.getAddress(),
      await rewardToken.getAddress(),
      MIN_STAKE,
      0n,
    ]);

    await stakeToken.transfer(alice.address, USER_INITIAL_BALANCE);
    await stakeToken.transfer(bob.address, USER_INITIAL_BALANCE);
    await networkHelpers.setBalance(alice.address, USER_INITIAL_BALANCE);
    await networkHelpers.setBalance(bob.address, USER_INITIAL_BALANCE);
    await stakeToken
      .connect(alice)
      .approve(await stake.getAddress(), ethers.MaxUint256);
    await stakeToken
      .connect(bob)
      .approve(await stake.getAddress(), ethers.MaxUint256);
    await rewardToken.transfer(await stake.getAddress(), TOTAL_SUPPLY);

    return { stake, stakeToken, rewardToken, owner, alice, bob };
  }

  async function deployEthStakeFixture() {
    const [owner, alice, bob] = await ethers.getSigners();

    const rewardToken = await ethers.deployContract("MyToken", [
      "Reward Token",
      "RWD",
      TOTAL_SUPPLY,
    ]);
    const stake = await ethers.deployContract("Stake", [
      ethers.ZeroAddress,
      await rewardToken.getAddress(),
      MIN_STAKE,
      0n,
    ]);

    await networkHelpers.setBalance(alice.address, USER_INITIAL_BALANCE);
    await networkHelpers.setBalance(bob.address, USER_INITIAL_BALANCE);
    await rewardToken.transfer(await stake.getAddress(), TOTAL_SUPPLY);

    return { stake, rewardToken, owner, alice, bob };
  }

  describe("Deployment", function () {
    it("sets tokens, min stake, and initial timestamp", async function () {
      const { stake, stakeToken, rewardToken } =
        await networkHelpers.loadFixture(deployStakeFixture);

      expect(await stake.stakeToken()).to.equal(await stakeToken.getAddress());
      expect(await stake.rewardToken()).to.equal(
        await rewardToken.getAddress()
      );
      expect(await stake.isEthStake()).to.equal(false);
      expect(await stake.minStakeAmount()).to.equal(MIN_STAKE);
      expect(await stake.totalStake()).to.equal(0n);
      expect(await stake.rewardRate()).to.equal(0n);
      expect(await stake.lastUpdateTime()).to.be.greaterThan(0n);
    });

    it("sets ETH staking mode when stake token address is zero", async function () {
      const { stake, rewardToken } = await networkHelpers.loadFixture(
        deployEthStakeFixture
      );

      expect(await stake.stakeToken()).to.equal(ethers.ZeroAddress);
      expect(await stake.rewardToken()).to.equal(
        await rewardToken.getAddress()
      );
      expect(await stake.isEthStake()).to.equal(true);
      expect(await stake.minStakeAmount()).to.equal(MIN_STAKE);
    });

    it("sets the initial reward rate", async function () {
      const { stakeToken, rewardToken } = await networkHelpers.loadFixture(
        deployStakeFixture
      );

      const stake = await ethers.deployContract("Stake", [
        await stakeToken.getAddress(),
        await rewardToken.getAddress(),
        MIN_STAKE,
        REWARD_RATE,
      ]);

      expect(await stake.rewardRate()).to.equal(REWARD_RATE);
    });

    it("reverts if reward token address is zero", async function () {
      const { stakeToken } = await networkHelpers.loadFixture(
        deployStakeFixture
      );
      const factory = await ethers.getContractFactory("Stake");

      await expect(
        factory.deploy(
          await stakeToken.getAddress(),
          ethers.ZeroAddress,
          MIN_STAKE,
          0n
        )
      ).to.be.revertedWithCustomError(factory, "Stake__InvalidAddress");
    });

    it("reverts if stake token and reward token are the same", async function () {
      const token = await ethers.deployContract("MyToken", [
        "MyToken",
        "MTK",
        TOTAL_SUPPLY,
      ]);
      const factory = await ethers.getContractFactory("Stake");

      await expect(
        factory.deploy(
          await token.getAddress(),
          await token.getAddress(),
          MIN_STAKE,
          0n
        )
      ).to.be.revertedWithCustomError(factory, "Stake__InvalidAddress");
    });
  });

  describe("Staking", function () {
    it("stakes tokens and updates user balance and total stake", async function () {
      const { stake, stakeToken, alice } = await networkHelpers.loadFixture(
        deployStakeFixture
      );

      await expect(stake.connect(alice).stake(STAKE_AMOUNT))
        .to.emit(stake, "Staked")
        .withArgs(alice.address, STAKE_AMOUNT);

      // 同时检查合约内部账本和质押池真实持有的 ERC20 余额。
      expect(await stake.totalStake()).to.equal(STAKE_AMOUNT);
      expect(await stake.balances(alice.address)).to.equal(STAKE_AMOUNT);
      expect(await stakeToken.balanceOf(await stake.getAddress())).to.equal(
        STAKE_AMOUNT
      );
      expect(await stakeToken.balanceOf(alice.address)).to.equal(
        USER_INITIAL_BALANCE - STAKE_AMOUNT
      );
    });

    it("stakes ETH and updates user balance and total stake", async function () {
      const { stake, alice } = await networkHelpers.loadFixture(
        deployEthStakeFixture
      );

      await expect(
        stake.connect(alice).stake(STAKE_AMOUNT, { value: STAKE_AMOUNT })
      )
        .to.emit(stake, "Staked")
        .withArgs(alice.address, STAKE_AMOUNT);

      expect(await stake.totalStake()).to.equal(STAKE_AMOUNT);
      expect(await stake.balances(alice.address)).to.equal(STAKE_AMOUNT);
      expect(
        await ethers.provider.getBalance(await stake.getAddress())
      ).to.equal(STAKE_AMOUNT);
    });

    it("tracks multiple stakers independently", async function () {
      const { stake, alice, bob } = await networkHelpers.loadFixture(
        deployStakeFixture
      );
      const bobAmount = ethers.parseEther("30");

      await stake.connect(alice).stake(STAKE_AMOUNT);
      await stake.connect(bob).stake(bobAmount);

      expect(await stake.balances(alice.address)).to.equal(STAKE_AMOUNT);
      expect(await stake.balances(bob.address)).to.equal(bobAmount);
      expect(await stake.totalStake()).to.equal(STAKE_AMOUNT + bobAmount);
    });

    it("reverts if ETH stake value does not match amount", async function () {
      const { stake, alice } = await networkHelpers.loadFixture(
        deployEthStakeFixture
      );

      await expect(stake.connect(alice).stake(STAKE_AMOUNT))
        .to.be.revertedWithCustomError(stake, "Stake__InvalidEthAmount")
        .withArgs(STAKE_AMOUNT, 0n);
    });

    it("reverts if ETH value is sent in token staking mode", async function () {
      const { stake, alice, bob } = await networkHelpers.loadFixture(
        deployStakeFixture
      );
      const bobAmount = ethers.parseEther("30");

      await stake.connect(alice).stake(STAKE_AMOUNT);

      await expect(stake.connect(bob).stake(bobAmount, { value: bobAmount }))
        .to.be.revertedWithCustomError(stake, "Stake__InvalidEthAmount")
        .withArgs(bobAmount, bobAmount);
    });

    it("reverts if amount equals zero", async function () {
      const { stake, alice } = await networkHelpers.loadFixture(
        deployStakeFixture
      );

      await expect(stake.connect(alice).stake(0n))
        .to.be.revertedWithCustomError(stake, "Stake__InsufficientStake")
        .withArgs(0n, MIN_STAKE);
    });

    it("reverts if amount is less than minStakeAmount", async function () {
      const { stake, alice } = await networkHelpers.loadFixture(
        deployStakeFixture
      );

      await expect(stake.connect(alice).stake(MIN_STAKE - 1n))
        .to.be.revertedWithCustomError(stake, "Stake__InsufficientStake")
        .withArgs(MIN_STAKE - 1n, MIN_STAKE);
    });

    it("reverts if ETH stake amount is less than minStakeAmount", async function () {
      const { stake, alice } = await networkHelpers.loadFixture(
        deployEthStakeFixture
      );

      await expect(
        stake.connect(alice).stake(MIN_STAKE - 1n, {
          value: MIN_STAKE - 1n,
        })
      )
        .to.be.revertedWithCustomError(stake, "Stake__InsufficientStake")
        .withArgs(MIN_STAKE - 1n, MIN_STAKE);
    });

    it("reverts if the contract is paused", async function () {
      const { stake, owner, alice } = await networkHelpers.loadFixture(
        deployStakeFixture
      );

      await stake.connect(owner).pause();

      await expect(
        stake.connect(alice).stake(STAKE_AMOUNT)
      ).to.be.revertedWithCustomError(stake, "EnforcedPause");
    });

    it("reverts if ETH staking is paused", async function () {
      const { stake, owner, alice } = await networkHelpers.loadFixture(
        deployEthStakeFixture
      );

      await stake.connect(owner).pause();

      await expect(
        stake.connect(alice).stake(STAKE_AMOUNT, { value: STAKE_AMOUNT })
      ).to.be.revertedWithCustomError(stake, "EnforcedPause");
    });
  });

  describe("Withdrawals", function () {
    it("reverts if amount equals zero", async function () {
      const { stake, alice } = await networkHelpers.loadFixture(
        deployStakeFixture
      );

      await expect(
        stake.connect(alice).withdraw(0n)
      ).to.be.revertedWithCustomError(
        stake,
        "Stake__WithdrawAmountMustGreaterThanZero"
      );
    });

    it("reverts if amount exceeds the staked balance", async function () {
      const { stake, alice } = await networkHelpers.loadFixture(
        deployStakeFixture
      );

      await expect(stake.connect(alice).withdraw(1n))
        .to.be.revertedWithCustomError(stake, "Stake__InsufficientBalance")
        .withArgs(1n, 0n);
    });

    it("withdraws tokens and updates accounting", async function () {
      const { stake, stakeToken, alice } = await networkHelpers.loadFixture(
        deployStakeFixture
      );
      const withdrawAmount = ethers.parseEther("40");

      await stake.connect(alice).stake(STAKE_AMOUNT);

      await expect(stake.connect(alice).withdraw(withdrawAmount))
        .to.emit(stake, "Withdrawn")
        .withArgs(alice.address, withdrawAmount);

      // 提现后，质押池账本应减少，用户应拿回对应数量的质押代币。
      expect(await stake.balances(alice.address)).to.equal(
        STAKE_AMOUNT - withdrawAmount
      );
      expect(await stake.totalStake()).to.equal(STAKE_AMOUNT - withdrawAmount);
      expect(await stakeToken.balanceOf(alice.address)).to.equal(
        USER_INITIAL_BALANCE - STAKE_AMOUNT + withdrawAmount
      );
    });

    it("withdraws ETH and updates accounting", async function () {
      const { stake, alice } = await networkHelpers.loadFixture(
        deployEthStakeFixture
      );
      const withdrawAmount = ethers.parseEther("40");

      await stake.connect(alice).stake(STAKE_AMOUNT, { value: STAKE_AMOUNT });

      await expect(stake.connect(alice).withdraw(withdrawAmount))
        .to.emit(stake, "Withdrawn")
        .withArgs(alice.address, withdrawAmount);

      expect(await stake.balances(alice.address)).to.equal(
        STAKE_AMOUNT - withdrawAmount
      );
      expect(await stake.totalStake()).to.equal(STAKE_AMOUNT - withdrawAmount);
    });

    it("allows users to withdraw while paused", async function () {
      const { stake, alice } = await networkHelpers.loadFixture(
        deployStakeFixture
      );

      await stake.connect(alice).stake(STAKE_AMOUNT);
      await stake.pause();

      await expect(stake.connect(alice).withdraw(STAKE_AMOUNT))
        .to.emit(stake, "Withdrawn")
        .withArgs(alice.address, STAKE_AMOUNT);
    });

    it("allows users to withdraw ETH while paused", async function () {
      const { stake, alice } = await networkHelpers.loadFixture(
        deployEthStakeFixture
      );

      await stake.connect(alice).stake(STAKE_AMOUNT, { value: STAKE_AMOUNT });
      await stake.pause();

      await expect(stake.connect(alice).withdraw(STAKE_AMOUNT))
        .to.emit(stake, "Withdrawn")
        .withArgs(alice.address, STAKE_AMOUNT);
    });
  });

  describe("Rewards", function () {
    it("returns the stored rewardPerToken when nothing is staked", async function () {
      const { stake } = await networkHelpers.loadFixture(deployStakeFixture);

      expect(await stake.calRewardPerToken()).to.equal(0n);
    });

    it("calculates earned rewards over time", async function () {
      const { stake, alice } = await networkHelpers.loadFixture(
        deployStakeFixture
      );

      await stake.setRewardRate(REWARD_RATE);
      await stake.connect(alice).stake(STAKE_AMOUNT);
      // time.increase 会推进时间并挖出新区块，因此这里刚好累计 10 秒奖励。
      await networkHelpers.time.increase(10);

      expect(await stake.earned(alice.address)).to.equal(
        ethers.parseEther("10")
      );
    });

    it("splits rewards proportionally between stakers", async function () {
      const { stake, alice, bob } = await networkHelpers.loadFixture(
        deployStakeFixture
      );

      await stake.connect(alice).stake(ethers.parseEther("100"));
      await stake.connect(bob).stake(ethers.parseEther("100"));
      // 两个用户都有相同质押后再开启奖励，避免部署/质押交易区块造成时间偏差。
      await stake.setRewardRate(REWARD_RATE);
      await networkHelpers.time.increase(10);

      expect(await stake.earned(alice.address)).to.equal(
        ethers.parseEther("5")
      );
      expect(await stake.earned(bob.address)).to.equal(ethers.parseEther("5"));
    });

    it("calculates earned rewards over time for ETH staking", async function () {
      const { stake, alice } = await networkHelpers.loadFixture(
        deployEthStakeFixture
      );

      await stake.setRewardRate(REWARD_RATE);
      await stake.connect(alice).stake(STAKE_AMOUNT, { value: STAKE_AMOUNT });
      await networkHelpers.time.increase(10);

      expect(await stake.earned(alice.address)).to.equal(
        ethers.parseEther("10")
      );
    });

    it("claims rewards and clears the claimed amount", async function () {
      const { stake, rewardToken, alice } = await networkHelpers.loadFixture(
        deployStakeFixture
      );

      await stake.setRewardRate(REWARD_RATE);
      await stake.connect(alice).stake(STAKE_AMOUNT);

      // 指定下一笔交易的区块时间，让 claimReward 本身在 +10 秒时执行。
      const latest = await networkHelpers.time.latest();
      await networkHelpers.time.setNextBlockTimestamp(latest + 10);

      await expect(stake.connect(alice).claimReward())
        .to.emit(stake, "RewardClaimed")
        .withArgs(alice.address, ethers.parseEther("10"));

      expect(await rewardToken.balanceOf(alice.address)).to.equal(
        ethers.parseEther("10")
      );
      expect(await stake.rewards(alice.address)).to.equal(0n);
    });

    it("reverts when the user has no reward", async function () {
      const { stake, alice } = await networkHelpers.loadFixture(
        deployStakeFixture
      );

      await expect(
        stake.connect(alice).claimReward()
      ).to.be.revertedWithCustomError(stake, "Stake__RewardIsZero");
    });

    it("reverts when rewards are owed but the contract has no reward tokens", async function () {
      const [owner, alice] = await ethers.getSigners();
      const stakeToken = await ethers.deployContract("MyToken", [
        "Stake Token",
        "STK",
        TOTAL_SUPPLY,
      ]);
      const rewardToken = await ethers.deployContract("MyToken", [
        "Reward Token",
        "RWD",
        TOTAL_SUPPLY,
      ]);
      const stake = await ethers.deployContract("Stake", [
        await stakeToken.getAddress(),
        await rewardToken.getAddress(),
        MIN_STAKE,
        0n,
      ]);

      await stakeToken.transfer(alice.address, USER_INITIAL_BALANCE);
      await stakeToken
        .connect(alice)
        .approve(await stake.getAddress(), ethers.MaxUint256);

      await stake.setRewardRate(REWARD_RATE);
      await stake.connect(alice).stake(STAKE_AMOUNT);

      // 这里没有给合约充值奖励代币，所以用户有应得奖励但合约无法支付。
      const latest = await networkHelpers.time.latest();
      await networkHelpers.time.setNextBlockTimestamp(latest + 10);

      await expect(stake.connect(alice).claimReward())
        .to.be.revertedWithCustomError(
          stake,
          "Stake__InsufficientRewardBalance"
        )
        .withArgs(ethers.parseEther("10"), 0n);

      expect(await rewardToken.balanceOf(owner.address)).to.equal(TOTAL_SUPPLY);
    });

    it("allows a partial reward claim when the reward balance is insufficient", async function () {
      const [owner, alice] = await ethers.getSigners();
      const stakeToken = await ethers.deployContract("MyToken", [
        "Stake Token",
        "STK",
        TOTAL_SUPPLY,
      ]);
      const rewardToken = await ethers.deployContract("MyToken", [
        "Reward Token",
        "RWD",
        TOTAL_SUPPLY,
      ]);
      const stake = await ethers.deployContract("Stake", [
        await stakeToken.getAddress(),
        await rewardToken.getAddress(),
        MIN_STAKE,
        0n,
      ]);

      await stakeToken.transfer(alice.address, USER_INITIAL_BALANCE);
      await stakeToken
        .connect(alice)
        .approve(await stake.getAddress(), ethers.MaxUint256);
      // 只充值 3 个奖励代币，但用户实际会累积 10 个奖励，用来测试部分领取。
      await rewardToken.transfer(
        await stake.getAddress(),
        ethers.parseEther("3")
      );

      await stake.setRewardRate(REWARD_RATE);
      await stake.connect(alice).stake(STAKE_AMOUNT);

      const latest = await networkHelpers.time.latest();
      await networkHelpers.time.setNextBlockTimestamp(latest + 10);

      await expect(stake.connect(alice).claimReward())
        .to.emit(stake, "RewardClaimed")
        .withArgs(alice.address, ethers.parseEther("3"));

      expect(await rewardToken.balanceOf(alice.address)).to.equal(
        ethers.parseEther("3")
      );
      expect(await stake.rewards(alice.address)).to.equal(
        ethers.parseEther("7")
      );
      expect(await rewardToken.balanceOf(owner.address)).to.equal(
        TOTAL_SUPPLY - ethers.parseEther("3")
      );
    });
  });

  describe("Owner settings", function () {
    it("owner can update the reward rate", async function () {
      const { stake } = await networkHelpers.loadFixture(deployStakeFixture);

      await expect(stake.setRewardRate(REWARD_RATE))
        .to.emit(stake, "RewardRateUpdated")
        .withArgs(0n, REWARD_RATE);

      expect(await stake.rewardRate()).to.equal(REWARD_RATE);
    });

    it("non-owner cannot update the reward rate", async function () {
      const { stake, alice } = await networkHelpers.loadFixture(
        deployStakeFixture
      );

      await expect(stake.connect(alice).setRewardRate(REWARD_RATE))
        .to.be.revertedWithCustomError(stake, "OwnableUnauthorizedAccount")
        .withArgs(alice.address);
    });

    it("owner can update the min stake amount", async function () {
      const { stake } = await networkHelpers.loadFixture(deployStakeFixture);
      const newMinStake = ethers.parseEther("20");

      await expect(stake.setMinStake(newMinStake))
        .to.emit(stake, "MinStakeAmountUpdated")
        .withArgs(MIN_STAKE, newMinStake);

      expect(await stake.minStakeAmount()).to.equal(newMinStake);
    });

    it("owner can pause and unpause", async function () {
      const { stake } = await networkHelpers.loadFixture(deployStakeFixture);

      await stake.pause();
      expect(await stake.paused()).to.equal(true);

      await stake.unpause();
      expect(await stake.paused()).to.equal(false);
    });

    it("non-owner cannot pause", async function () {
      const { stake, alice } = await networkHelpers.loadFixture(
        deployStakeFixture
      );

      await expect(stake.connect(alice).pause())
        .to.be.revertedWithCustomError(stake, "OwnableUnauthorizedAccount")
        .withArgs(alice.address);
    });
  });
});
