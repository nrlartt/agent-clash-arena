const { ethers } = require('ethers');
const logger = require('./logger');

const BETTING_ABI = [
    'function platformEarnings() external view returns (uint256)',
    'function withdrawFees(address _to) external',
    'function owner() external view returns (address)',
];

const LENS_ABI = [
    'function isLocked(address _token) external view returns (bool)',
    'function getAmountOut(address _token, uint256 _amountIn, bool _isBuy) external view returns (address router, uint256 amountOut)',
];

const ROUTER_ABI = [
    'function buy((uint256 amountOutMin,address token,address to,uint256 deadline) params) external payable',
];

const ERC20_ABI = [
    'function balanceOf(address account) external view returns (uint256)',
    'function transfer(address to, uint256 amount) external returns (bool)',
    'function burn(uint256 amount) external',
    'function decimals() external view returns (uint8)',
];

const DEFAULT_CLASH_TOKEN = '0x6e3E3931420fA841a3943b32D13e6d63Fe047777';
const DEFAULT_DEAD_ADDRESS = '0x000000000000000000000000000000000000dEaD';
const DEFAULT_NAD_LENS = '0x16c92fF54fAE4EA4207F438fB154764b5DF2D1b1';
const DEFAULT_RPC_URL = 'https://rpc.monad.xyz';

function parseBool(value, fallback = false) {
    if (typeof value === 'boolean') return value;
    if (typeof value !== 'string') return fallback;
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
    return fallback;
}

function parseNumber(value, fallback, min = 0) {
    const parsed = Number.parseFloat(String(value ?? ''));
    if (!Number.isFinite(parsed) || parsed < min) return fallback;
    return parsed;
}

function trimError(err) {
    const msg = err?.reason || err?.shortMessage || err?.message || String(err || 'Unknown error');
    return String(msg).slice(0, 300);
}

class BuybackService {
    constructor({ db, io }) {
        this.db = db;
        this.io = io;
        this.timer = null;
        this.inFlight = false;
        this.runtime = {
            enabled: false,
            initialized: false,
            signerAddress: null,
            signerIsContractOwner: null,
            lastRunAt: null,
            lastSuccessAt: null,
            lastError: null,
            lastErrorAt: null,
            lastRunResult: null,
        };

        this._init();
    }

    _init() {
        this.enabled = parseBool(process.env.BUYBACK_ENABLED, false);
        this.rpcUrl = process.env.MONAD_RPC_URL || DEFAULT_RPC_URL;
        this.expectedChainId = Number.parseInt(process.env.MONAD_CHAIN_ID || '143', 10);

        this.intervalMs = Math.max(60_000, Number.parseInt(process.env.BUYBACK_INTERVAL_MS || '1800000', 10));
        this.minFeesToWithdrawMON = parseNumber(process.env.BUYBACK_MIN_PLATFORM_FEES_MON, 3, 0);
        this.minSpendMON = parseNumber(process.env.BUYBACK_MIN_SPEND_MON, 1, 0);
        this.maxSpendMON = parseNumber(process.env.BUYBACK_MAX_SPEND_MON, 100, 0.000001);
        this.gasReserveMON = parseNumber(process.env.BUYBACK_GAS_RESERVE_MON, 0.05, 0);
        this.spendBps = Math.min(10000, Math.max(1, Number.parseInt(process.env.BUYBACK_SPEND_BPS || '6000', 10)));
        this.slippageBps = Math.min(5000, Math.max(1, Number.parseInt(process.env.BUYBACK_SLIPPAGE_BPS || '300', 10)));
        this.burnBps = Math.min(10000, Math.max(0, Number.parseInt(process.env.BUYBACK_BURN_BPS || '10000', 10)));
        this.deadlineSeconds = Math.max(60, Number.parseInt(process.env.BUYBACK_DEADLINE_SECONDS || '300', 10));

        this.bettingContractAddress = process.env.BETTING_CONTRACT_ADDRESS || process.env.VITE_BETTING_CONTRACT_ADDRESS || '';
        this.clashTokenAddress = process.env.CLASH_TOKEN_ADDRESS || DEFAULT_CLASH_TOKEN;
        this.nadLensAddress = process.env.NAD_LENS_ADDRESS || DEFAULT_NAD_LENS;
        this.deadAddress = process.env.BUYBACK_BURN_ADDRESS || DEFAULT_DEAD_ADDRESS;
        this.signerPrivateKey = process.env.BUYBACK_SIGNER_PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY || process.env.OPERATOR_PRIVATE_KEY || '';

        if (!this.enabled) {
            logger.info('[Buyback] Disabled by BUYBACK_ENABLED=false');
            return;
        }

        if (!this.signerPrivateKey || !this.bettingContractAddress || !ethers.isAddress(this.clashTokenAddress) || !ethers.isAddress(this.nadLensAddress)) {
            logger.error('[Buyback] Missing required config; disabling service', {
                hasSignerKey: !!this.signerPrivateKey,
                hasBettingContract: !!this.bettingContractAddress,
                clashTokenAddress: this.clashTokenAddress,
                nadLensAddress: this.nadLensAddress,
            });
            this.enabled = false;
            return;
        }

        try {
            this.provider = new ethers.JsonRpcProvider(this.rpcUrl);
            this.wallet = new ethers.Wallet(this.signerPrivateKey, this.provider);
            this.bettingContract = new ethers.Contract(this.bettingContractAddress, BETTING_ABI, this.wallet);
            this.nadLens = new ethers.Contract(this.nadLensAddress, LENS_ABI, this.provider);
            this.clashToken = new ethers.Contract(this.clashTokenAddress, ERC20_ABI, this.wallet);
            this.withdrawTarget = this.wallet.address;
            this.runtime.enabled = true;
            this.runtime.initialized = true;
            this.runtime.signerAddress = this.wallet.address;
            logger.info('[Buyback] Initialized', {
                signer: this.wallet.address,
                bettingContract: this.bettingContractAddress,
                clashToken: this.clashTokenAddress,
                nadLens: this.nadLensAddress,
                intervalMs: this.intervalMs,
            });
        } catch (err) {
            logger.error('[Buyback] Init failed; disabling service', { error: trimError(err) });
            this.enabled = false;
            this.runtime.enabled = false;
        }
    }

