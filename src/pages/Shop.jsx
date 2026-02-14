import { useEffect, useMemo, useState } from 'react';
import { ShoppingBag, Package, Check, ArrowRightLeft } from 'lucide-react';
import { SHOP_ITEMS, RARITY, ITEM_CATEGORY, calculateEquipmentBonus } from '../data/inventory';
import { useWallet } from '../context/WalletContext';
import {
    getShopConfig,
    getMyShopAgents,
    getShopInventory,
    createShopOrder,
    getShopOrder,
    confirmShopOrder,
    equipShopItem,
    unequipShopItem,
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
    const { account } = useWallet();
    const [agents, setAgents] = useState([]);
    const [agentId, setAgentId] = useState('');
    const [inventory, setInventory] = useState(EMPTY_INVENTORY);
    const [config, setConfig] = useState(null);
    const [selectedItem, setSelectedItem] = useState(null);
    const [activeOrder, setActiveOrder] = useState(null);
    const [txHash, setTxHash] = useState('');
    const [toast, setToast] = useState(null);
    const [busy, setBusy] = useState(false);

    const selectedAgent = useMemo(() => agents.find((a) => a.id === agentId) || null, [agents, agentId]);
    const equipped = useMemo(() => Object.values(inventory.equipped || {}).filter(Boolean), [inventory]);
    const bonus = useMemo(() => calculateEquipmentBonus(equipped), [equipped]);
    const canOrder = Boolean(account && selectedAgent && config && config.payment_enabled);
    const orderForItem = activeOrder && selectedItem && activeOrder.item_id === selectedItem.id ? activeOrder : null;

    const pushToast = (type, message) => setToast({ type, message });

    useEffect(() => {
        let cancelled = false;
        getShopConfig()
            .then((data) => { if (!cancelled) setConfig(data); })
            .catch(() => { if (!cancelled) setConfig({ payment_enabled: false }); });
        return () => { cancelled = true; };
    }, []);

    useEffect(() => {
        if (!account) {
            setAgents([]);
            setAgentId('');
            setInventory(EMPTY_INVENTORY);
            return;
        }
        let cancelled = false;
        getMyShopAgents(account)
            .then((owned) => {
                if (cancelled) return;
                setAgents(owned);
                setAgentId((current) => current || (owned[0] ? owned[0].id : ''));
            })
            .catch((error) => pushToast('error', error.message || 'Agents could not load.'));
        return () => { cancelled = true; };
    }, [account]);

    useEffect(() => {
        if (!account || !agentId) {
            setInventory(EMPTY_INVENTORY);
            return;
        }
        getShopInventory(agentId, account)
            .then((data) => setInventory(hydrateInventory(data)))
            .catch((error) => pushToast('error', error.message || 'Inventory could not load.'));
    }, [account, agentId]);

    useEffect(() => {
        if (!activeOrder || activeOrder.status !== 'pending_payment' || !account) return undefined;
        const timer = setInterval(async () => {
            try {
                const data = await getShopOrder(activeOrder.id, account);
                setInventory(hydrateInventory(data.inventory));
                setActiveOrder((prev) => {
                    if (prev && prev.status === 'pending_payment' && data.order.status === 'paid') {
                        pushToast('buy_equip', 'Payment confirmed and item delivered.');
                    }
                    return data.order;
                });
            } catch { /* keep polling */ }
        }, 5000);
        return () => clearInterval(timer);
    }, [activeOrder, account]);

    useEffect(() => {
        if (!toast) return undefined;
        const timer = setTimeout(() => setToast(null), 3500);
        return () => clearTimeout(timer);
    }, [toast]);

    const createOrder = async (buyAndEquip) => {
        if (!selectedItem) return;
        if (!canOrder) {
            pushToast('error', 'Connect wallet and select owned agent first.');
            return;
        }
        setBusy(true);
        try {
            const result = await createShopOrder({
                agentId: selectedAgent.id,
                itemId: selectedItem.id,
                walletAddress: account,
                buyAndEquip,
            });
            setActiveOrder(result.order);
            setTxHash('');
            pushToast('buy', 'Order created. Pay on Telegram and confirm tx hash.');
        } catch (error) {
            pushToast('error', error.message || 'Order create failed.');
        } finally {
            setBusy(false);
        }
    };

    const confirmOrder = async () => {
        if (!activeOrder || !txHash) return;
        setBusy(true);
        try {
            const result = await confirmShopOrder(activeOrder.id, {
                walletAddress: account,
                txHash: txHash.trim(),
            });
            setActiveOrder(result.order);
            setInventory(hydrateInventory(result.inventory));
            setTxHash('');
            pushToast('buy_equip', 'Payment confirmed.');
        } catch (error) {
            pushToast('error', error.message || 'Payment confirm failed.');
        } finally {
            setBusy(false);
        }
    };

    const equipFromBackpack = async (item) => {
        if (!account || !selectedAgent || !item || item.category === 'potion') return;
        setBusy(true);
        try {
            const updated = await equipShopItem({ agentId: selectedAgent.id, walletAddress: account, itemId: item.id });
            setInventory(hydrateInventory(updated));
            pushToast('equip', `${item.name} equipped.`);
        } catch (error) {
            pushToast('error', error.message || 'Equip failed.');
        } finally {
            setBusy(false);
        }
    };

    const unequipSlot = async (slot) => {
        if (!account || !selectedAgent) return;
        setBusy(true);
        try {
            const updated = await unequipShopItem({ agentId: selectedAgent.id, walletAddress: account, slot });
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
                    <p className="shop-hero__subtitle">Telegram payment on Monad: buy, verify tx, equip.</p>
                </div>
            </div>

            <div className="shop-content container">
                <div className="shop-agent-bar card-base">
                    <div className="shop-agent-bar__left">
                        <div className="shop-agent-select">
                            <label className="shop-agent-select__label">Agent</label>
                            <div className="shop-agent-select__dropdown">
                                <select value={agentId} onChange={(e) => setAgentId(e.target.value)} disabled={!account || agents.length === 0}>
                                    {!account && <option value="">Connect wallet</option>}
                                    {account && agents.length === 0 && <option value="">No owned agents</option>}
                                    {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
                                </select>
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
                            <span>Token: <code>{activeOrder.order_token}</code></span>
                            <span>Treasury: <code>{activeOrder.treasury_address}</code></span>
                            <span>Telegram: <code>{activeOrder.payment_confirm_command}</code></span>
                        </div>
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
                                    <div className="shop-payment-box__row"><span>Token</span><code>{orderForItem.order_token}</code></div>
                                    <div className="shop-payment-box__row"><span>Treasury</span><code>{orderForItem.treasury_address}</code></div>
                                    <div className="shop-payment-box__confirm">
                                        <input className="input-field" placeholder="0x... tx hash" value={txHash} onChange={(e) => setTxHash(e.target.value)} />
                                        <button className="btn btn-primary" disabled={busy || !txHash} onClick={confirmOrder}>
                                            Confirm Payment
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
