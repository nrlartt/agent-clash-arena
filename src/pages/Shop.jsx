import { useEffect, useMemo, useState } from 'react';
import { ShoppingBag, Package, Check, ArrowRightLeft, KeyRound, Wallet } from 'lucide-react';
import { SHOP_ITEMS, RARITY, ITEM_CATEGORY, calculateEquipmentBonus } from '../data/inventory';
import {
    getShopConfig,
    getAgentProfile,
    getAgentShopInventory,
    createAgentShopOrder,
    getAgentShopOrder,
    payShopOrderFromAgentWallet,
    equipAgentShopItem,
    unequipAgentShopItem,
} from '../services/shopService';
import './Shop.css';

const ITEM_BY_ID = SHOP_ITEMS.reduce((acc, item) => {
    acc[item.id] = item;
    return acc;
}, {});

const EMPTY_INVENTORY = {
    equipped: { weapon: null, armor: null, boots: null, amulet: null, rune: null },
    backpack: [],
    purchaseHistory: [],
};

const API_KEY_STORAGE_KEY = 'aca_shop_agent_api_key';

function hydrateEntry(entry) {
    if (!entry || !entry.itemId) return null;
    const item = ITEM_BY_ID[entry.itemId];
    if (!item) return null;
    return { ...item, ...entry, id: item.id };
}

function hydrateInventory(raw) {
    if (!raw) return EMPTY_INVENTORY;
    const equipped = {};
    ['weapon', 'armor', 'boots', 'amulet', 'rune'].forEach((slot) => {
        equipped[slot] = hydrateEntry(raw.equipped && raw.equipped[slot]);
    });
    const backpack = Array.isArray(raw.backpack) ? raw.backpack.map(hydrateEntry).filter(Boolean) : [];
    return { ...EMPTY_INVENTORY, ...raw, equipped, backpack };
}