    start() {
        if (!this.enabled || !this.runtime.initialized) return;
        if (this.timer) return;
        this.timer = setInterval(() => {
            this.runNow('scheduled').catch((err) => {
                logger.warn('[Buyback] Scheduled run failed', { error: trimError(err) });
            });
        }, this.intervalMs);
        logger.info('[Buyback] Scheduler started', { intervalMs: this.intervalMs });
    }

    stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    async getStatus() {
        const base = {
            ...this.runtime,
            config: {
                intervalMs: this.intervalMs,
                minFeesToWithdrawMON: this.minFeesToWithdrawMON,
                minSpendMON: this.minSpendMON,
                maxSpendMON: this.maxSpendMON,
                spendBps: this.spendBps,
                burnBps: this.burnBps,
                slippageBps: this.slippageBps,
                bettingContractAddress: this.bettingContractAddress || null,
                clashTokenAddress: this.clashTokenAddress || null,
                nadLensAddress: this.nadLensAddress || null,
                signerAddress: this.wallet?.address || null,
            },
        };
        if (!this.enabled || !this.wallet || !this.provider) return base;

        try {
            const [network, signerBalance, platformFees] = await Promise.all([
                this.provider.getNetwork(),
                this.provider.getBalance(this.wallet.address),
                this.bettingContract.platformEarnings().catch(() => 0n),
            ]);
            let owner = null;
            try {
                owner = await this.bettingContract.owner();
                this.runtime.signerIsContractOwner = String(owner).toLowerCase() === String(this.wallet.address).toLowerCase();
            } catch {
                owner = null;
                this.runtime.signerIsContractOwner = null;
            }
            return {
                ...base,
                chainId: Number(network.chainId),
                signerBalanceMON: ethers.formatEther(signerBalance),
                platformFeesMON: ethers.formatEther(platformFees),
                contractOwner: owner,
                inFlight: this.inFlight,
            };
        } catch (err) {
            return {
                ...base,
                statusReadError: trimError(err),
            };
        }
    }

    async runNow(reason = 'manual') {
        if (!this.enabled || !this.runtime.initialized) {
            return { ok: false, skipped: true, reason: 'DISABLED' };
        }
        if (this.inFlight) {
            return { ok: false, skipped: true, reason: 'ALREADY_RUNNING' };
        }

        this.inFlight = true;
        try {
            const result = await this._runCycle(reason);
            this.runtime.lastRunAt = Date.now();
            this.runtime.lastRunResult = result;
            if (result.ok) {
                this.runtime.lastSuccessAt = Date.now();
                this.runtime.lastError = null;
                this.runtime.lastErrorAt = null;
            } else if (!result.skipped) {
                this.runtime.lastError = result.error || 'Buyback run failed';
                this.runtime.lastErrorAt = Date.now();
            }
            return result;
        } finally {
            this.inFlight = false;
        }
    }

