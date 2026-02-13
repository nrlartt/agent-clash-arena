// Compile and Deploy AgentClashBetting to Monad Testnet
const solc = require('solc');
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const RPC = process.env.VITE_MONAD_RPC_URL || 'https://testnet-rpc.monad.xyz';
const PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY;
const OPERATOR = process.env.OPERATOR_ADDRESS;

async function main() {
    console.log('=== AgentClashBetting Deploy ===\n');

    // 1. Read and compile
    console.log('[1/4] Compiling contract...');
    const source = fs.readFileSync(path.join(__dirname, 'AgentClashBetting.sol'), 'utf-8');
    
    const input = {
        language: 'Solidity',
        sources: { 'AgentClashBetting.sol': { content: source } },
        settings: {
            outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
            optimizer: { enabled: true, runs: 200 },
        },
    };

    const output = JSON.parse(solc.compile(JSON.stringify(input)));
    
    if (output.errors) {
        const fatal = output.errors.filter(e => e.severity === 'error');
        if (fatal.length > 0) {
            console.error('Compilation errors:');
            fatal.forEach(e => console.error(e.formattedMessage));
            process.exit(1);
        }
        // Warnings are OK
        output.errors.filter(e => e.severity === 'warning').forEach(w => {
            console.log('  Warning:', w.message.split('\n')[0]);
        });
    }

    const contract = output.contracts['AgentClashBetting.sol']['AgentClashBetting'];
    const abi = contract.abi;
    const bytecode = '0x' + contract.evm.bytecode.object;
    
    console.log('  Compiled OK! ABI:', abi.length, 'functions, Bytecode:', Math.round(bytecode.length / 2), 'bytes\n');

    // Save artifact
    const artifactsDir = path.join(__dirname, 'artifacts');
    if (!fs.existsSync(artifactsDir)) fs.mkdirSync(artifactsDir);
    fs.writeFileSync(path.join(artifactsDir, 'AgentClashBetting.json'), JSON.stringify({ abi, bytecode }, null, 2));
    console.log('  Artifact saved to contracts/artifacts/\n');

    // 2. Connect
    console.log('[2/4] Connecting to Monad Testnet...');
    const provider = new ethers.JsonRpcProvider(RPC);
    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
    const balance = await provider.getBalance(wallet.address);
    console.log('  Deployer:', wallet.address);
    console.log('  Balance:', ethers.formatEther(balance), 'MON');
    console.log('  Operator:', OPERATOR, '\n');

    // 3. Deploy
    console.log('[3/4] Deploying contract...');
    const factory = new ethers.ContractFactory(abi, bytecode, wallet);
    const deployTx = await factory.deploy(OPERATOR);
    console.log('  Tx hash:', deployTx.deploymentTransaction().hash);
    console.log('  Waiting for confirmation...');
    
    await deployTx.waitForDeployment();
    const address = await deployTx.getAddress();

    console.log('\n[4/4] DEPLOYED SUCCESSFULLY!');
    console.log('  Contract:', address);
    console.log('  Explorer: https://testnet.monadexplorer.com/address/' + address);
    
    // 4. Output env line
    console.log('\n=== Add this to your .env ===');
    console.log('VITE_BETTING_CONTRACT_ADDRESS=' + address);
    console.log('');
}

main().catch(e => { console.error('Deploy failed:', e.message); process.exit(1); });
