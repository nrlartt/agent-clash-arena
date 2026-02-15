// Verify AgentClashBetting on Monadscan (Etherscan-compatible API)
const fs = require('fs');
const path = require('path');
const solc = require('solc');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const CONTRACT_ADDRESS = process.env.VITE_BETTING_CONTRACT_ADDRESS || '0xad593Efa1971a2Ed7977b294efbdbB84dc23B38f';
const OPERATOR_ADDRESS = process.env.OPERATOR_ADDRESS || '0xe0A0e9A6E17cF929b2648D6E8EAa516F357F87eA';
const MONADSCAN_API_URL = 'https://api.monadscan.com/api';
// Monadscan may work without API key or with a placeholder
const MONADSCAN_API_KEY = process.env.MONADSCAN_API_KEY || '';

async function main() {
    console.log('=== AgentClashBetting Verification ===\n');
    console.log('Contract:', CONTRACT_ADDRESS);
    console.log('Operator:', OPERATOR_ADDRESS);

    // 1. Read source code
    const sourceCode = fs.readFileSync(path.join(__dirname, 'AgentClashBetting.sol'), 'utf-8');
    console.log('\n[1] Source code loaded (' + sourceCode.length + ' chars)');

    // 2. Get compiler version
    const compilerVersion = 'v' + solc.version().replace('.Emscripten.clang', '');
    console.log('[2] Compiler version:', compilerVersion);

    // 3. ABI-encode constructor arguments
    // constructor(address _operator)
    const constructorArgs = OPERATOR_ADDRESS.toLowerCase().replace('0x', '').padStart(64, '0');
    console.log('[3] Constructor args:', constructorArgs);

    // 4. Build form data for Etherscan-compatible API
    const params = new URLSearchParams();
    params.append('apikey', MONADSCAN_API_KEY);
    params.append('module', 'contract');
    params.append('action', 'verifysourcecode');
    params.append('contractaddress', CONTRACT_ADDRESS);
    params.append('sourceCode', sourceCode);
    params.append('codeformat', 'solidity-single-file');
    params.append('contractname', 'AgentClashBetting');
    params.append('compilerversion', compilerVersion);
    params.append('optimizationUsed', '1');
    params.append('runs', '200');
    params.append('constructorArguements', constructorArgs); // Note: Etherscan API typo is intentional
    params.append('evmversion', '');
    params.append('licenseType', '3'); // MIT

    console.log('\n[4] Submitting verification to Monadscan...');
    console.log('    URL:', MONADSCAN_API_URL);

    try {
        const response = await fetch(MONADSCAN_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params.toString(),
        });

        const data = await response.json();
        console.log('\n[5] Response:', JSON.stringify(data, null, 2));

        if (data.status === '1') {
            console.log('\n✅ Verification submitted! GUID:', data.result);
            console.log('Checking status...');

            // Poll for result
            for (let i = 0; i < 10; i++) {
                await new Promise(r => setTimeout(r, 5000));
                const checkParams = new URLSearchParams();
                checkParams.append('apikey', MONADSCAN_API_KEY);
                checkParams.append('module', 'contract');
                checkParams.append('action', 'checkverifystatus');
                checkParams.append('guid', data.result);

                const checkRes = await fetch(`${MONADSCAN_API_URL}?${checkParams.toString()}`);
                const checkData = await checkRes.json();
                console.log(`  Attempt ${i + 1}:`, checkData.result);

                if (checkData.result === 'Pass - Verified' || checkData.result?.includes('Already Verified')) {
                    console.log('\n✅ CONTRACT VERIFIED SUCCESSFULLY!');
                    console.log(`   https://monadscan.com/address/${CONTRACT_ADDRESS}#code`);
                    return;
                }
                if (checkData.result?.includes('Fail')) {
                    console.log('\n❌ Verification failed:', checkData.result);
                    return;
                }
            }
            console.log('\n⏳ Verification still pending. Check manually:');
            console.log(`   https://monadscan.com/address/${CONTRACT_ADDRESS}#code`);
        } else {
            console.log('\n❌ Submission failed:', data.result || data.message);

            // If API doesn't work, provide manual verification info
            console.log('\n=== Manual Verification Info ===');
            console.log('Go to: https://monadscan.com/verifyContract');
            console.log('Contract Address:', CONTRACT_ADDRESS);
            console.log('Compiler Type: Solidity (Single file)');
            console.log('Compiler Version:', compilerVersion);
            console.log('Open Source License: MIT');
            console.log('Optimization: Yes, 200 runs');
            console.log('Constructor Arguments:', constructorArgs);
            console.log('\nPaste the full source code from:');
            console.log('  contracts/AgentClashBetting.sol');
        }
    } catch (err) {
        console.error('\n❌ Request failed:', err.message);
        console.log('\n=== Manual Verification Info ===');
        console.log('Go to: https://monadscan.com/verifyContract');
        console.log('Contract Address:', CONTRACT_ADDRESS);
        console.log('Compiler Type: Solidity (Single file)');
        console.log('Compiler Version:', compilerVersion);
        console.log('Open Source License: MIT');
        console.log('Optimization: Yes, 200 runs');
        console.log('Constructor Arguments:', constructorArgs);
    }
}

main().catch(e => { console.error(e); process.exit(1); });
