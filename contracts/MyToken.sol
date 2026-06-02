// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract MyToken is ERC20, Ownable{

  uint256 public immutable MAX_SUPPLY;

  constructor(string memory name, string memory symbol, uint256 maxSupply) ERC20(name, symbol) Ownable(msg.sender) {
    // e.g. 10000 * 1 ether
    MAX_SUPPLY = maxSupply;

    _mint(msg.sender, maxSupply);
  }

}