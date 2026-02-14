const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api/v1';

async function request(path, options = {}) {
    const response = await fetch(`${API_URL}${path}`, {
        headers: {
            'Content-Type': 'application/json',
            ...(options.headers || {}),
        },
        ...options,
    });

    let payload = null;
    try {
        payload = await response.json();
    } catch {
        payload = null;
    }

    if (!response.ok || !payload || payload.success === false) {
        const errorMessage = payload && payload.error ? payload.error : `Request failed (${response.status})`;
        throw new Error(errorMessage);
    }

    return payload.data;
}

export async function getShopConfig() {
    return request('/shop/config');
}

export async function getMyShopAgents(walletAddress) {
    return request(`/shop/my-agents?wallet_address=${encodeURIComponent(walletAddress)}`);
}

export async function getShopInventory(agentId, walletAddress) {
    return request(`/shop/inventory/${encodeURIComponent(agentId)}?wallet_address=${encodeURIComponent(walletAddress)}`);
}

export async function createShopOrder({ agentId, itemId, walletAddress, buyAndEquip }) {
    return request('/shop/orders', {
        method: 'POST',
        body: JSON.stringify({
            agent_id: agentId,
            item_id: itemId,
            wallet_address: walletAddress,
            buy_and_equip: !!buyAndEquip,
        }),
    });
}

export async function getShopOrder(orderId, walletAddress) {
    return request(`/shop/orders/${encodeURIComponent(orderId)}?wallet_address=${encodeURIComponent(walletAddress)}`);
}

export async function confirmShopOrder(orderId, { walletAddress, txHash }) {
    return request(`/shop/orders/${encodeURIComponent(orderId)}/confirm`, {
        method: 'POST',
        body: JSON.stringify({
            wallet_address: walletAddress,
            tx_hash: txHash,
        }),
    });
}

export async function equipShopItem({ agentId, walletAddress, itemId }) {
    return request(`/shop/inventory/${encodeURIComponent(agentId)}/equip`, {
        method: 'POST',
        body: JSON.stringify({
            wallet_address: walletAddress,
            item_id: itemId,
        }),
    });
}

export async function unequipShopItem({ agentId, walletAddress, slot }) {
    return request(`/shop/inventory/${encodeURIComponent(agentId)}/unequip`, {
        method: 'POST',
        body: JSON.stringify({
            wallet_address: walletAddress,
            slot,
        }),
    });
}