    async _ensureChain() {
        const network = await this.provider.getNetwork();
        const chainId = Number(network.chainId);
        if (Number.isFinite(this.expectedChainId) && chainId !== this.expectedChainId) {
            throw new Error(`Chain mismatch: expected ${this.expectedChainId}, got ${chainId}`);
        }
        return chainId;
    }

    async _runCycle(reason) {
        const startedAt = Date.now();
        const run = {
            id: `buyback-${startedAt}`,
            reason,
            status: 'skipped',
            startedAt,
            finishedAt: null,
            chainId: null,
            monSpentMON: 0,
            clashBought: 0,
            clashBurned: 0,
            platformFeesMON: 0,
            signerBalanceBeforeMON: 0,
            signerBalanceAfterMON: 0,
            withdrawTxHash: null,
            buyTxHash: null,
            burnTxHash: null,
            burnMethod: null,
            router: null,
            error: null,
        };

        try {
            run.chainId = await this._ensureChain();
            try {
                const owner = await this.bettingContract.owner();
                const signerIsOwner = String(owner).toLowerCase() === String(this.wallet.address).toLowerCase();
                this.runtime.signerIsContractOwner = signerIsOwner;
                if (!signerIsOwner) {
                    throw new Error(`Buyback signer is not contract owner (${this.wallet.address})`);
                }
            } catch (ownerErr) {
                const maybeMissingOwnerRead = trimError(ownerErr);
                if (!/not a function|missing revert data|does not exist/i.test(maybeMissingOwnerRead)) {
                    throw ownerErr;
                }
                this.runtime.signerIsContractOwner = null;
            }

            const platformFeesWei = await this.bettingContract.platformEarnings();
            run.platformFeesMON = Number.parseFloat(ethers.formatEther(platformFeesWei));
            const minFeesWei = ethers.parseEther(this.minFeesToWithdrawMON.toFixed(18));
            if (platformFeesWei < minFeesWei) {
                run.status = 'skipped';
                run.error = `Platform fees below threshold (${run.platformFeesMON.toFixed(6)} MON)`;
                run.finishedAt = Date.now();
                await this._persistRun(run);
                return { ok: false, skipped: true, reason: 'LOW_PLATFORM_FEES', run };
            }

            const signerBalanceBefore = await this.provider.getBalance(this.wallet.address);
            run.signerBalanceBeforeMON = Number.parseFloat(ethers.formatEther(signerBalanceBefore));

            const withdrawTx = await this.bettingContract.withdrawFees(this.withdrawTarget, { gasLimit: 180000 });
            const withdrawReceipt = await withdrawTx.wait();
            run.withdrawTxHash = withdrawReceipt.hash;

            const signerBalancePostWithdraw = await this.provider.getBalance(this.wallet.address);
            const gasReserveWei = ethers.parseEther(this.gasReserveMON.toFixed(18));
            const spendableWei = signerBalancePostWithdraw > gasReserveWei
                ? signerBalancePostWithdraw - gasReserveWei
                : 0n;

            const spendFromFeesWei = (platformFeesWei * BigInt(this.spendBps)) / 10000n;
            const maxSpendWei = ethers.parseEther(this.maxSpendMON.toFixed(18));
            const minSpendWei = ethers.parseEther(this.minSpendMON.toFixed(18));
            let spendWei = spendFromFeesWei;
            if (spendWei > maxSpendWei) spendWei = maxSpendWei;
            if (spendWei > spendableWei) spendWei = spendableWei;

            if (spendWei < minSpendWei || spendWei <= 0n) {
                run.status = 'skipped';
                run.error = 'Spendable amount below min buyback threshold after gas reserve';
                run.finishedAt = Date.now();
                await this._persistRun(run);
                return { ok: false, skipped: true, reason: 'LOW_SPENDABLE_BALANCE', run };
            }

            const tokenLocked = await this.nadLens.isLocked(this.clashTokenAddress);
            if (tokenLocked) {
                run.status = 'skipped';
                run.error = 'Token is locked on Nad.fun router';
                run.finishedAt = Date.now();
                await this._persistRun(run);
                return { ok: false, skipped: true, reason: 'TOKEN_LOCKED', run };
            }

            const [routerAddress, expectedOut] = await this.nadLens.getAmountOut(this.clashTokenAddress, spendWei, true);
            run.router = routerAddress;
            if (!ethers.isAddress(routerAddress) || expectedOut <= 0n) {
                run.status = 'skipped';
                run.error = 'Nad.fun quote returned invalid router or amount';
                run.finishedAt = Date.now();
                await this._persistRun(run);
                return { ok: false, skipped: true, reason: 'INVALID_QUOTE', run };
            }

            const router = new ethers.Contract(routerAddress, ROUTER_ABI, this.wallet);
            const tokenDecimals = await this.clashToken.decimals().catch(() => 18);
            const tokenBalanceBefore = await this.clashToken.balanceOf(this.wallet.address);

            const minOut = (expectedOut * BigInt(10000 - this.slippageBps)) / 10000n;
            const deadline = Math.floor(Date.now() / 1000) + this.deadlineSeconds;

            const buyTx = await router.buy({
                amountOutMin: minOut,
                token: this.clashTokenAddress,
                to: this.wallet.address,
                deadline,
            }, {
                value: spendWei,
                gasLimit: 800000,
            });
            const buyReceipt = await buyTx.wait();
            run.buyTxHash = buyReceipt.hash;

            const tokenBalanceAfter = await this.clashToken.balanceOf(this.wallet.address);
            const boughtAmount = tokenBalanceAfter > tokenBalanceBefore ? tokenBalanceAfter - tokenBalanceBefore : 0n;
            const burnAmount = (boughtAmount * BigInt(this.burnBps)) / 10000n;

            run.monSpentMON = Number.parseFloat(ethers.formatEther(spendWei));
            run.clashBought = Number.parseFloat(ethers.formatUnits(boughtAmount, tokenDecimals));

            if (burnAmount > 0n) {
                try {
                    const burnTx = await this.clashToken.burn(burnAmount, { gasLimit: 160000 });
                    const burnReceipt = await burnTx.wait();
                    run.burnTxHash = burnReceipt.hash;
                    run.burnMethod = 'burn';
                } catch (burnErr) {
                    const transferTx = await this.clashToken.transfer(this.deadAddress, burnAmount, { gasLimit: 160000 });
                    const transferReceipt = await transferTx.wait();
                    run.burnTxHash = transferReceipt.hash;
                    run.burnMethod = 'transfer_dead';
                    logger.warn('[Buyback] burn() unavailable, used transfer to dead address', { error: trimError(burnErr) });
                }
                run.clashBurned = Number.parseFloat(ethers.formatUnits(burnAmount, tokenDecimals));
            }

            const signerBalanceAfter = await this.provider.getBalance(this.wallet.address);
            run.signerBalanceAfterMON = Number.parseFloat(ethers.formatEther(signerBalanceAfter));
            run.status = 'success';
            run.finishedAt = Date.now();

            await this._persistRun(run);
            await this._emitSuccessActivity(run);

            return { ok: true, run };
        } catch (err) {
            run.status = 'failed';
            run.error = trimError(err);
            run.finishedAt = Date.now();
            await this._persistRun(run);
            await this._emitFailedActivity(run);
            return { ok: false, skipped: false, error: run.error, run };
        }
    }

