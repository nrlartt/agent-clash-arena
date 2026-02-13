// ═══════════════════════════════════════════════════════════════
// CIRCLE WALLET SERVICE — User-Controlled Wallet SDK Wrapper
// Full Social Login Flow: Google Auth → Device Token → 
// User Init → Challenge → Wallet Creation
// ═══════════════════════════════════════════════════════════════

// Note: W3S SDK must be imported dynamically or checked for window object
let W3SSdk = null;

// Backend API URL
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api/v1';

// Login state keys for localStorage persistence
const STORAGE_KEYS = {
    USER_TOKEN: 'circle_user_token',
    ENCRYPTION_KEY: 'circle_encryption_key',
    DEVICE_ID: 'circle_device_id',
    WALLET_ID: 'circle_wallet_id',
    WALLET_ADDRESS: 'circle_wallet_address',
};

class CircleWalletService {
    constructor() {
        this.sdk = null;
        this.appId = import.meta.env.VITE_CIRCLE_APP_ID;
        this.initialized = false;
        this.userToken = null;
        this.encryptionKey = null;
        this.deviceId = null;
        this.walletId = null;
        this.walletAddress = null;
        this._onLoginComplete = null; // callback for wallet context

        // Restore from localStorage
        this._restoreSession();
    }

    _restoreSession() {
        try {
            this.userToken = localStorage.getItem(STORAGE_KEYS.USER_TOKEN);
            this.encryptionKey = localStorage.getItem(STORAGE_KEYS.ENCRYPTION_KEY);
            this.deviceId = localStorage.getItem(STORAGE_KEYS.DEVICE_ID);
            this.walletId = localStorage.getItem(STORAGE_KEYS.WALLET_ID);
            this.walletAddress = localStorage.getItem(STORAGE_KEYS.WALLET_ADDRESS);
        } catch {
            // localStorage not available
        }
    }

    _saveSession() {
        try {
            if (this.userToken) localStorage.setItem(STORAGE_KEYS.USER_TOKEN, this.userToken);
            if (this.encryptionKey) localStorage.setItem(STORAGE_KEYS.ENCRYPTION_KEY, this.encryptionKey);
            if (this.deviceId) localStorage.setItem(STORAGE_KEYS.DEVICE_ID, this.deviceId);
            if (this.walletId) localStorage.setItem(STORAGE_KEYS.WALLET_ID, this.walletId);
            if (this.walletAddress) localStorage.setItem(STORAGE_KEYS.WALLET_ADDRESS, this.walletAddress);
        } catch {
            // localStorage not available
        }
    }

    clearSession() {
        this.userToken = null;
        this.encryptionKey = null;
        this.deviceId = null;
        this.walletId = null;
        this.walletAddress = null;
        try {
            Object.values(STORAGE_KEYS).forEach(k => localStorage.removeItem(k));
        } catch {
            // ignore
        }
    }

    get isConfigured() {
        return !!this.appId && !!import.meta.env.VITE_GOOGLE_CLIENT_ID;
    }

    get hasSession() {
        return !!this.userToken && !!this.walletAddress;
    }

    async init() {
        if (this.initialized) return;

        // Dynamic import to avoid SSR issues
        if (typeof window !== 'undefined') {
            try {
                const module = await import("@circle-fin/w3s-pw-web-sdk");
                W3SSdk = module.W3SSdk;
            } catch (err) {
                console.warn("Circle SDK import failed:", err.message);
            }
        }

        if (!this.appId) {
            console.warn("Circle App ID missing. Social login disabled.");
            return;
        }

        this.initialized = true;
    }

    // ══════════════════════════════════════════════════════════
    // FULL LOGIN FLOW
    // Step 1: Setup SDK with Google login config
    // Step 2: User clicks Google login → SDK handles OAuth
    // Step 3: SDK callback gives us device token + user token
    // Step 4: Initialize user on backend (creates wallet if new)
    // Step 5: Execute challenge (PIN setup / wallet creation)
    // Step 6: Fetch wallet address and balance
    // ══════════════════════════════════════════════════════════

    async setupAndLogin(onComplete) {
        this._onLoginComplete = onComplete;
        await this.init();

        if (!W3SSdk) {
            onComplete(new Error("Circle SDK failed to load"), null);
            return;
        }

        try {
            const sdk = new W3SSdk({
                appSettings: { appId: this.appId },
                loginConfigs: {
                    google: {
                        clientId: import.meta.env.VITE_GOOGLE_CLIENT_ID,
                        redirectUri: window.location.origin,
                        selectAccountPrompt: true,
                    }
                }
            }, async (error, result) => {
                // This callback fires after social login completes
                if (error) {
                    console.error("[Circle] Login error:", error);
                    onComplete(error, null);
                    return;
                }

                console.log("[Circle] Login callback result:", result);

                // result contains: { userToken, encryptionKey, refreshToken }
                if (result && result.userToken) {
                    this.userToken = result.userToken;
                    this.encryptionKey = result.encryptionKey;
                    this._saveSession();

                    // Now initialize user and create wallet
                    await this._completeLogin(onComplete);
                }
            });

            this.sdk = sdk;

            // Trigger the Google login popup
            sdk.performLogin('google');
        } catch (err) {
            console.error("[Circle] Setup failed:", err);
            onComplete(err, null);
        }
    }

