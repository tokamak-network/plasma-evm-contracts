pragma solidity ^0.5.12;

import "../requestable-erc20-wrapper-token/contracts/RequestableERC20Wrapper.sol";


/**
 * @title     EtherToken
 * @notice    EtherToken is a requestable token that can exchange ETH at a 1:1 ratio.
 *            This contract is deployed both in root chain and in child chain. But in root chain,
 *            It doesn't support ETH swap, it just takes another ERC20 as a exchangable token.
 *            However, EtherToken in child chain takes (P)ETH to
 */
contract EtherToken is RequestableERC20Wrapper {
  bool public swapEnabled;

  // EtherToken in root chain disables ether swap, but EtherToken in child chain allows it.
  constructor(
    bool _development,
    ERC20 _token,
    bool _swapEnabled
  ) public RequestableERC20Wrapper(_development, _token) {
    bool noToken = address(_token) == address(0);

    // in production, Exchangable asset must be either ERC20 or ETH, not both.
    require(_development || (noToken && _swapEnabled || !noToken && !_swapEnabled));
    swapEnabled = _swapEnabled;
  }

  function() external payable {
    swapFromEth();
  }

  // swap ETH to token
  function swapFromEth() public payable {
    require(swapEnabled);

    mint(msg.sender, msg.value);
  }

  // swap token to ETH
  function swapToEth(uint _amount) public {
    require(swapEnabled);

    require(transferFrom(msg.sender, address(this), _amount));
    burn(msg.sender, _amount);
  }
}