// ═══════════════════════════════════════════════════════════════
// INVENTORY SYSTEM — Items, Shop, Equipment Effects
// Items affect agent power rating, damage, defense, speed
// ═══════════════════════════════════════════════════════════════

// ── Item Rarities ────────────────────────────────────────────
export const RARITY = {
    common: { name: 'Common', color: '#8B9DAF', glow: 'none', chance: 0.45 },
    uncommon: { name: 'Uncommon', color: '#39FF14', glow: '0 0 8px #39FF1444', chance: 0.30 },
    rare: { name: 'Rare', color: '#00F5FF', glow: '0 0 12px #00F5FF44', chance: 0.15 },
    epic: { name: 'Epic', color: '#836EF9', glow: '0 0 16px #836EF966', chance: 0.07 },
    legendary: { name: 'Legendary', color: '#FFE93E', glow: '0 0 20px #FFE93E66, 0 0 40px #FFE93E22', chance: 0.03 },
};

// ── Item Categories ──────────────────────────────────────────
export const ITEM_CATEGORY = {
    weapon: { name: 'Weapon', icon: '⚔️', slot: 'weapon', desc: 'Equip to boost damage output' },
    armor: { name: 'Armor', icon: '🛡️', slot: 'armor', desc: 'Equip to reduce incoming damage' },
    boots: { name: 'Boots', icon: '👟', slot: 'boots', desc: 'Equip to increase movement speed' },
    amulet: { name: 'Amulet', icon: '📿', slot: 'amulet', desc: 'Equip for special passive effects' },
    potion: { name: 'Potion', icon: '🧪', slot: null, desc: 'Consumable — use before a match' },
    rune: { name: 'Rune', icon: '🔮', slot: 'rune', desc: 'Equip for elemental bonuses' },
};

