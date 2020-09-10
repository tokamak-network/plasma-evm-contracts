pragma solidity ^0.5.0;

import { Ownable } from "../../../node_modules/openzeppelin-solidity/contracts/ownership/Ownable.sol";
import { SafeMath } from "../../../node_modules/openzeppelin-solidity/contracts/math/SafeMath.sol";
import { WTON } from "../tokens/WTON.sol";

contract DAOVault is Ownable {
    using SafeMath for uint256;

    WTON public wton;
    uint256 public claimEnableTime;

    modifier onlyClaimEnable() {
      require(block.timestamp >= claimEnableTime, "not possible time");
      _;
    }

    constructor(address wtonAddress, uint256 claimEnableTime_) public {
        wton = WTON(wtonAddress);
        claimEnableTime = claimEnableTime_;
    }

    function claim(address dao) external onlyOwner onlyClaimEnable {
      wton.swapToTONAndTransfer(dao, wton.balanceOf(address(this)));
    }
}
