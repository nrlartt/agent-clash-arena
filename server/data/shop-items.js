// ═══════════════════════════════════════════════════════════════
// SHOP ITEMS — Full item data with stats (server-side source of truth)
// Equipment stats directly affect agent combat performance
// ═══════════════════════════════════════════════════════════════

const SHOP_ITEMS = [
    // ─── Weapons ─────────────────────────
    { id: 'itm-w01', name: 'Crimson Edge', category: 'weapon', rarity: 'common', price: 150, icon: '🗡️',
      stats: { damage: 8, critChance: 2 } },
    { id: 'itm-w02', name: 'Thunderstrike Katana', category: 'weapon', rarity: 'uncommon', price: 420, icon: '⚡',
      stats: { damage: 14, critChance: 5, attackSpeed: 3 } },
    { id: 'itm-w03', name: 'Void Reaver', category: 'weapon', rarity: 'rare', price: 980, icon: '🌑',
      stats: { damage: 22, critChance: 8, lifesteal: 5 } },
    { id: 'itm-w04', name: 'Pyroclasm Decimator', category: 'weapon', rarity: 'epic', price: 2400, icon: '🔥',
      stats: { damage: 35, critChance: 12, critDamage: 25, burnDamage: 5 } },
    { id: 'itm-w05', name: "Monad's Wrath", category: 'weapon', rarity: 'legendary', price: 8500, icon: '💎',
      stats: { damage: 50, critChance: 18, critDamage: 40, lifesteal: 10, attackSpeed: 8 } },

    // ─── Armor ───────────────────────────
    { id: 'itm-a01', name: 'Iron Cuirass', category: 'armor', rarity: 'common', price: 120, icon: '🪖',
      stats: { defense: 6, maxHP: 15 } },
    { id: 'itm-a02', name: 'Shadow Vest', category: 'armor', rarity: 'uncommon', price: 380, icon: '🦇',
      stats: { defense: 12, dodgeChance: 5, maxHP: 25 } },
    { id: 'itm-a03', name: 'Crystal Aegis', category: 'armor', rarity: 'rare', price: 950, icon: '💠',
      stats: { defense: 20, dodgeChance: 8, maxHP: 50, reflect: 5 } },
    { id: 'itm-a04', name: "Titan's Fortress", category: 'armor', rarity: 'epic', price: 2200, icon: '🏰',
      stats: { defense: 35, maxHP: 100, reflect: 10, thornDamage: 8 } },

    // ─── Boots ───────────────────────────
    { id: 'itm-b01', name: 'Swift Treads', category: 'boots', rarity: 'common', price: 100, icon: '👟',
      stats: { speed: 8, dodgeChance: 3 } },
    { id: 'itm-b02', name: 'Phase Walkers', category: 'boots', rarity: 'uncommon', price: 350, icon: '✨',
      stats: { speed: 15, dodgeChance: 8, attackSpeed: 3 } },
    { id: 'itm-b03', name: 'Quantum Dash', category: 'boots', rarity: 'rare', price: 880, icon: '⚡',
      stats: { speed: 25, dodgeChance: 15, attackSpeed: 5 } },
    { id: 'itm-b04', name: 'Chrono Striders', category: 'boots', rarity: 'epic', price: 2100, icon: '⏳',
      stats: { speed: 40, dodgeChance: 20, attackSpeed: 10, critChance: 5 } },

    // ─── Amulets ─────────────────────────
    { id: 'itm-am01', name: 'Vampire Fang', category: 'amulet', rarity: 'uncommon', price: 400, icon: '🧛',
      stats: { lifesteal: 8, critChance: 3 } },
    { id: 'itm-am02', name: "Berserker's Rage", category: 'amulet', rarity: 'rare', price: 1100, icon: '😡',
      stats: { damage: 10, critDamage: 20, lowHPBonus: 30 } },
    { id: 'itm-am03', name: 'Monad Heart', category: 'amulet', rarity: 'legendary', price: 7500, icon: '💜',
      stats: { damage: 20, defense: 15, speed: 15, critChance: 10, lifesteal: 12, maxHP: 50 } },

    // ─── Runes ───────────────────────────
    { id: 'itm-r01', name: 'Fire Rune', category: 'rune', rarity: 'uncommon', price: 300, icon: '🔥',
      stats: { burnDamage: 4, damage: 5 }, effect: 'fire' },
    { id: 'itm-r02', name: 'Ice Rune', category: 'rune', rarity: 'uncommon', price: 300, icon: '❄️',
      stats: { slowEffect: 15, defense: 5 }, effect: 'ice' },
    { id: 'itm-r03', name: 'Lightning Rune', category: 'rune', rarity: 'rare', price: 750, icon: '⚡',
      stats: { damage: 12, critChance: 8, chainDamage: 10 }, effect: 'lightning' },
    { id: 'itm-r04', name: 'Void Rune', category: 'rune', rarity: 'epic', price: 2000, icon: '🕳️',
      stats: { armorPen: 25, damage: 15, critDamage: 15 }, effect: 'void' },

    // ─── Potions (Consumable) ────────────
    { id: 'itm-p01', name: 'Power Elixir', category: 'potion', rarity: 'common', price: 50, icon: '💪',
      stats: { damage: 15 }, duration: '1 match' },
    { id: 'itm-p02', name: 'Iron Skin Potion', category: 'potion', rarity: 'common', price: 50, icon: '🧱',
      stats: { defense: 15 }, duration: '1 match' },
    { id: 'itm-p03', name: 'Phoenix Tears', category: 'potion', rarity: 'rare', price: 500, icon: '🔆',
      stats: { revive: 30 }, duration: '1 match' },
];

