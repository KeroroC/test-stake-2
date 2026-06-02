# Stake 合约练习项目

这是一个基于 Hardhat 3、ethers.js 和 OpenZeppelin 的质押合约练习项目。项目核心是 `Stake` 合约：用户质押 ERC20 代币，根据质押时间和质押份额累积奖励，并可以提现本金或领取奖励。

## 项目结构

```text
contracts/
  Stake.sol        质押合约
  MyToken.sol      测试用 ERC20 代币
  Stake.t.sol      Solidity / Foundry 风格测试
  Counter.sol      Hardhat 模板示例合约
test/
  Stake.ts         TypeScript + Mocha + ethers 测试
  Counter.ts       Hardhat 模板示例测试
hardhat.config.ts  Hardhat 3 配置
remappings.txt     Forge 运行 Solidity 测试时使用的 remapping
```

## Stake 合约功能

`Stake.sol` 当前实现了以下功能：

- 用户质押 `stakeToken`
- 用户提现已质押的 `stakeToken`
- 按 `rewardRate` 和质押占比累计 `rewardToken` 奖励
- 查询用户实时收益 `earned(address)`
- 用户领取奖励 `claimReward()`
- owner 设置奖励速率 `setRewardRate(uint256)`
- owner 设置最小质押金额 `setMinStake(uint256)`
- owner 暂停和恢复质押 `pause()` / `unpause()`

合约要求 `stakeToken` 和 `rewardToken` 不能是零地址，也不能是同一个 token，避免奖励池和用户本金混在一起。

## 奖励计算思路

合约使用“每单位质押累计奖励”的方式记账：

- `rewardPerTokenStored` 保存全局每单位质押累计奖励
- `lastUpdateTime` 保存上次更新奖励的时间
- `userRewardPerTokenPaid[user]` 保存用户上次结算时看到的全局奖励值
- `rewards[user]` 保存用户已结算但尚未领取的奖励

用户质押、提现、领取奖励，或者 owner 调整奖励速率时，合约会先更新奖励检查点，再修改余额或参数。

## 安装依赖

```shell
npm install
```

## 编译

```shell
npx hardhat build
```

## TypeScript 测试

`test/Stake.ts` 使用 Hardhat 3 的 `network.create()`、Mocha、ethers 和 chai matcher，适合从外部用户视角测试完整交互流程。

运行 Stake 的 TypeScript 测试：

```shell
npx hardhat test mocha test/Stake.ts
```

运行所有 Mocha 测试：

```shell
npx hardhat test mocha
```

当前 `Stake.ts` 覆盖了：

- 部署参数校验
- 无效 token 地址校验
- 质押成功和失败路径
- 多用户质押
- 提现成功和失败路径
- 暂停状态下禁止质押
- 暂停状态下允许提现
- 奖励累计、领取和部分领取
- owner 权限控制

## Solidity / Foundry 风格测试

`contracts/Stake.t.sol` 是 Solidity 测试文件，使用 `forge-std/Test.sol` 的 cheatcodes，例如：

- `vm.prank(address)` 模拟不同调用者
- `vm.warp(uint256)` 推进区块时间
- `vm.expectRevert(...)` 断言交易回滚
- `vm.expectEmit(...)` 断言事件

Hardhat 3 可以运行 Solidity 测试：

```shell
npx hardhat test solidity contracts/Stake.t.sol
```

也可以直接使用 Forge 运行：

```shell
forge test --match-path contracts/Stake.t.sol
```

## 类型检查

```shell
npx tsc --noEmit
```

## 常用命令

```shell
# 编译合约
npx hardhat build

# 运行全部测试
npx hardhat test

# 只运行 Solidity 测试
npx hardhat test solidity

# 只运行 Mocha / ethers 测试
npx hardhat test mocha

# 运行 Stake 的 TypeScript 测试
npx hardhat test mocha test/Stake.ts

# 运行 Stake 的 Solidity 测试
npx hardhat test solidity contracts/Stake.t.sol

# 使用 Forge 运行 Stake Solidity 测试
forge test --match-path contracts/Stake.t.sol

# TypeScript 类型检查
npx tsc --noEmit
```