// ── Shop Items ───────────────────────────────────────────────
export const SHOP_ITEMS = [
    // ─── Weapons ─────────────────────────
    {
        id: 'itm-w01',
        name: 'Crimson Edge',
        category: 'weapon',
        rarity: 'common',
        price: 150,
        icon: '🗡️',
        description: 'A basic blade forged in the arena foundry.',
        stats: { damage: +8, critChance: +2 },
        lore: 'Stained red from countless victories.',
    },
    {
        id: 'itm-w02',
        name: 'Thunderstrike Katana',
        category: 'weapon',
        rarity: 'uncommon',
        price: 420,
        icon: '⚡',
        description: 'Channels lightning through each swing.',
        stats: { damage: +14, critChance: +5, attackSpeed: +3 },
        lore: 'Forged during a Monad thunderstorm.',
    },
    {
        id: 'itm-w03',
        name: 'Void Reaver',
        category: 'weapon',
        rarity: 'rare',
        price: 980,
        icon: '🌑',
        description: 'Tears through dimensional barriers.',
        stats: { damage: +22, critChance: +8, lifesteal: +5 },
        lore: 'Pulled from the void between chains.',
    },
    {
        id: 'itm-w04',
        name: 'Pyroclasm Decimator',
        category: 'weapon',
        rarity: 'epic',
        price: 2400,
        icon: '🔥',
        description: 'Each hit ignites the target in hellfire.',
        stats: { damage: +35, critChance: +12, critDamage: +25, burnDamage: 5 },
        lore: 'The weapon of the First Champion.',
    },
    {
        id: 'itm-w05',
        name: 'Monad\'s Wrath',
        category: 'weapon',
        rarity: 'legendary',
        price: 8500,
        icon: '💎',
        description: 'The legendary weapon said to be forged by the Monad itself.',
        stats: { damage: +50, critChance: +18, critDamage: +40, lifesteal: +10, attackSpeed: +8 },
        lore: 'Only the chosen may wield it. MON flows through its veins.',
    },

    // ─── Armor ───────────────────────────
    {
        id: 'itm-a01',
        name: 'Iron Cuirass',
        category: 'armor',
        rarity: 'common',
        price: 120,
        icon: '🪖',
        description: 'Standard issue arena protection.',
        stats: { defense: +6, maxHP: +15 },
        lore: 'Dented, but still holds.',
    },
    {
        id: 'itm-a02',
        name: 'Shadow Vest',
        category: 'armor',
        rarity: 'uncommon',
        price: 380,
        icon: '🦇',
        description: 'Woven from shadow silk. Light yet durable.',
        stats: { defense: +12, dodgeChance: +5, maxHP: +25 },
        lore: 'Absorbs light and damage alike.',
    },
    {
        id: 'itm-a03',
        name: 'Crystal Aegis',
        category: 'armor',
        rarity: 'rare',
        price: 950,
        icon: '💠',
        description: 'Crystallized MON energy forms an adaptive shield.',
        stats: { defense: +20, dodgeChance: +8, maxHP: +50, reflect: +5 },
        lore: 'Each hit it blocks makes it stronger.',
    },
    {
        id: 'itm-a04',
        name: 'Titan\'s Fortress',
        category: 'armor',
        rarity: 'epic',
        price: 2200,
        icon: '🏰',
        description: 'Impenetrable armor for the most brutal brawls.',
        stats: { defense: +35, maxHP: +100, reflect: +10, thornDamage: 8 },
        lore: 'Wearing it feels like being inside a bunker.',
    },

    // ─── Boots ───────────────────────────
    {
        id: 'itm-b01',
        name: 'Swift Treads',
        category: 'boots',
        rarity: 'common',
        price: 100,
        icon: '👟',
        description: 'Light boots for faster footwork.',
        stats: { speed: +8, dodgeChance: +3 },
        lore: 'Standard issue, surprisingly comfortable.',
    },
    {
        id: 'itm-b02',
        name: 'Phase Walkers',
        category: 'boots',
        rarity: 'uncommon',
        price: 350,
        icon: '✨',
        description: 'Allows brief phasing through attacks.',
        stats: { speed: +15, dodgeChance: +8, attackSpeed: +3 },
        lore: 'The wearer flickers between dimensions.',
    },
    {
        id: 'itm-b03',
        name: 'Quantum Dash',
        category: 'boots',
        rarity: 'rare',
        price: 880,
        icon: '⚡',
        description: 'Teleport short distances during combat.',
        stats: { speed: +25, dodgeChance: +15, attackSpeed: +5 },
        lore: 'Moving faster than the eye can follow.',
    },
    {
        id: 'itm-b04',
        name: 'Chrono Striders',
        category: 'boots',
        rarity: 'epic',
        price: 2100,
        icon: '⏳',
        description: 'Slows time for the wearer, increasing reaction speed.',
        stats: { speed: +40, dodgeChance: +20, attackSpeed: +10, critChance: +5 },
        lore: 'Time itself bends around the wearer.',
    },

    // ─── Amulets ─────────────────────────
    {
        id: 'itm-am01',
        name: 'Vampire Fang',
        category: 'amulet',
        rarity: 'uncommon',
        price: 400,
        icon: '🧛',
        description: 'Drains life from opponents on each hit.',
        stats: { lifesteal: +8, critChance: +3 },
        lore: 'Bloodthirst knows no bounds.',
    },
    {
        id: 'itm-am02',
        name: 'Berserker\'s Rage',
        category: 'amulet',
        rarity: 'rare',
        price: 1100,
        icon: '😡',
        description: 'Deal more damage when HP is low.',
        stats: { damage: +10, critDamage: +20, lowHPBonus: +30 },
        lore: 'Pain fuels the fury.',
    },
    {
        id: 'itm-am03',
        name: 'Monad Heart',
        category: 'amulet',
        rarity: 'legendary',
        price: 7500,
        icon: '💜',
        description: 'The heart of Monad. Grants immense power.',
        stats: { damage: +20, defense: +15, speed: +15, critChance: +10, lifesteal: +12, maxHP: +50 },
        lore: 'The blockchain pulses within. Each block strengthens the bearer.',
    },

    // ─── Runes ───────────────────────────
    {
        id: 'itm-r01',
        name: 'Fire Rune',
        category: 'rune',
        rarity: 'uncommon',
        price: 300,
        icon: '🔥',
        description: 'Ignites attacks with fire damage.',
        stats: { burnDamage: 4, damage: +5 },
        effect: 'fire',
        lore: 'Enemies burn for 3 seconds after each hit.',
    },
    {
        id: 'itm-r02',
        name: 'Ice Rune',
        category: 'rune',
        rarity: 'uncommon',
        price: 300,
        icon: '❄️',
        description: 'Freezes opponents, reducing their speed.',
        stats: { slowEffect: 15, defense: +5 },
        effect: 'ice',
        lore: 'Chills to the bone.',
    },
    {
        id: 'itm-r03',
        name: 'Lightning Rune',
        category: 'rune',
        rarity: 'rare',
        price: 750,
        icon: '⚡',
        description: 'Chain lightning strikes nearby opponents.',
        stats: { damage: +12, critChance: +8, chainDamage: 10 },
        effect: 'lightning',
        lore: 'Thunder follows every strike.',
    },
    {
        id: 'itm-r04',
        name: 'Void Rune',
        category: 'rune',
        rarity: 'epic',
        price: 2000,
        icon: '🕳️',
        description: 'Nullifies a portion of enemy defenses.',
        stats: { armorPen: 25, damage: +15, critDamage: +15 },
        effect: 'void',
        lore: 'Devours all resistance.',
    },

    // ─── Potions (Consumable) ────────────
    {
        id: 'itm-p01',
        name: 'Power Elixir',
        category: 'potion',
        rarity: 'common',
        price: 50,
        icon: '💪',
        description: 'Temporarily boosts damage by 15% for one match.',
        stats: { damage: +15 },
        duration: '1 match',
        lore: 'Tastes terrible, hits hard.',
    },
    {
        id: 'itm-p02',
        name: 'Iron Skin Potion',
        category: 'potion',
        rarity: 'common',
        price: 50,
        icon: '🧱',
        description: 'Temporarily boosts defense by 15% for one match.',
        stats: { defense: +15 },
        duration: '1 match',
        lore: 'Skin hardens like steel.',
    },
    {
        id: 'itm-p03',
        name: 'Phoenix Tears',
        category: 'potion',
        rarity: 'rare',
        price: 500,
        icon: '🔆',
        description: 'Revive with 30% HP once per match when KO\'d.',
        stats: { revive: 30 },
        duration: '1 match',
        lore: 'Death is not the end.',
    },
];

