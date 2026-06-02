import { expect } from "chai";
import { network } from "hardhat";

const { ethers, networkHelpers } = await network.create();

describe("Stake", function() {
  const TOTAL_SUPPLY = ethers.parseEther("1000000");
  const MIN_STAKE = ethers.parseEther("10");
  const STAKE_AMOUNT = ethers.parseEther("100");
  const REWARD_RATE = ethers.parseEther("1");

  // 初始快照
  async function deployStakeFixture() {
    const [owner, alice, bob] = await ethers.getSigners();

    // 部署三个合约
    const stakeToken = await ethers.deployContract("MyToken", ["Stake Token", "STK", TOTAL_SUPPLY]);
    const rewardToken = await ethers.deployContract("MyToken", ["Reward Token", "RWD", TOTAL_SUPPLY]);
    const stake = await ethers.deployContract("Stake", [stakeToken.getAddress(), rewardToken.getAddress(), MIN_STAKE]);

    // 分配代币和授权
    await stakeToken.transfer(alice.address, ethers.parseEther("1000"));
    await stakeToken.transfer(bob.address, ethers.parseEther("1000"));
    await stakeToken.connect(alice).approve(await stake.getAddress(), ethers.MaxUint256);
    await stakeToken.connect(bob).approve(await stake.getAddress(), ethers.MaxUint256);
    await rewardToken.transfer(await stake.getAddress(), TOTAL_SUPPLY);

    return {stake, stakeToken, rewardToken, owner, alice, bob};
  }

  // 测试部署
  describe("Deployment", function() {
    it("sets tokens, min stake, and initial timestamp", async function () {
      const {stake, stakeToken, rewardToken} = await networkHelpers.loadFixture(deployStakeFixture);

      expect(await stake.stakeToken()).to.equal(await stakeToken.getAddress());
      expect(await stake.rewardToken()).to.equal(await rewardToken.getAddress());
      expect(await stake.minStakeAmount()).to.equal(MIN_STAKE);
      expect(await stake.totalStake()).to.equal(0n);
      expect(await stake.rewardRate()).to.equal(0n);
      expect(await stake.lastUpdateTime()).to.be.greaterThan(0n);
    })

    it("reverts if stake token and reward token are the same", async function () {
      const token = await ethers.deployContract("MyToken", ["MyToken", "MTK", TOTAL_SUPPLY]);

      const factory = await ethers.getContractFactory("Stake");
      await expect(factory.deploy(await token.getAddress(), await token.getAddress(), MIN_STAKE)).to.be.revertedWithCustomError(factory, "Stake__InvalidAddress");
    })
  })

  // 测试质押函数
  describe("Stake", function() {
    // 正常质押
    it("stake tokens and update user balance and total stake", async function () {
      const {stake, stakeToken, alice} = await networkHelpers.loadFixture(deployStakeFixture);

      await expect(stake.connect(alice).stake(STAKE_AMOUNT)).to.emit(stake, "Staked").withArgs(alice.address, STAKE_AMOUNT);

      expect(await stake.totalStake()).to.equal(STAKE_AMOUNT);
      expect(await stake.balances(alice.address)).to.equal(STAKE_AMOUNT);
      expect(await stakeToken.balanceOf(await stake.getAddress())).to.equal(STAKE_AMOUNT);
    })
    
    // amount = 0
    it("reverts if amount equals zero", async function () {
      const {stake, alice} = await networkHelpers.loadFixture(deployStakeFixture);

      await expect(stake.connect(alice).stake(0n)).to.be.revertedWithCustomError(stake, "Stake__InsufficientStake").withArgs(0n, MIN_STAKE);
    })

    // amount < minStakeAmount
    it("reverts if amount less than minStakeAmount", async function () {
      const {stake, alice} = await networkHelpers.loadFixture(deployStakeFixture);

      await expect(stake.connect(alice).stake(MIN_STAKE - 1n)).to.be.revertedWithCustomError(stake, "Stake__InsufficientStake").withArgs(MIN_STAKE - 1n, MIN_STAKE);
    })

    // 合约暂停时质押
    it("reverts if contract has paused", async function () {
      const {stake, owner, alice} = await networkHelpers.loadFixture(deployStakeFixture);

      await stake.connect(owner).pause();

      expect(stake.connect(alice).stake(STAKE_AMOUNT)).to.be.revert(ethers);
    })
  })
})