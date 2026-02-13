// ═══════════════════════════════════════════════════════════════
// SHOP PAGE v2 — With real purchase system via InventoryContext
// ═══════════════════════════════════════════════════════════════

import { useState, useMemo, useEffect } from 'react';
import { ShoppingBag, Filter, Sparkles, Shield, Sword, Footprints, Gem, FlaskConical, Search, ChevronDown, TrendingUp, Star, Package, Check, X, ArrowRightLeft } from 'lucide-react';
import { SHOP_ITEMS, RARITY, ITEM_CATEGORY, calculateEquipmentBonus } from '../data/inventory';
import { AGENTS } from '../data/mockData';
import { useInventory } from '../context/InventoryContext';
import './Shop.css';

const CATEGORY_ICONS = {
    all: <Sparkles size={16} />,
    weapon: <Sword size={16} />,
    armor: <Shield size={16} />,
    boots: <Footprints size={16} />,
    amulet: <Gem size={16} />,
    rune: <Sparkles size={16} />,
    potion: <FlaskConical size={16} />,
};

export default function Shop() {
    const [selectedCategory, setSelectedCategory] = useState('all');
    const [selectedRarity, setSelectedRarity] = useState('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedItem, setSelectedItem] = useState(null);
    const [selectedAgent, setSelectedAgent] = useState(AGENTS.find(a => a.owner) || AGENTS[0]);
    const [sortBy, setSortBy] = useState('price-asc');
    const [toast, setToast] = useState(null);

    const { inventories, buyItem, buyAndEquip, equipItem, unequipItem, canAfford, lastAction, clearAction } = useInventory();

    // Show toast on purchase/equip actions
    useEffect(() => {
        if (lastAction) {
            setToast(lastAction);
            const timer = setTimeout(() => {
                setToast(null);
                clearAction();
            }, 3000);
            return () => clearTimeout(timer);
        }
    }, [lastAction, clearAction]);

    const agentInventory = inventories[selectedAgent.id];
    const equippedItems = agentInventory ? Object.values(agentInventory.equipped).filter(Boolean) : [];
    const equipmentBonus = calculateEquipmentBonus(equippedItems);

    const filteredItems = useMemo(() => {
        let items = [...SHOP_ITEMS];

        if (selectedCategory !== 'all') {
            items = items.filter(i => i.category === selectedCategory);
        }
        if (selectedRarity !== 'all') {
            items = items.filter(i => i.rarity === selectedRarity);
        }
        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            items = items.filter(i =>
                i.name.toLowerCase().includes(q) ||
                i.description.toLowerCase().includes(q)
            );
        }

        switch (sortBy) {
            case 'price-asc': items.sort((a, b) => a.price - b.price); break;
            case 'price-desc': items.sort((a, b) => b.price - a.price); break;
            case 'rarity': {
                const rarityOrder = { legendary: 0, epic: 1, rare: 2, uncommon: 3, common: 4 };
                items.sort((a, b) => rarityOrder[a.rarity] - rarityOrder[b.rarity]);
                break;
            }
            default: break;
        }

        return items;
    }, [selectedCategory, selectedRarity, searchQuery, sortBy]);

    const categories = [
        { id: 'all', name: 'All Items', count: SHOP_ITEMS.length },
        ...Object.entries(ITEM_CATEGORY).map(([id, cat]) => ({
            id,
            name: cat.name,
            count: SHOP_ITEMS.filter(i => i.category === id).length,
        })),
    ];

    // ── Purchase handlers ──
    const handleBuy = () => {
        if (!selectedItem || !agentInventory) return;
        buyItem(selectedAgent.id, selectedItem);
    };

    const handleBuyAndEquip = () => {
        if (!selectedItem || !agentInventory) return;
        buyAndEquip(selectedAgent.id, selectedItem);
        setSelectedItem(null);
    };

    const handleUnequip = (slot) => {
        if (!agentInventory?.equipped?.[slot]) return;
        unequipItem(selectedAgent.id, slot);
    };

    const handleEquipFromBackpack = (item) => {
        const slot = item.category;
        if (!slot || slot === 'potion') return;
        equipItem(selectedAgent.id, item, slot);
    };

    const affordable = selectedItem ? canAfford(selectedAgent.id, selectedItem.price) : false;

    return (
        <div className="shop-page" id="shop-page">
            {/* Toast Notification */}
            {toast && (
                <div className={`shop-toast shop-toast--${toast.type}`} id="shop-toast">
                    <span className="shop-toast__icon">
                        {toast.type === 'buy' || toast.type === 'buy_equip' ? '🛒' :
                            toast.type === 'equip' ? '⚔️' :
                                toast.type === 'unequip' ? '📦' : '💰'}
                    </span>
                    <span className="shop-toast__message">{toast.message}</span>
                </div>
            )}

            {/* Hero */}
            <div className="shop-hero">
                <div className="container">
                    <h1 className="shop-hero__title text-display">
                        <ShoppingBag size={28} className="shop-hero__icon" />
                        <span className="text-gradient">Arena Shop</span>
                    </h1>
                    <p className="shop-hero__subtitle">
                        Equip your agents with powerful items to dominate the arena
                    </p>
                </div>
            </div>

            <div className="shop-content container">
                {/* Agent Selector & Equipment Overview */}
                <div className="shop-agent-bar card-base" id="agent-selector">
                    <div className="shop-agent-bar__left">
                        <div className="shop-agent-select">
                            <label className="shop-agent-select__label">Equipping for:</label>
                            <div className="shop-agent-select__dropdown">
                                <select
                                    value={selectedAgent.id}
                                    onChange={(e) => setSelectedAgent(AGENTS.find(a => a.id === e.target.value) || AGENTS[0])}
                                    id="agent-dropdown"
                                >
                                    {AGENTS.filter(a => a.owner).map(a => (
                                        <option key={a.id} value={a.id}>{a.avatar} {a.name}</option>
                                    ))}
                                </select>
                                <ChevronDown size={14} />
                            </div>
                        </div>
                        <div className="shop-agent-bar__gold">
                            <span className="shop-agent-bar__gold-icon">💰</span>
                            <span className="shop-agent-bar__gold-amount">{agentInventory?.gold?.toLocaleString() || 0}</span>
                            <span className="shop-agent-bar__gold-label">MON</span>
                        </div>
                    </div>

                    {/* Equipment Slots */}
                    <div className="shop-equipment-slots">
                        {['weapon', 'armor', 'boots', 'amulet', 'rune'].map(slot => {
                            const equipped = agentInventory?.equipped?.[slot];
                            const rarity = equipped ? RARITY[equipped.rarity] : null;
                            return (
                                <div
                                    key={slot}
                                    className={`shop-equip-slot ${equipped ? 'shop-equip-slot--filled' : ''}`}
                                    style={equipped ? { borderColor: rarity?.color, boxShadow: rarity?.glow } : {}}
                                    title={equipped ? `${equipped.name} (click to unequip)` : `Empty ${slot} slot`}
                                >
                                    <span className="shop-equip-slot__icon">
                                        {equipped ? equipped.icon : ITEM_CATEGORY[slot]?.icon || '❓'}
                                    </span>
                                    <span className="shop-equip-slot__label">{slot}</span>
                                    {equipped ? (
                                        <>
                                            <span className="shop-equip-slot__rarity" style={{ color: rarity?.color }}>
                                                {rarity?.name}
                                            </span>
                                            <button
                                                className="shop-equip-slot__remove"
                                                onClick={(e) => { e.stopPropagation(); handleUnequip(slot); }}
                                                title="Unequip"
                                            >✕</button>
                                        </>
                                    ) : null}
                                </div>
                            );
                        })}
                    </div>

                    {/* Stats Summary */}
                    <div className="shop-stats-summary" id="equipment-stats">
                        <div className="shop-stats-summary__title">
                            <TrendingUp size={14} />
                            Equipment Bonus
                        </div>
                        <div className="shop-stats-summary__grid">
                            {equipmentBonus.damage > 0 && <span className="stat-pill stat-pill--dmg">⚔️ +{equipmentBonus.damage} DMG</span>}
                            {equipmentBonus.defense > 0 && <span className="stat-pill stat-pill--def">🛡️ +{equipmentBonus.defense} DEF</span>}
                            {equipmentBonus.speed > 0 && <span className="stat-pill stat-pill--spd">💨 +{equipmentBonus.speed} SPD</span>}
                            {equipmentBonus.critChance > 0 && <span className="stat-pill stat-pill--crit">🎯 +{equipmentBonus.critChance}% CRIT</span>}
                            {equipmentBonus.lifesteal > 0 && <span className="stat-pill stat-pill--heal">🧛 +{equipmentBonus.lifesteal}% LS</span>}
                            {equipmentBonus.maxHP > 0 && <span className="stat-pill stat-pill--hp">❤️ +{equipmentBonus.maxHP} HP</span>}
                            {equipmentBonus.dodgeChance > 0 && <span className="stat-pill stat-pill--dodge">💫 +{equipmentBonus.dodgeChance}% DOD</span>}
                        </div>
                    </div>
                </div>

                {/* Backpack */}
                {agentInventory?.backpack?.length > 0 && (
                    <div className="shop-backpack card-base" id="agent-backpack">
                        <h3 className="shop-backpack__title">
                            <Package size={16} />
                            Backpack ({agentInventory.backpack.length} items)
                        </h3>
                        <div className="shop-backpack__grid">
                            {agentInventory.backpack.map((item, idx) => {
                                const rarity = RARITY[item.rarity];
                                const isEquippable = item.category !== 'potion';
                                return (
                                    <div
                                        key={`${item.id}-${idx}`}
                                        className="shop-backpack__item"
                                        style={{ borderColor: rarity?.color + '44' }}
                                    >
                                        <span className="shop-backpack__item-icon">{item.icon}</span>
                                        <div className="shop-backpack__item-info">
                                            <span className="shop-backpack__item-name">{item.name}</span>
                                            <span className="shop-backpack__item-rarity" style={{ color: rarity?.color }}>
                                                {rarity?.name}
                                            </span>
                                        </div>
                                        {isEquippable && (
                                            <button
                                                className="shop-backpack__equip-btn"
                                                onClick={() => handleEquipFromBackpack(item)}
                                                title="Equip this item"
                                            >
                                                <ArrowRightLeft size={12} /> Equip
                                            </button>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* Main Shop Area */}
                <div className="shop-layout">
                    {/* Filters Sidebar */}
                    <aside className="shop-filters" id="shop-filters">
                        <div className="shop-filters__header">
                            <Filter size={16} />
                            <span>Filters</span>
                        </div>

                        {/* Search */}
                        <div className="shop-search">
                            <Search size={14} />
                            <input
                                type="text"
                                placeholder="Search items..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="shop-search__input"
                                id="item-search"
                            />
                        </div>

                        {/* Categories */}
                        <div className="shop-filters__section">
                            <h3 className="shop-filters__title">Category</h3>
                            {categories.map(cat => (
                                <button
                                    key={cat.id}
                                    className={`shop-filter-btn ${selectedCategory === cat.id ? 'shop-filter-btn--active' : ''}`}
                                    onClick={() => setSelectedCategory(cat.id)}
                                >
                                    {CATEGORY_ICONS[cat.id] || <Sparkles size={16} />}
                                    <span>{cat.name}</span>
                                    <span className="shop-filter-btn__count">{cat.count}</span>
                                </button>
                            ))}
                        </div>

                        {/* Rarity */}
                        <div className="shop-filters__section">
                            <h3 className="shop-filters__title">Rarity</h3>
                            <button
                                className={`shop-filter-btn ${selectedRarity === 'all' ? 'shop-filter-btn--active' : ''}`}
                                onClick={() => setSelectedRarity('all')}
                            >
                                <Star size={16} />
                                <span>All Rarities</span>
                            </button>
                            {Object.entries(RARITY).map(([id, r]) => (
                                <button
                                    key={id}
                                    className={`shop-filter-btn ${selectedRarity === id ? 'shop-filter-btn--active' : ''}`}
                                    onClick={() => setSelectedRarity(id)}
                                    style={{ '--filter-color': r.color }}
                                >
                                    <span className="shop-rarity-dot" style={{ background: r.color }} />
                                    <span>{r.name}</span>
                                </button>
                            ))}
                        </div>

                        {/* Sort */}
                        <div className="shop-filters__section">
                            <h3 className="shop-filters__title">Sort By</h3>
                            <select
                                value={sortBy}
                                onChange={(e) => setSortBy(e.target.value)}
                                className="shop-sort-select"
                                id="sort-select"
                            >
                                <option value="price-asc">Price: Low → High</option>
                                <option value="price-desc">Price: High → Low</option>
                                <option value="rarity">Rarity</option>
                            </select>
                        </div>
                    </aside>

                    {/* Items Grid */}
                    <div className="shop-items">
                        <div className="shop-items__header">
                            <span className="shop-items__count">{filteredItems.length} items</span>
                        </div>
                        <div className="shop-items__grid" id="items-grid">
                            {filteredItems.map(item => {
                                const rarity = RARITY[item.rarity];
                                const isAffordable = canAfford(selectedAgent.id, item.price);
                                return (
                                    <div
                                        key={item.id}
                                        className={`shop-item-card shop-item-card--${item.rarity} ${!isAffordable ? 'shop-item-card--unaffordable' : ''}`}
                                        onClick={() => setSelectedItem(item)}
                                        style={{ '--rarity-color': rarity.color, '--rarity-glow': rarity.glow }}
                                        id={`item-${item.id}`}
                                    >
                                        <div className="shop-item-card__rarity-bar" style={{ background: rarity.color }} />
                                        <div className="shop-item-card__icon">{item.icon}</div>
                                        <div className="shop-item-card__info">
                                            <h3 className="shop-item-card__name">{item.name}</h3>
                                            <span className="shop-item-card__category">
                                                {ITEM_CATEGORY[item.category]?.icon} {ITEM_CATEGORY[item.category]?.name}
                                            </span>
                                            <div className="shop-item-card__stats">
                                                {Object.entries(item.stats).slice(0, 3).map(([key, val]) => (
                                                    <span key={key} className="shop-item-card__stat">
                                                        +{val} {key.replace(/([A-Z])/g, ' $1').trim()}
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                        <div className="shop-item-card__footer">
                                            <span className="shop-item-card__rarity-tag" style={{ color: rarity.color }}>
                                                {rarity.name}
                                            </span>
                                            <span className={`shop-item-card__price ${!isAffordable ? 'shop-item-card__price--no' : ''}`}>
                                                💰 {item.price}
                                            </span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            </div>

            {/* Item Detail Modal */}
            {selectedItem && (
                <div className="shop-modal-overlay" onClick={() => setSelectedItem(null)} id="item-modal">
                    <div className="shop-modal" onClick={e => e.stopPropagation()}>
                        <div className="shop-modal__header" style={{ borderColor: RARITY[selectedItem.rarity]?.color }}>
                            <div className="shop-modal__icon" style={{ boxShadow: RARITY[selectedItem.rarity]?.glow }}>
                                {selectedItem.icon}
                            </div>
                            <div className="shop-modal__titles">
                                <h2 className="shop-modal__name text-display">{selectedItem.name}</h2>
                                <span className="shop-modal__rarity" style={{ color: RARITY[selectedItem.rarity]?.color }}>
                                    {RARITY[selectedItem.rarity]?.name} {ITEM_CATEGORY[selectedItem.category]?.name}
                                </span>
                            </div>
                            <button className="shop-modal__close" onClick={() => setSelectedItem(null)}>✕</button>
                        </div>

                        <p className="shop-modal__desc">{selectedItem.description}</p>
                        {selectedItem.lore && (
                            <p className="shop-modal__lore">"{selectedItem.lore}"</p>
                        )}

                        <div className="shop-modal__stats">
                            <h3>Stats</h3>
                            <div className="shop-modal__stats-grid">
                                {Object.entries(selectedItem.stats).map(([key, val]) => (
                                    <div key={key} className="shop-modal__stat-row">
                                        <span className="shop-modal__stat-name">{key.replace(/([A-Z])/g, ' $1').trim()}</span>
                                        <span className="shop-modal__stat-val" style={{ color: val > 0 ? '#39FF14' : '#FF3131' }}>
                                            {val > 0 ? '+' : ''}{val}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="shop-modal__actions">
                            <div className="shop-modal__price-big">
                                <span>💰</span>
                                <span className="shop-modal__price-amount">{selectedItem.price.toLocaleString()}</span>
                                <span>MON</span>
                                {agentInventory && (
                                    <span className="shop-modal__balance">
                                        (Balance: {agentInventory.gold.toLocaleString()})
                                    </span>
                                )}
                            </div>
                            <div className="shop-modal__btn-group">
                                <button
                                    className="btn btn-secondary shop-modal__buy-btn"
                                    onClick={handleBuy}
                                    disabled={!affordable}
                                    title="Buy and add to backpack"
                                >
                                    <Package size={14} />
                                    {!affordable ? 'Not Enough MON' : 'Buy to Backpack'}
                                </button>
                                {selectedItem.category !== 'potion' && (
                                    <button
                                        className="btn btn-primary shop-modal__buy-btn"
                                        id="buy-item-btn"
                                        onClick={handleBuyAndEquip}
                                        disabled={!affordable}
                                        title="Buy and equip immediately"
                                    >
                                        <Check size={14} />
                                        {!affordable ? 'Not Enough MON' : 'Buy & Equip'}
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