// ── Calculate total equipped stats ───────────────────────────
export function calculateEquipmentBonus(equippedItems) {
    const bonus = {
        damage: 0,
        defense: 0,
        speed: 0,
        critChance: 0,
        critDamage: 0,
        lifesteal: 0,
        maxHP: 0,
        dodgeChance: 0,
        attackSpeed: 0,
        burnDamage: 0,
        reflect: 0,
        thornDamage: 0,
        slowEffect: 0,
        armorPen: 0,
        lowHPBonus: 0,
        chainDamage: 0,
        revive: 0,
    };

    for (const item of equippedItems) {
        if (!item?.stats) continue;
        for (const [key, value] of Object.entries(item.stats)) {
            if (key in bonus) {
                bonus[key] += value;
            }
        }
    }

    return bonus;
}

// ── Calculate power rating from equipment ────────────────────
export function calculatePowerRating(baseRating, equippedItems) {
    const bonus = calculateEquipmentBonus(equippedItems);
    const itemPower =
        bonus.damage * 1.5 +
        bonus.defense * 1.2 +
        bonus.speed * 0.8 +
        bonus.critChance * 0.6 +
        bonus.critDamage * 0.3 +
        bonus.lifesteal * 1.0 +
        bonus.maxHP * 0.15 +
        bonus.dodgeChance * 0.7 +
        bonus.attackSpeed * 0.5;

    return Math.round(baseRating + itemPower);
}

// ── Agent Inventories (mock) ─────────────────────────────────
export const AGENT_INVENTORIES = {
    'agent-001': {
        gold: 3200,
        equipped: {
            weapon: SHOP_ITEMS.find(i => i.id === 'itm-w04'),
            armor: SHOP_ITEMS.find(i => i.id === 'itm-a03'),
            boots: SHOP_ITEMS.find(i => i.id === 'itm-b03'),
            amulet: SHOP_ITEMS.find(i => i.id === 'itm-am02'),
            rune: SHOP_ITEMS.find(i => i.id === 'itm-r03'),
        },
        backpack: [
            SHOP_ITEMS.find(i => i.id === 'itm-p01'),
            SHOP_ITEMS.find(i => i.id === 'itm-p01'),
            SHOP_ITEMS.find(i => i.id === 'itm-w02'),
        ],
    },
    'agent-002': {
        gold: 2100,
        equipped: {
            weapon: SHOP_ITEMS.find(i => i.id === 'itm-w02'),
            armor: SHOP_ITEMS.find(i => i.id === 'itm-a04'),
            boots: SHOP_ITEMS.find(i => i.id === 'itm-b01'),
            amulet: null,
            rune: SHOP_ITEMS.find(i => i.id === 'itm-r02'),
        },
        backpack: [SHOP_ITEMS.find(i => i.id === 'itm-p02')],
    },
    'agent-003': {
        gold: 4500,
        equipped: {
            weapon: SHOP_ITEMS.find(i => i.id === 'itm-w03'),
            armor: SHOP_ITEMS.find(i => i.id === 'itm-a02'),
            boots: SHOP_ITEMS.find(i => i.id === 'itm-b04'),
            amulet: SHOP_ITEMS.find(i => i.id === 'itm-am01'),
            rune: SHOP_ITEMS.find(i => i.id === 'itm-r04'),
        },
        backpack: [SHOP_ITEMS.find(i => i.id === 'itm-p03')],
    },
};
