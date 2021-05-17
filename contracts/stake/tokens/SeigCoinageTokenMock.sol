pragma solidity ^0.5.12;

import { SeigCoinageToken } from "./SeigCoinageToken.sol";

contract SeigCoinageTokenMock is SeigCoinageToken {
    constructor() public {
    }

    function mint(address account, uint256 amount) public onlyOwner {
        super._mint(account, amount);
    }

    function burn(address account, uint256 amount) public onlyOwner {
        super._burn(account, amount);
    }
}