    async _completeLogin(onComplete) {
        try {
            // Step 4: Initialize user on our backend
            const initResult = await this.initializeUser(this.userToken);
            console.log("[Circle] User init result:", initResult);

            // If there's a challengeId, execute it (first-time wallet creation)
            if (initResult.challengeId) {
                await this._executeChallenge(initResult.challengeId, onComplete);
            } else {
                // User already initialized, fetch wallets directly
                await this._fetchAndSetWallet(onComplete);
            }
        } catch (err) {
            console.error("[Circle] Complete login error:", err);
            onComplete(err, null);
        }
    }

    async _executeChallenge(challengeId, onComplete) {
        if (!this.sdk) {
            onComplete(new Error("SDK not initialized"), null);
            return;
        }

        this.sdk.setAuthentication({
            userToken: this.userToken,
            encryptionKey: this.encryptionKey,
        });

        this.sdk.execute(challengeId, async (error, result) => {
            if (error) {
                console.error("[Circle] Challenge execution failed:", error);
                onComplete(error, null);
                return;
            }

            console.log("[Circle] Challenge completed:", result);
            // Wallet created — now fetch it
            await this._fetchAndSetWallet(onComplete);
        });
    }

    async _fetchAndSetWallet(onComplete) {
        try {
            const walletsResult = await this.getWallets(this.userToken);
            const wallets = walletsResult.wallets || [];
            console.log("[Circle] Wallets:", wallets);

            if (wallets.length > 0) {
                const wallet = wallets[0];
                this.walletId = wallet.id;
                this.walletAddress = wallet.address;
                this._saveSession();

                // Fetch balance
                let balance = '0';
                try {
                    const balResult = await this.getBalances(this.userToken, wallet.id);
                    if (balResult.tokenBalances && balResult.tokenBalances.length > 0) {
                        balance = balResult.tokenBalances[0].amount || '0';
                    }
                } catch {
                    // Balance fetch failed, default to 0
                }

                onComplete(null, {
                    address: wallet.address,
                    walletId: wallet.id,
                    balance,
                });
            } else {
                onComplete(new Error("No wallets found after initialization"), null);
            }
        } catch (err) {
            console.error("[Circle] Fetch wallet error:", err);
            onComplete(err, null);
        }
    }

    // Try to restore a previous session without re-login
    async tryRestoreSession(onComplete) {
        if (!this.userToken || !this.walletAddress) {
            onComplete(null, null); // No session to restore
            return;
        }

        try {
            // Verify the session is still valid by fetching wallets
            const walletsResult = await this.getWallets(this.userToken);
            const wallets = walletsResult.wallets || [];

            if (wallets.length > 0) {
                const wallet = wallets[0];
                let balance = '0';
                try {
                    const balResult = await this.getBalances(this.userToken, wallet.id);
                    if (balResult.tokenBalances && balResult.tokenBalances.length > 0) {
                        balance = balResult.tokenBalances[0].amount || '0';
                    }
                } catch { /* ignore */ }

                onComplete(null, {
                    address: wallet.address,
                    walletId: wallet.id,
                    balance,
                });
            } else {
                this.clearSession();
                onComplete(null, null);
            }
        } catch {
            // Session expired or invalid
            this.clearSession();
            onComplete(null, null);
        }
    }

    // ── Backend API Calls ──────────────────────────────────────

    async createDeviceToken(deviceId) {
        const res = await fetch(`${API_URL}/circle/device-token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ deviceId })
        });
        if (!res.ok) throw new Error(`Device token failed: ${res.status}`);
        return await res.json();
    }

    async initializeUser(userToken) {
        const res = await fetch(`${API_URL}/circle/initialize-user`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userToken })
        });
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            // If user already initialized, that's OK — just get wallets
            if (res.status === 409 || (data.code && data.code === 155101)) {
                return { alreadyInitialized: true };
            }
            throw new Error(data.message || `Init user failed: ${res.status}`);
        }
        return await res.json();
    }

    async getWallets(userToken) {
        const res = await fetch(`${API_URL}/circle/wallets`, {
            headers: { 'X-User-Token': userToken }
        });
        if (!res.ok) throw new Error(`Get wallets failed: ${res.status}`);
        return await res.json();
    }

    async getBalances(userToken, walletId) {
        const res = await fetch(`${API_URL}/circle/wallet/${walletId}/balances`, {
            headers: { 'X-User-Token': userToken }
        });
        if (!res.ok) throw new Error(`Get balances failed: ${res.status}`);
        return await res.json();
    }
}

export const circleService = new CircleWalletService();