    async _persistRun(run) {
        if (typeof this.db?.recordTokenomicsRun !== 'function') return;
        try {
            await this.db.recordTokenomicsRun(run);
        } catch (err) {
            logger.warn('[Buyback] Failed to persist run', { error: trimError(err) });
        }
    }

    async _emitSuccessActivity(run) {
        if (typeof this.db?.addActivity === 'function') {
            const message = `Buyback executed: ${run.monSpentMON.toFixed(4)} MON -> ${run.clashBought.toFixed(4)} CLASH, burned ${run.clashBurned.toFixed(4)} CLASH`;
            await this.db.addActivity({
                type: 'buyback',
                icon: 'BURN',
                color: '#FF6B35',
                message,
                time: Date.now(),
            }).catch(() => null);
        }

        if (this.io) {
            this.io.emit('arena:live_event', {
                type: 'buyback',
                icon: 'BURN',
                color: '#FF6B35',
                text: `Buyback ${run.monSpentMON.toFixed(2)} MON, burned ${run.clashBurned.toFixed(2)} CLASH`,
                timestamp: Date.now(),
            });
        }
    }

    async _emitFailedActivity(run) {
        if (typeof this.db?.addActivity === 'function') {
            await this.db.addActivity({
                type: 'buyback_error',
                icon: 'WARN',
                color: '#FF2D78',
                message: `Buyback failed: ${run.error || 'Unknown error'}`,
                time: Date.now(),
            }).catch(() => null);
        }
    }
}

module.exports = BuybackService;
