pragma solidity ^0.5.0;

import { Ownable } from "../../../node_modules/openzeppelin-solidity/contracts/ownership/Ownable.sol";
import { SafeMath } from "../../../node_modules/openzeppelin-solidity/contracts/math/SafeMath.sol";
//import { ERC20Mintable } from "../../../node_modules/openzeppelin-solidity/contracts/token/ERC20/ERC20Mintable.sol";
import { IERC20 } from "../../../node_modules/openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";

contract DAOVault is Ownable {
    using SafeMath for uint256;

    IERC20 public ton;
    uint256 public claimEnableTime;

    modifier onlyClaimEnable() {
      require(block.timestamp >= claimEnableTime, "not possible time");
      _;
    }

    constructor(address tonAddress, uint256 claimEnableTime_) public {
        ton = IERC20(tonAddress);
        claimEnableTime = claimEnableTime_;
    }

    function claim(address dao) external onlyOwner onlyClaimEnable {
      ton.transfer(dao, ton.balanceOf(address(this)));
    }
}
