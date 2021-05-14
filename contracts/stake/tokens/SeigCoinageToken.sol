pragma solidity ^0.5.12;

import { SafeMath } from "@openzeppelin/contracts/math/SafeMath.sol";
import { Ownable } from "@openzeppelin/contracts/ownership/Ownable.sol";

contract SeigCoinageToken is Ownable {
    using SafeMath for uint256;

    struct Seig {
        uint256 totalSupply;
        uint256 totalSeig;
        uint256 nextSeigBlock;
    }
    
    struct Balance {
        uint256 latestBlock;
        uint256 balance;
    }

    mapping (address => Balance) public balances;
    
    // blockNumber => Seig
    mapping (uint256 => Seig) public seigHistory;
    
    uint256 public latestSeigBlock;
    uint256 public firstSeigBlock; // necessary?

    constructor() public {
    }

    function totalSupply() public view returns (uint256) {
        return seigHistory[latestSeigBlock].totalSupply;
    }

    function balanceOf(address owner) public view returns (uint256) {
        Balance storage b = balances[owner];
        uint256 balance = b.balance;

        if (b.latestBlock < latestSeigBlock) {
            (uint256 seig, uint256 _) = getSeigniorage(owner);
            balance = balance.add(seig);
        }
        
        return balance;
    }

    function _mint(address account, uint256 amount) internal onlyOwner {
        require(account != address(0), "SeigCoinageToken: mint to the zero address");
        Seig storage s = seigHistory[latestSeigBlock];
        Balance storage b = balances[account];

        s.totalSupply = s.totalSupply.add(amount);
        b.balance = b.balance.add(amount);
    }

    function _burn(address account, uint256 amount) internal onlyOwner {
        require(account != address(0), "SeigCoinageToken: burn from the zero address");
        Seig storage s = seigHistory[latestSeigBlock];
        Balance storage b = balances[account];

        s.totalSupply = s.totalSupply.sub(amount);
        b.balance = b.balance.sub(amount);
    }


    function addSeigniorage(uint256 amount) public onlyOwner {
        Seig storage latestSeig = seigHistory[latestSeigBlock];
        Seig memory seig;
        seig.totalSupply = latestSeig.totalSupply.add(amount);
        seig.totalSeig = amount;

        latestSeig.nextSeigBlock = block.number;
        latestSeigBlock = block.number;
        seigHistory[block.number] = seig;
    }

    function updateSeigniorage(address owner) public {
        (uint256 seig, uint256 latestBlock) = getSeigniorage(owner);
        Balance storage b = balances[owner];
        
        b.latestBlock = latestBlock;
        b.balance = b.balance.add(seig);
    }
    
    function getSeigniorage(address owner) public view returns (uint256, uint256) {
        uint256 result = 0;
        Balance storage b = balances[owner];
        Seig storage s = seigHistory[b.latestBlock];
        uint256 searchingBlock = s.nextSeigBlock;
        uint256 currentBalance = b.balance; // TODO: check lastestblockNumber?
        uint256 latestBlock;
        uint256 accTotalSupply = s.totalSupply;
        while (searchingBlock != 0) {
            Seig storage s = seigHistory[searchingBlock];
            uint256 seig = currentBalance.add(result).mul(s.totalSeig).div(accTotalSupply);
        
            accTotalSupply = accTotalSupply.add(s.totalSeig);
            result = result.add(seig);
            latestBlock = searchingBlock;
            searchingBlock = s.nextSeigBlock;
        }

        return (result, latestBlock);
    }
}
