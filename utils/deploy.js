// Tries to get and return deployed contract. In case, it fails, it deploys it
// and returns newly deployed contract
// TODO: maybe { overwrite: false } can do it.
const deployedOrDeploy = async (Contract, deployer) => {
  let contract = null;
  try {
    const deployed = await Contract.deployed();
    contract = await Contract.at(deployed.address);
  } catch {
    await deployer.deploy(Contract);
    contract = await Contract.deployed();
  }
  return contract;
};

module.exports = { deployedOrDeploy };
