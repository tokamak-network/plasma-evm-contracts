pragma solidity ^0.4.24;

import "./lib/Data.sol";


contract RootChainStorage {
  /*
   * Storage
   */
  bool public development; // dev mode
  address public operator;
  address public epochHandler;

  // 1 epoch = N NRBs or k URBs or k ORBs.
  // N consecutive NRBs must be submitted in an epoch. In case of request block,
  // massive requests can be included in k ORBs, and k is determined when
  // N NRBs are submitted or when preparing URBs submission.
  uint public NRELength;

  // Increase for each URB
  uint public currentFork;

  // First not-empty request epochs of a fork
  mapping (uint => uint) public firstFilledORENumber;

  mapping (uint => Data.Fork) public forks;


  // Enter & Exit requests for ORB / URB
  Data.Request[] public EROs;
  Data.Request[] public ERUs;

  // Consecutive request block. The fork where they are in is defined in Data.PlasmaBlock
  Data.RequestBlock[] public ORBs;
  Data.RequestBlock[] public URBs;

  // count enter requests for epoch
  uint public numEnterForORB;

  // Last applied request
  uint public lastAppliedForkNumber;
  uint public lastAppliedBlockNumber;
  uint public lastAppliedERO;
  uint public lastAppliedERU;

  // Requestable contract address in child chain
  mapping (address => address) public requestableContracts;

  /*
   * Constant
   */
  address constant public NULL_ADDRESS = 0x0000000000000000000000000000000000000000;

  // TODO: develop cost function model
  // Simple cost parameters
  uint public constant COST_ERO = 0.1 ether;         // cost for invalid exit
  uint public constant COST_ERU = 0.2 ether;         // cost for fork & rebase
  uint public constant COST_URB_PREPARE = 0.1 ether; // cost for URB prepare
  uint public constant COST_URB = 0.9 ether;         // cost for fork & rebase
  uint public constant COST_ORB = 0.1 ether;         // cost for invalid computation
  uint public constant COST_NRB = 0.1 ether;         // cost for invalid computation

  // Prepare time
  uint public constant PREPARE_TIMEOUT = 1 hours;

  // Challenge periods for computation and withholding
  uint public constant CP_COMPUTATION = 15; // 15 sec for dev
  uint public constant CP_WITHHOLDING = 20; // 20 sec for dev
  uint public constant CP_EXIT = 10; // 10 sec for dev
  // uint public constant CP_COMPUTATION = 1 days;
  // uint public constant CP_WITHHOLDING = 7 days;
  // uint public constant CP_EXIT = 1 days;


  // Gas limit for request trasaction
  uint public constant REQUEST_GAS = 100000;
}

