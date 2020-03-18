pragma solidity ^0.5.12;

/**
 * @title Math
 * @dev Assorted math operations
 */
library Math {
  function max(uint256 a, uint256 b) internal pure returns (uint256) {
    return a >= b ? a : b;
  }

  function min(uint256 a, uint256 b) internal pure returns (uint256) {
    return a < b ? a : b;
  }

  function average(uint256 a, uint256 b) internal pure returns (uint256) {
    // (a + b) / 2 can overflow, so we distribute
    return (a / 2) + (b / 2) + ((a % 2 + b % 2) / 2);
  }

  // return ceil(n/d)
  function divCeil(uint256 n, uint256 d) internal pure returns (uint256) {
    return n % d == 0 ? n / d : n / d + 1;
  }
}
