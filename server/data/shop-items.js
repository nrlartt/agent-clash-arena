const SHOP_ITEMS = [
    { id: 'itm-w01', name: 'Crimson Edge', category: 'weapon', rarity: 'common', price: 150 },
    { id: 'itm-w02', name: 'Thunderstrike Katana', category: 'weapon', rarity: 'uncommon', price: 420 },
    { id: 'itm-w03', name: 'Void Reaver', category: 'weapon', rarity: 'rare', price: 980 },
    { id: 'itm-w04', name: 'Pyroclasm Decimator', category: 'weapon', rarity: 'epic', price: 2400 },
    { id: 'itm-w05', name: "Monad's Wrath", category: 'weapon', rarity: 'legendary', price: 8500 },

    { id: 'itm-a01', name: 'Iron Cuirass', category: 'armor', rarity: 'common', price: 120 },
    { id: 'itm-a02', name: 'Shadow Vest', category: 'armor', rarity: 'uncommon', price: 380 },
    { id: 'itm-a03', name: 'Crystal Aegis', category: 'armor', rarity: 'rare', price: 950 },
    { id: 'itm-a04', name: "Titan's Fortress", category: 'armor', rarity: 'epic', price: 2200 },

    { id: 'itm-b01', name: 'Swift Treads', category: 'boots', rarity: 'common', price: 100 },
    { id: 'itm-b02', name: 'Phase Walkers', category: 'boots', rarity: 'uncommon', price: 350 },
    { id: 'itm-b03', name: 'Quantum Dash', category: 'boots', rarity: 'rare', price: 880 },
    { id: 'itm-b04', name: 'Chrono Striders', category: 'boots', rarity: 'epic', price: 2100 },

    { id: 'itm-am01', name: 'Vampire Fang', category: 'amulet', rarity: 'uncommon', price: 400 },
    { id: 'itm-am02', name: "Berserker's Rage", category: 'amulet', rarity: 'rare', price: 1100 },
    { id: 'itm-am03', name: 'Monad Heart', category: 'amulet', rarity: 'legendary', price: 7500 },

    { id: 'itm-r01', name: 'Fire Rune', category: 'rune', rarity: 'uncommon', price: 300 },
    { id: 'itm-r02', name: 'Ice Rune', category: 'rune', rarity: 'uncommon', price: 300 },
    { id: 'itm-r03', name: 'Lightning Rune', category: 'rune', rarity: 'rare', price: 750 },
    { id: 'itm-r04', name: 'Void Rune', category: 'rune', rarity: 'epic', price: 2000 },

    { id: 'itm-p01', name: 'Power Elixir', category: 'potion', rarity: 'common', price: 50 },
    { id: 'itm-p02', name: 'Iron Skin Potion', category: 'potion', rarity: 'common', price: 50 },
    { id: 'itm-p03', name: 'Phoenix Tears', category: 'potion', rarity: 'rare', price: 500 },
];

const SHOP_ITEMS_BY_ID = SHOP_ITEMS.reduce((acc, item) => {
    acc[item.id] = item;
    return acc;
}, {});

const EQUIPPABLE_SLOTS = new Set(['weapon', 'armor', 'boots', 'amulet', 'rune']);

module.exports = {
    SHOP_ITEMS,
    SHOP_ITEMS_BY_ID,
    EQUIPPABLE_SLOTS,
};
