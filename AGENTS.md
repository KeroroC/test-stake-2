# Hardhat + ethers project

A Hardhat 3 workspace for a Synthetix-style staking contract. README.md has the user-facing overview; this file captures the architecture and conventions that require reading multiple files to discover.

## Working in this project

When writing or modifying tests, configuring `hardhat.config.ts`, or interacting with the network from TypeScript, invoke the **`hardhat`** skill. It covers Solidity and TypeScript testing, how to choose between them, `forge-std` cheatcodes, the `network.create()` API, `networkHelpers`, and the compile-then-typecheck workflow. The skill itself points to the matching `hardhat-toolbox-mocha-ethers` skill for toolbox-specific guidance (signers, contract interaction, chai matchers like `.to.changeEtherBalance` / `.to.emit` / `.to.be.revertedWithCustomError`).

## Architecture

**`Stake.sol` is a Synthetix-style staking pool with two modes.** The constructor takes `(stakeToken, rewardToken, minStakeAmount, rewardRate)`. `stakeToken == address(0)` flips the contract into ETH-staking mode (locked in via the `isEthStake` immutable). `rewardToken` is never the zero address and must differ from `stakeToken` — the constructor reverts with `Stake__InvalidAddress` otherwise. The contract inherits `Ownable`, `ReentrancyGuard`, and `Pausable` from OpenZeppelin v5; `pause()` only blocks `stake()`, not `withdraw()`.

**Reward accounting is per-unit-staked, not per-user.** The state is `rewardPerTokenStored` + `lastUpdateTime` globally, and `userRewardPerTokenPaid[user]` + `rewards[user]` per user. Every state-changing entrypoint (`stake`, `withdraw`, `claimReward`, `setRewardRate`) calls `_updateRewards(user)` first to checkpoint the user. `calRewardPerToken()` returns `rewardPerTokenStored` unchanged when `totalStake == 0`, so reward clock doesn't tick on an empty pool. The 1e18 scaling factor is hardcoded in the math.

**`claimReward()` is a best-effort payout.** It reads `rewardToken.balanceOf(address(this))` and pays the lesser of `rewards[user]` and that balance; the user's `rewards[user]` accounting still reflects the full owed amount (only the transferred amount is subtracted), so an under-funded pool lets users claim the remainder later. It reverts with `Stake__InsufficientRewardBalance` only when the pool holds zero tokens.

**Tests live in two places on purpose.** `contracts/Stake.t.sol` uses `forge-std` cheatcodes (`vm.prank`, `vm.warp`, `vm.expectRevert`, `vm.expectEmit`) for unit-level invariants. `test/Stake.ts` drives the contract through `network.create()` + Mocha + chai matchers for full end-to-end flows, using `networkHelpers.loadFixture(...)` to snapshot-reset between tests and `networkHelpers.time.increase` / `time.setNextBlockTimestamp` to advance time. The TypeScript tests are the source of truth for reward-over-time math because they can fast-forward via Hardhat's EDR network; Solidity tests are best for low-level event/revert assertions.

**Ignition modules parameterize deployments.** `ignition/modules/Stake.ts` deploys `MyToken` (stake + reward), then `Stake`, all with overridable parameters (`stakeTokenName`, `rewardRate`, etc.) so the same module works for local / Sepolia / other networks declared in `hardhat.config.ts`.

## Common commands

```shell
# Compile
npx hardhat build

# Tests
npx hardhat test                                  # everything
npx hardhat test mocha                            # TS/Mocha only
npx hardhat test mocha test/Stake.ts              # single TS test file
npx hardhat test solidity                         # Solidity tests only
npx hardhat test solidity contracts/Stake.t.sol   # single Solidity test file
forge test --match-path contracts/Stake.t.sol     # via forge directly

# Type check
npx tsc --noEmit

# Deploy
npx hardhat ignition deploy ignition/modules/Stake.ts --network sepolia
```

## Environment

Sepolia RPC URL and a funded private key must be set as `SEPOLIA_RPC_URL` and `SEPOLIA_PRIVATE_KEY` (Hardhat config variables) before deploying. Never commit `.env` — it is gitignored.

## Docs

- Hardhat 3 — https://hardhat.org/llms.txt
- ethers.js — https://docs.ethers.org/v6/
- OpenZeppelin Contracts v5 — https://docs.openzeppelin.com/contracts/5.x/