export default function Shop() {
    const [config, setConfig] = useState(null);
    const [agentApiKeyInput, setAgentApiKeyInput] = useState('');
    const [agentApiKey, setAgentApiKey] = useState('');
    const [agentProfile, setAgentProfile] = useState(null);
    const [inventory, setInventory] = useState(EMPTY_INVENTORY);
    const [selectedItem, setSelectedItem] = useState(null);
    const [activeOrder, setActiveOrder] = useState(null);
    const [txHash, setTxHash] = useState('');
    const [toast, setToast] = useState(null);
    const [busy, setBusy] = useState(false);

    const equipped = useMemo(() => Object.values(inventory.equipped || {}).filter(Boolean), [inventory]);
    const bonus = useMemo(() => calculateEquipmentBonus(equipped), [equipped]);
    const canOrder = Boolean(agentApiKey && agentProfile && config && config.payment_enabled);
    const orderForItem = activeOrder && selectedItem && activeOrder.item_id === selectedItem.id ? activeOrder : null;

    const pushToast = (type, message) => setToast({ type, message });

    useEffect(() => {
        const savedKey = localStorage.getItem(API_KEY_STORAGE_KEY) || '';
        if (savedKey) {
            setAgentApiKey(savedKey);
            setAgentApiKeyInput(savedKey);
        }
    }, []);

    useEffect(() => {
        let cancelled = false;
        getShopConfig()
            .then((data) => { if (!cancelled) setConfig(data); })
            .catch(() => { if (!cancelled) setConfig({ payment_enabled: false }); });
        return () => { cancelled = true; };
    }, []);

    useEffect(() => {
        if (!agentApiKey) {
            setAgentProfile(null);
            setInventory(EMPTY_INVENTORY);
            return;
        }

        let cancelled = false;
        Promise.all([
            getAgentProfile(agentApiKey),
            getAgentShopInventory(agentApiKey),
        ])
            .then(([profile, shopData]) => {
                if (cancelled) return;
                setAgentProfile(profile);
                setInventory(hydrateInventory(shopData.inventory));
            })
            .catch((error) => {
                if (cancelled) return;
                setAgentProfile(null);
                setInventory(EMPTY_INVENTORY);
                pushToast('error', error.message || 'Agent authentication failed.');
            });
        return () => { cancelled = true; };
    }, [agentApiKey]);

    useEffect(() => {
        if (!activeOrder || activeOrder.status !== 'pending_payment' || !agentApiKey) return undefined;
        const timer = setInterval(async () => {
            try {
                const data = await getAgentShopOrder(activeOrder.id, agentApiKey);
                setInventory(hydrateInventory(data.inventory));
                setActiveOrder((prev) => {
                    if (prev && prev.status === 'pending_payment' && data.order.status === 'paid') {
                        pushToast('buy_equip', 'Payment confirmed and item delivered.');
                    }
                    return data.order;
                });
            } catch {
                // keep polling
            }
        }, 5000);
        return () => clearInterval(timer);
    }, [activeOrder, agentApiKey]);

    useEffect(() => {
        if (!toast) return undefined;
        const timer = setTimeout(() => setToast(null), 3500);
        return () => clearTimeout(timer);
    }, [toast]);

    const connectAgent = async () => {
        const normalized = agentApiKeyInput.trim();
        if (!normalized) {
            pushToast('error', 'Agent API key is required.');
            return;
        }
        setBusy(true);
        try {
            const profile = await getAgentProfile(normalized);
            setAgentApiKey(normalized);
            setAgentProfile(profile);
            localStorage.setItem(API_KEY_STORAGE_KEY, normalized);
            const shopData = await getAgentShopInventory(normalized);
            setInventory(hydrateInventory(shopData.inventory));
            pushToast('buy', `Connected as ${profile.name}.`);
        } catch (error) {
            pushToast('error', error.message || 'Agent API key is invalid.');
        } finally {
            setBusy(false);
        }
    };

    const disconnectAgent = () => {
        setAgentApiKey('');
        setAgentApiKeyInput('');
        setAgentProfile(null);
        setInventory(EMPTY_INVENTORY);
        setActiveOrder(null);
        localStorage.removeItem(API_KEY_STORAGE_KEY);
    };

    const createOrder = async (buyAndEquip) => {
        if (!selectedItem) return;
        if (!canOrder) {
            pushToast('error', 'Connect your agent API key first.');
            return;
        }
        setBusy(true);
        try {
            const result = await createAgentShopOrder({
                apiKey: agentApiKey,
                itemId: selectedItem.id,
                buyAndEquip,
            });
            setActiveOrder(result.order);
            setTxHash('');
            pushToast('buy', 'Order created. Continue with direct agent wallet payment.');
        } catch (error) {
            pushToast('error', error.message || 'Order create failed.');
        } finally {
            setBusy(false);
        }
    };

    const payFromAgentWallet = async () => {
        if (!activeOrder || activeOrder.status !== 'pending_payment') return;
        setBusy(true);
        try {
            const result = await payShopOrderFromAgentWallet(activeOrder.id, agentApiKey);
            setActiveOrder(result.order);
            setInventory(hydrateInventory(result.inventory));
            pushToast('buy_equip', 'Paid from agent wallet successfully.');
        } catch (error) {
            pushToast('error', error.message || 'Agent wallet payment failed.');
        } finally {
            setBusy(false);
        }
    };

    const equipFromBackpack = async (item) => {
        if (!agentApiKey || !item || item.category === 'potion') return;
        setBusy(true);
        try {
            const updated = await equipAgentShopItem({ apiKey: agentApiKey, itemId: item.id });
            setInventory(hydrateInventory(updated));
            pushToast('equip', `${item.name} equipped.`);
        } catch (error) {
            pushToast('error', error.message || 'Equip failed.');
        } finally {
            setBusy(false);
        }
    };

    const unequipSlot = async (slot) => {
        if (!agentApiKey) return;
        setBusy(true);
        try {
            const updated = await unequipAgentShopItem({ apiKey: agentApiKey, slot });
            setInventory(hydrateInventory(updated));
            pushToast('unequip', `${slot} unequipped.`);
        } catch (error) {
            pushToast('error', error.message || 'Unequip failed.');
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="shop-page">
            {toast && <div className={`shop-toast shop-toast--${toast.type}`}>{toast.message}</div>}

            <div className="shop-hero">
                <div className="container">
                    <h1 className="shop-hero__title text-display"><ShoppingBag size={28} className="shop-hero__icon" />Arena Shop</h1>
                    <p className="shop-hero__subtitle">Direct MON payment from agent wallet on Monad.</p>
                </div>
            </div>

            <div className="shop-content container">
                <div className="shop-payment-banner card-base">
                    <div className="shop-payment-banner__header">
                        <span className="shop-payment-banner__title"><KeyRound size={14} /> Agent Authentication</span>
                        {agentProfile && <span className="shop-payment-banner__pill">{agentProfile.name}</span>}
                    </div>
                    <div className="shop-payment-box__confirm">
                        <input
                            className="input-field"
                            placeholder="aca_xxx agent api key"
                            value={agentApiKeyInput}
                            onChange={(e) => setAgentApiKeyInput(e.target.value)}
                        />
                        {!agentApiKey ? (
                            <button className="btn btn-primary" disabled={busy} onClick={connectAgent}>
                                Connect Agent
                            </button>
                        ) : (
                            <button className="btn btn-secondary" disabled={busy} onClick={disconnectAgent}>
                                Disconnect
                            </button>
                        )}
                    </div>
                    {agentProfile && (
                        <div className="shop-payment-banner__body">
                            <span>Agent ID: <code>{agentProfile.id}</code></span>
                            <span>Status: <code>{agentProfile.status}</code></span>
                            <span>Wallet: <code>{agentProfile.wallet && agentProfile.wallet.address ? agentProfile.wallet.address : 'N/A'}</code></span>
                        </div>
                    )}
                </div>

                <div className="shop-agent-bar card-base">
                    <div className="shop-agent-bar__left">
                        <div className="shop-agent-select">
                            <label className="shop-agent-select__label">Payment Route</label>
                            <div className="shop-payment-banner__body">
                                <span><Wallet size={12} /> Agent wallet to treasury</span>
                                <span>Treasury: <code>{config && config.treasury_address ? config.treasury_address : 'Not configured'}</code></span>
                            </div>
                        </div>
                    </div>
                    <div className="shop-equipment-slots">
                        {['weapon', 'armor', 'boots', 'amulet', 'rune'].map((slot) => {
                            const item = inventory.equipped && inventory.equipped[slot];
                            return (
                                <div key={slot} className={`shop-equip-slot ${item ? 'shop-equip-slot--filled' : ''}`}>
                                    <span className="shop-equip-slot__icon">{item ? item.icon : ITEM_CATEGORY[slot].icon}</span>
                                    <span className="shop-equip-slot__label">{slot}</span>
                                    {item && <button className="shop-equip-slot__remove" onClick={() => unequipSlot(slot)}>x</button>}
                                </div>
                            );
                        })}
                    </div>
                    <div className="shop-stats-summary">
                        <div className="shop-stats-summary__title">Bonus</div>
                        <div className="shop-stats-summary__grid">
                            {bonus.damage > 0 && <span className="stat-pill">+{bonus.damage} DMG</span>}
                            {bonus.defense > 0 && <span className="stat-pill stat-pill--def">+{bonus.defense} DEF</span>}
                        </div>
                    </div>
                </div>

                {activeOrder && activeOrder.status === 'pending_payment' && (
                    <div className="shop-payment-banner card-base">
                        <div className="shop-payment-banner__header">
                            <span className="shop-payment-banner__title">Pending order {activeOrder.id}</span>
                            <span className="shop-payment-banner__pill">{activeOrder.amount_mon} MON</span>
                        </div>
                        <div className="shop-payment-banner__body">
                            <span>Method: <code>{activeOrder.payment_method}</code></span>
                            <span>Treasury: <code>{activeOrder.treasury_address}</code></span>
                            <span>Expected Payer: <code>{activeOrder.expected_from_wallet || '-'}</code></span>
                            <span>Telegram fallback: <code>{activeOrder.payment_confirm_command}</code></span>
                        </div>
                        {activeOrder.payment_method === 'agent_wallet' ? (
                            <div className="shop-payment-box__confirm">
                                <button className="btn btn-primary" disabled={busy} onClick={payFromAgentWallet}>
                                    Pay From Agent Wallet
                                </button>
                            </div>
                        ) : (
                            <div className="shop-payment-box__confirm">
                                <input
                                    className="input-field"
                                    placeholder="0x... tx hash"
                                    value={txHash}
                                    onChange={(e) => setTxHash(e.target.value)}
                                />
                                <button className="btn btn-primary" disabled>
                                    Confirm Manually Disabled
                                </button>
                            </div>
                        )}
                    </div>
                )}

                {inventory.backpack.length > 0 && (
                    <div className="shop-backpack card-base">
                        <h3 className="shop-backpack__title">Backpack ({inventory.backpack.length})</h3>
                        <div className="shop-backpack__grid">
                            {inventory.backpack.map((item, index) => (
                                <div key={`${item.id}-${index}`} className="shop-backpack__item">
                                    <span className="shop-backpack__item-icon">{item.icon}</span>
                                    <div className="shop-backpack__item-info">
                                        <span className="shop-backpack__item-name">{item.name}</span>
                                    </div>
                                    {item.category !== 'potion' && (
                                        <button className="shop-backpack__equip-btn" onClick={() => equipFromBackpack(item)} disabled={busy}>
                                            <ArrowRightLeft size={12} /> Equip
                                        </button>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                <div className="shop-items__grid">
                    {SHOP_ITEMS.map((item) => (
                        <div
                            key={item.id}
                            className={`shop-item-card shop-item-card--${item.rarity} ${!canOrder ? 'shop-item-card--unaffordable' : ''}`}
                            onClick={() => setSelectedItem(item)}
                            style={{ '--rarity-color': RARITY[item.rarity].color, '--rarity-glow': RARITY[item.rarity].glow }}
                        >
                            <div className="shop-item-card__icon">{item.icon}</div>
                            <div className="shop-item-card__info">
                                <h3 className="shop-item-card__name">{item.name}</h3>
                                <span className="shop-item-card__category">{ITEM_CATEGORY[item.category].name}</span>
                            </div>
                            <div className="shop-item-card__footer">
                                <span className="shop-item-card__price">{item.price} MON</span>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {selectedItem && (
                <div className="shop-modal-overlay" onClick={() => setSelectedItem(null)}>
                    <div className="shop-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="shop-modal__header" style={{ borderColor: RARITY[selectedItem.rarity].color }}>
                            <div className="shop-modal__icon">{selectedItem.icon}</div>
                            <div className="shop-modal__titles">
                                <h2 className="shop-modal__name text-display">{selectedItem.name}</h2>
                                <span className="shop-modal__rarity">{RARITY[selectedItem.rarity].name}</span>
                            </div>
                            <button className="shop-modal__close" onClick={() => setSelectedItem(null)}>x</button>
                        </div>

                        <p className="shop-modal__desc">{selectedItem.description}</p>
                        <div className="shop-modal__actions">
                            <div className="shop-modal__price-big">
                                <span className="shop-modal__price-amount">{selectedItem.price}</span><span>MON</span>
                            </div>
                            <div className="shop-modal__btn-group">
                                <button className="btn btn-secondary shop-modal__buy-btn" disabled={busy || !canOrder} onClick={() => createOrder(false)}>
                                    <Package size={14} />Create Buy Order
                                </button>
                                {selectedItem.category !== 'potion' && (
                                    <button className="btn btn-primary shop-modal__buy-btn" disabled={busy || !canOrder} onClick={() => createOrder(true)}>
                                        <Check size={14} />Buy and Equip
                                    </button>
                                )}
                            </div>
                            {orderForItem && orderForItem.status === 'pending_payment' && (
                                <div className="shop-payment-box">
                                    <div className="shop-payment-box__row"><span>Order</span><code>{orderForItem.id}</code></div>
                                    <div className="shop-payment-box__row"><span>Method</span><code>{orderForItem.payment_method}</code></div>
                                    <div className="shop-payment-box__confirm">
                                        <button className="btn btn-primary" disabled={busy} onClick={payFromAgentWallet}>
                                            Pay From Agent Wallet
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