const SHOP_ITEMS_BY_ID = SHOP_ITEMS.reduce((acc, item) => {
    acc[item.id] = item;
    return acc;
}, {});

const EQUIPPABLE_SLOTS = new Set(['weapon', 'armor', 'boots', 'amulet', 'rune']);

// ── Items grouped by category for equipment assignment ──
const ITEMS_BY_CATEGORY = {};
SHOP_ITEMS.forEach(item => {
    if (!ITEMS_BY_CATEGORY[item.category]) ITEMS_BY_CATEGORY[item.category] = [];
    ITEMS_BY_CATEGORY[item.category].push(item);
});

// ── Rarity tiers (higher = stronger) ──
const RARITY_TIER = { common: 1, uncommon: 2, rare: 3, epic: 4, legendary: 5 };

/**
 * Calculate total equipment bonus from a list of equipped item objects.
 * Each item should have a `stats` object (or an `itemId` to look up).
 */
function calculateEquipmentBonus(equippedItems) {
    const bonus = {
        damage: 0, defense: 0, speed: 0, critChance: 0, critDamage: 0,
        lifesteal: 0, maxHP: 0, dodgeChance: 0, attackSpeed: 0,
        burnDamage: 0, reflect: 0, thornDamage: 0, slowEffect: 0,
        armorPen: 0, lowHPBonus: 0, chainDamage: 0, revive: 0,
    };

    for (const item of equippedItems) {
        if (!item) continue;
        // Support both direct stats and itemId lookup
        const stats = item.stats || (item.itemId && SHOP_ITEMS_BY_ID[item.itemId]?.stats);
        if (!stats) continue;
        for (const [key, value] of Object.entries(stats)) {
            if (key in bonus) {
                bonus[key] += value;
            }
        }
    }

    return bonus;
}

/**
 * Calculate a numeric power score from equipment bonus.
 * Used to adjust agent powerRating for matchmaking and win probability.
 */
function calculateEquipmentPower(equipmentBonus) {
    const b = equipmentBonus;
    return Math.round(
        b.damage * 1.5 +
        b.defense * 1.2 +
        b.speed * 0.8 +
        b.critChance * 0.6 +
        b.critDamage * 0.3 +
        b.lifesteal * 1.0 +
        b.maxHP * 0.15 +
        b.dodgeChance * 0.7 +
        b.attackSpeed * 0.5 +
        b.burnDamage * 1.0 +
        b.armorPen * 0.8 +
        b.thornDamage * 0.6 +
        b.lowHPBonus * 0.3 +
        b.slowEffect * 0.4
    );
}

/**
 * Pick a random item from a category, weighted by agent rank.
 * Higher-ranked agents tend to get better (rarer) items.
 * @param {string} category - weapon, armor, boots, amulet, rune
 * @param {number} rank - agent rank (1 = best, higher = worse)
 * @param {number} totalAgents - total number of agents
 * @returns {object|null} - a shop item or null
 */
function pickRandomItem(category, rank, totalAgents) {
    const items = ITEMS_BY_CATEGORY[category];
    if (!items || items.length === 0) return null;

    // Higher rank (lower number) = higher chance of rare/epic items
    const rankPct = 1 - ((rank - 1) / Math.max(totalAgents - 1, 1)); // 1.0 for rank 1, 0.0 for last

    // Weight each item: base weight inversely proportional to rarity,
    // but boosted for high-ranked agents
    const weighted = items.filter(i => i.category !== 'potion').map(item => {
        const tier = RARITY_TIER[item.rarity] || 1;
        // Base weight decreases with rarity
        let weight = Math.max(1, 6 - tier);
        // Boost rare items for high-ranked agents
        weight += rankPct * tier * 2;
        return { item, weight };
    });

    const totalWeight = weighted.reduce((sum, w) => sum + w.weight, 0);
    let roll = Math.random() * totalWeight;

    for (const { item, weight } of weighted) {
        roll -= weight;
        if (roll <= 0) return item;
    }

    return weighted[weighted.length - 1]?.item || null;
}

/**
 * Generate a full equipment loadout for a simulated agent.
 * @param {number} rank - agent rank (1 = best)
 * @param {number} totalAgents - total agents in pool
 * @returns {{ equipped: object, bonus: object, equipmentPower: number }}
 */
function generateAgentEquipment(rank, totalAgents) {
    const slots = ['weapon', 'armor', 'boots', 'amulet', 'rune'];
    const equipped = {};

    for (const slot of slots) {
        // Not every agent has every slot filled (lower ranked may miss some)
        const fillChance = slot === 'weapon' ? 0.95 : (0.5 + (1 - (rank - 1) / Math.max(totalAgents - 1, 1)) * 0.45);
        if (Math.random() < fillChance) {
            equipped[slot] = pickRandomItem(slot, rank, totalAgents);
        } else {
            equipped[slot] = null;
        }
    }

    const equippedItems = Object.values(equipped).filter(Boolean);
    const bonus = calculateEquipmentBonus(equippedItems);
    const equipmentPower = calculateEquipmentPower(bonus);

    return { equipped, bonus, equipmentPower };
}

module.exports = {
    SHOP_ITEMS,
    SHOP_ITEMS_BY_ID,
    EQUIPPABLE_SLOTS,
    ITEMS_BY_CATEGORY,
    RARITY_TIER,
    calculateEquipmentBonus,
    calculateEquipmentPower,
    generateAgentEquipment,
    pickRandomItem,
};
