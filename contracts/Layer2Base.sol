pragma solidity ^0.5.12;

import "./Layer2Storage.sol";
import "./Layer2Event.sol";

/**
 * @notice Layer2Base provides functions to be delegated to other handlers,
 *         EpochHandler, SubmitHandler.
 */
contract Layer2Base is Layer2Storage, Layer2Event {
  /**
   * Constants
   */

  // solium-disable mixedcase
  // EpochHandler functions
  bytes4 constant PREPARE_TO_SUTMIBT_ORB_SIG = bytes4(keccak256("prepareORE()"));
  bytes4 constant PREPARE_TO_SUTMIBT_NRB_SIG = bytes4(keccak256("prepareNRE()"));
  bytes4 constant PREPARE_TO_SUTMIBT_URB_SIG = bytes4(keccak256("prepareToSubmitURB()"));
  bytes4 constant PREPARE_ORE_AFTER_URE_SIG = bytes4(keccak256("prepareOREAfterURE()"));
  bytes4 constant PREPARE_NRE_AFTER_URE_SIG = bytes4(keccak256("prepareNREAfterURE()"));

  // SubmitHandler functions
  bytes4 constant SUBMIT_NRE_SIG = bytes4(keccak256("submitNRE(uint256,uint256,bytes32,bytes32,bytes32)"));
  bytes4 constant SUBMIT_ORB_SIG = bytes4(keccak256("submitORB(uint256,bytes32,bytes32,bytes32)"));
  bytes4 constant SUBMIT_URB_SIG = bytes4(keccak256("submitURB(uint256,bytes32,bytes32,bytes32)"));
  // solium-endable mixedcase

  /**
   * Functions
   */
  // delegate to epoch handler
  function _delegatePrepareORE() internal {
    // solium-disable-next-line security/no-low-level-calls, max-len, no-unused-vars
    (bool success, bytes memory returnData) = epochHandler.delegatecall(abi.encodeWithSelector(PREPARE_TO_SUTMIBT_ORB_SIG));
    require(success);
  }

  // delegate to epoch handler
  function _delegatePrepareNRE() internal {
    // solium-disable-next-line security/no-low-level-calls, max-len, no-unused-vars
    (bool success, bytes memory returnData) = epochHandler.delegatecall(abi.encodeWithSelector(PREPARE_TO_SUTMIBT_NRB_SIG));
    // (bool success, bytes memory returnData) = epochHandler.delegatecall(abi.encodeWithSelector(PREPARE_TO_SUTMIBT_NRB_SIG));
    require(success);
  }

  // delegate to epoch handler
  function _delegatePrepareToSubmitURB() internal {
    // solium-disable-next-line security/no-low-level-calls, max-len, no-unused-vars
    (bool success, bytes memory returnData) = epochHandler.delegatecall(abi.encodeWithSelector(PREPARE_TO_SUTMIBT_URB_SIG));
    // (bool success, bytes memory returnData) = epochHandler.delegatecall(abi.encodeWithSelector(PREPARE_TO_SUTMIBT_NRB_SIG));
    require(success);
  }

  // delegate to epoch handler
  function _delegatePrepareOREAfterURE() internal {
    // solium-disable-next-line security/no-low-level-calls, max-len, no-unused-vars
    (bool success, bytes memory returnData) = epochHandler.delegatecall(abi.encodeWithSelector(PREPARE_ORE_AFTER_URE_SIG));
    require(success);
  }

  // delegate to epoch handler
  function _delegatePrepareNREAfterURE() internal {
    // solium-disable-next-line security/no-low-level-calls, max-len, no-unused-vars
    (bool success, bytes memory returnData) = epochHandler.delegatecall(abi.encodeWithSelector(PREPARE_NRE_AFTER_URE_SIG));
    require(success);
  }

  // delegate to submit handler
  function _delegateSubmitNRE(
    uint _pos1, // forknumber + epochNumber
    uint _pos2, // startBlockNumber + endBlockNumber
    bytes32 _epochStateRoot,
    bytes32 _epochTransactionsRoot,
    bytes32 _epochReceiptsRoot
  )
    internal
    returns (bool success)
  {
    // solium-disable-next-line security/no-low-level-calls, max-len, no-unused-vars
    (bool success, bytes memory returnData) = submitHandler.delegatecall(abi.encodeWithSelector(
      SUBMIT_NRE_SIG,
      _pos1,
      _pos2,
      _epochStateRoot,
      _epochTransactionsRoot,
      _epochReceiptsRoot
    ));
    require(success);
    return true;
  }

  // delegate to submit handler
  function _delegateSubmitORB(
    uint _pos,
    bytes32 _statesRoot,
    bytes32 _transactionsRoot,
    bytes32 _receiptsRoot
  )
    internal
    returns (bool success)
  {
    // solium-disable-next-line security/no-low-level-calls, max-len, no-unused-vars
    (bool success, bytes memory returnData) = submitHandler.delegatecall(abi.encodeWithSelector(
      SUBMIT_ORB_SIG,
      _pos,
      _statesRoot,
      _transactionsRoot,
      _receiptsRoot
    ));
    require(success);
    return true;
  }

  // delegate to submit handler
  function _delegateSubmitURB(
    uint _pos,
    bytes32 _statesRoot,
    bytes32 _transactionsRoot,
    bytes32 _receiptsRoot
  )
    internal
    returns (bool success)
  {
    // solium-disable-next-line security/no-low-level-calls, max-len, no-unused-vars
    (bool success, bytes memory returnData) = submitHandler.delegatecall(abi.encodeWithSelector(
      SUBMIT_URB_SIG,
      _pos,
      _statesRoot,
      _transactionsRoot,
      _receiptsRoot
    ));
    require(success);
    return true;
  }
}
