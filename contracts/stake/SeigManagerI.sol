pragma solidity ^0.5.0;


interface SeigManagerI {
  function deployCoinage(address rootchain) external returns (bool);
}