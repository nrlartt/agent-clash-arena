// ═══════════════════════════════════════════════════════════════
// DEPLOY SCRIPT — Deploy AgentClashBetting to Monad Mainnet
// 
// Usage:
//   node contracts/deploy.js
//
// Required env vars:
//   DEPLOYER_PRIVATE_KEY — Private key of deployer wallet
//   OPERATOR_ADDRESS     — Backend server wallet address (can create/resolve matches)
//   MONAD_RPC_URL        — Monad Mainnet RPC (default: https://rpc.monad.xyz)
//
// After deploy, add the contract address to .env:
//   VITE_BETTING_CONTRACT_ADDRESS=0x...
// ═══════════════════════════════════════════════════════════════

const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

// Load env from root .env
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const RPC_URL = process.env.MONAD_RPC_URL || process.env.VITE_MONAD_RPC_URL || 'https://rpc.monad.xyz';
const DEPLOYER_KEY = process.env.DEPLOYER_PRIVATE_KEY;
const OPERATOR = process.env.OPERATOR_ADDRESS;

if (!DEPLOYER_KEY) {
    console.error('ERROR: Set DEPLOYER_PRIVATE_KEY in .env');
    process.exit(1);
}

if (!OPERATOR) {
    console.error('ERROR: Set OPERATOR_ADDRESS in .env');
    process.exit(1);
}

// You need to compile the contract first with solc or hardhat
// This script expects the compiled ABI and bytecode
// For quick deployment, use Remix IDE (https://remix.ethereum.org)
// Or install hardhat: npm install --save-dev hardhat

async function main() {
    console.log('');
    console.log('═══════════════════════════════════════════════');
    console.log('AgentClashBetting — Deploy to Monad Mainnet');
    console.log('═══════════════════════════════════════════════');
    console.log(`RPC:      ${RPC_URL}`);
    console.log(`Operator: ${OPERATOR}`);
    console.log('');

    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const wallet = new ethers.Wallet(DEPLOYER_KEY, provider);
    
    console.log(`Deployer: ${wallet.address}`);
    const balance = await provider.getBalance(wallet.address);
    console.log(`Balance:  ${ethers.formatEther(balance)} MON`);
    
    if (balance === 0n) {
        console.error('ERROR: Deployer has no MON. Fund your wallet with MON on Monad Mainnet.');
        process.exit(1);
    }

    // Check for compiled artifact
    const artifactPath = path.join(__dirname, 'artifacts', 'AgentClashBetting.json');
    if (!fs.existsSync(artifactPath)) {
        console.log('');
        console.log('No compiled artifact found at contracts/artifacts/AgentClashBetting.json');
        console.log('');
        console.log('To compile and deploy, use one of these methods:');
        console.log('');
        console.log('Method 1: Remix IDE (Easiest)');
        console.log('  1. Go to https://remix.ethereum.org');
        console.log('  2. Copy contracts/AgentClashBetting.sol');
        console.log('  3. Compile with Solidity 0.8.24');
        console.log('  4. Deploy → Injected Provider (MetaMask on Monad Mainnet)');
        console.log(`  5. Constructor args: operator = ${OPERATOR}`);
        console.log('  6. Copy deployed address → add to .env as VITE_BETTING_CONTRACT_ADDRESS');
        console.log('');
        console.log('Method 2: Hardhat');
        console.log('  npm install --save-dev hardhat @nomicfoundation/hardhat-ethers');
        console.log('  npx hardhat compile');
        console.log('  Then re-run this script');
        console.log('');
        process.exit(0);
    }

    // If artifact exists, deploy
    const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf-8'));
    const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
    
    console.log('Deploying contract...');
    const contract = await factory.deploy(OPERATOR);
    await contract.waitForDeployment();
    
    const address = await contract.getAddress();
    console.log('');
    console.log('CONTRACT DEPLOYED SUCCESSFULLY!');
    console.log(`Address: ${address}`);
    console.log(`Explorer: https://monadscan.com/address/${address}`);
    console.log('');
    console.log('Add this to your .env file:');
    console.log(`VITE_BETTING_CONTRACT_ADDRESS=${address}`);
    console.log('');
}

main().catch((err) => {
    console.error('Deploy failed:', err);
    process.exit(1);
});
