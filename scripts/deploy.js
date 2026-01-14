import hre from "hardhat";
import { writeFileSync } from "fs";

async function main() {
  console.log("🚀 Deploying VotingSystem...");
  
  const ethers = (await import("ethers")).ethers;
  const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");
  const wallet = new ethers.Wallet(
    "0x8f2a55949038a9610f50fb23b5883af3b4ecb3c3bb792cbcefbd1542c692be63",
    provider
  );
  
  console.log("📝 Deploying with account:", wallet.address);
  
  const balance = await provider.getBalance(wallet.address);
  console.log("💰 Account balance:", ethers.formatEther(balance), "ETH");
  
  const { readFileSync } = await import("fs");
  const { join } = await import("path");
  const { fileURLToPath } = await import("url");
  const { dirname } = await import("path");
  
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  
  // ✅ Changé pour VotingSystem
  const artifactPath = join(__dirname, "..", "artifacts", "contracts", "VotingSystem.sol", "VotingSystem.json");
  const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
  
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
  
  console.log("⏳ Deploying contract...");
  const contract = await factory.deploy({ gasLimit: 5000000 });
  
  console.log("📋 Transaction hash:", contract.deploymentTransaction().hash);
  await contract.waitForDeployment();
  
  const address = await contract.getAddress();
  console.log("✅ VotingSystem deployed to:", address);
  
  writeFileSync(join(__dirname, "..", "contract-address.txt"), address);
  console.log("📄 Address saved to contract-address.txt");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Error:", error.message);
    process.exit(1);
  });