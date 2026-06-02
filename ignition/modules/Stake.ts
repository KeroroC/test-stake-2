import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("StakeModule", (m) => {
  const stakeTokenName = m.getParameter("stakeTokenName", "Stake Token");
  const stakeTokenSymbol = m.getParameter("stakeTokenSymbol", "STK");
  const stakeTokenSupply = m.getParameter(
    "stakeTokenSupply",
    1_000_000n * 10n ** 18n
  );

  const rewardTokenName = m.getParameter("rewardTokenName", "Reward Token");
  const rewardTokenSymbol = m.getParameter("rewardTokenSymbol", "RWD");
  const rewardTokenSupply = m.getParameter(
    "rewardTokenSupply",
    1_000_000n * 10n ** 18n
  );

  const minStakeAmount = m.getParameter("minStakeAmount", 10n * 10n ** 18n);
  const rewardRate = m.getParameter("rewardRate", 0n);

  const stakeToken = m.contract("MyToken", [
    stakeTokenName,
    stakeTokenSymbol,
    stakeTokenSupply,
  ]);
  const rewardToken = m.contract("MyToken", [
    rewardTokenName,
    rewardTokenSymbol,
    rewardTokenSupply,
  ]);

  const stake = m.contract("Stake", [
    stakeToken,
    rewardToken,
    minStakeAmount,
    rewardRate,
  ]);

  return { stakeToken, rewardToken, stake };
});
