import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("MyTokenModule", (m) => {
  const name = m.getParameter("name", "My Token");
  const symbol = m.getParameter("symbol", "MTK");
  const maxSupply = m.getParameter("maxSupply", 1_000_000n * 10n ** 18n);

  const token = m.contract("MyToken", [name, symbol, maxSupply]);

  return { token };
});
