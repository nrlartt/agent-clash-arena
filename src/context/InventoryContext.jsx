// ═══════════════════════════════════════════════════════════════
// INVENTORY CONTEXT — Global state for agent inventories
// Handles: buying items, equipping/unequipping, gold management
// ═══════════════════════════════════════════════════════════════

import { createContext, useContext, useReducer, useCallback } from 'react';
import { SHOP_ITEMS, AGENT_INVENTORIES as INITIAL_INVENTORIES, RARITY } from '../data/inventory';
import { AGENTS } from '../data/mockData';

const InventoryContext = createContext();

// ── Deep clone initial inventories for mutable state ──
function getInitialState() {
    const inventories = {};

    // Set up inventories for all agents with owners
    AGENTS.filter(a => a.owner).forEach(agent => {
        const existing = INITIAL_INVENTORIES[agent.id];
        if (existing) {
            inventories[agent.id] = {
                gold: existing.gold,
                equipped: { ...existing.equipped },
                backpack: [...(existing.backpack || [])],
            };
        } else {
            // Default inventory for agents without pre-set inventory
            inventories[agent.id] = {
                gold: 1000,
                equipped: { weapon: null, armor: null, boots: null, amulet: null, rune: null },
                backpack: [],
            };
        }
    });

    return {
        inventories,
        purchaseHistory: [],
        lastAction: null,
    };
}

// ── Reducer ──
function inventoryReducer(state, action) {
    switch (action.type) {
        case 'BUY_ITEM': {
            const { agentId, item } = action.payload;
            const inv = state.inventories[agentId];
            if (!inv || inv.gold < item.price) return state;

            const newInv = {
                ...inv,
                gold: inv.gold - item.price,
                backpack: [...inv.backpack, { ...item, purchasedAt: Date.now() }],
            };

            return {
                ...state,
                inventories: { ...state.inventories, [agentId]: newInv },
                purchaseHistory: [
                    { agentId, item, timestamp: Date.now() },
                    ...state.purchaseHistory,
                ],
                lastAction: {
                    type: 'buy',
                    agentId,
                    item,
                    message: `${AGENTS.find(a => a.id === agentId)?.name} bought ${item.name} for ${item.price} MON`,
                },
            };
        }

        case 'EQUIP_ITEM': {
            const { agentId, item, slot } = action.payload;
            const inv = state.inventories[agentId];
            if (!inv) return state;

            const backpackIdx = inv.backpack.findIndex(i => i.id === item.id);
            if (backpackIdx === -1) return state;

            // Move currently equipped item (if any) back to backpack
            const newBackpack = [...inv.backpack];
            newBackpack.splice(backpackIdx, 1); // Remove from backpack

            const currentlyEquipped = inv.equipped[slot];
            if (currentlyEquipped) {
                newBackpack.push(currentlyEquipped); // Put old item in backpack
            }

            const newInv = {
                ...inv,
                equipped: { ...inv.equipped, [slot]: item },
                backpack: newBackpack,
            };

            return {
                ...state,
                inventories: { ...state.inventories, [agentId]: newInv },
                lastAction: {
                    type: 'equip',
                    agentId,
                    item,
                    message: `${AGENTS.find(a => a.id === agentId)?.name} equipped ${item.name}`,
                },
            };
        }

        case 'UNEQUIP_ITEM': {
            const { agentId, slot } = action.payload;
            const inv = state.inventories[agentId];
            if (!inv || !inv.equipped[slot]) return state;

            const removedItem = inv.equipped[slot];

            const newInv = {
                ...inv,
                equipped: { ...inv.equipped, [slot]: null },
                backpack: [...inv.backpack, removedItem],
            };

            return {
                ...state,
                inventories: { ...state.inventories, [agentId]: newInv },
                lastAction: {
                    type: 'unequip',
                    agentId,
                    item: removedItem,
                    message: `${AGENTS.find(a => a.id === agentId)?.name} unequipped ${removedItem.name}`,
                },
            };
        }

        case 'BUY_AND_EQUIP': {
            const { agentId, item } = action.payload;
            const inv = state.inventories[agentId];
            if (!inv || inv.gold < item.price) return state;

            const slot = item.category;
            if (!slot || slot === 'potion') {
                // Potions go to backpack only
                return inventoryReducer(state, { type: 'BUY_ITEM', payload: { agentId, item } });
            }

            // Move currently equipped to backpack
            const currentlyEquipped = inv.equipped[slot];
            const newBackpack = [...inv.backpack];
            if (currentlyEquipped) {
                newBackpack.push(currentlyEquipped);
            }

            const newInv = {
                ...inv,
                gold: inv.gold - item.price,
                equipped: { ...inv.equipped, [slot]: item },
                backpack: newBackpack,
            };

            return {
                ...state,
                inventories: { ...state.inventories, [agentId]: newInv },
                purchaseHistory: [
                    { agentId, item, timestamp: Date.now(), autoEquipped: true },
                    ...state.purchaseHistory,
                ],
                lastAction: {
                    type: 'buy_equip',
                    agentId,
                    item,
                    message: `${AGENTS.find(a => a.id === agentId)?.name} bought & equipped ${item.name} for ${item.price} MON`,
                },
            };
        }

        case 'ADD_GOLD': {
            const { agentId, amount } = action.payload;
            const inv = state.inventories[agentId];
            if (!inv) return state;

            return {
                ...state,
                inventories: {
                    ...state.inventories,
                    [agentId]: { ...inv, gold: inv.gold + amount },
                },
                lastAction: {
                    type: 'gold',
                    agentId,
                    message: `${AGENTS.find(a => a.id === agentId)?.name} received ${amount} MON`,
                },
            };
        }

        case 'CLEAR_ACTION':
            return { ...state, lastAction: null };

        default:
            return state;
    }
}

// ── Provider ──
export function InventoryProvider({ children }) {
    const [state, dispatch] = useReducer(inventoryReducer, null, getInitialState);

    const buyItem = useCallback((agentId, item) => {
        dispatch({ type: 'BUY_ITEM', payload: { agentId, item } });
    }, []);

    const buyAndEquip = useCallback((agentId, item) => {
        dispatch({ type: 'BUY_AND_EQUIP', payload: { agentId, item } });
    }, []);

    const equipItem = useCallback((agentId, item, slot) => {
        dispatch({ type: 'EQUIP_ITEM', payload: { agentId, item, slot } });
    }, []);

    const unequipItem = useCallback((agentId, slot) => {
        dispatch({ type: 'UNEQUIP_ITEM', payload: { agentId, slot } });
    }, []);

    const addGold = useCallback((agentId, amount) => {
        dispatch({ type: 'ADD_GOLD', payload: { agentId, amount } });
    }, []);

    const clearAction = useCallback(() => {
        dispatch({ type: 'CLEAR_ACTION' });
    }, []);

    const getInventory = useCallback((agentId) => {
        return state.inventories[agentId] || null;
    }, [state.inventories]);

    const canAfford = useCallback((agentId, price) => {
        const inv = state.inventories[agentId];
        return inv ? inv.gold >= price : false;
    }, [state.inventories]);

    const value = {
        inventories: state.inventories,
        purchaseHistory: state.purchaseHistory,
        lastAction: state.lastAction,
        buyItem,
        buyAndEquip,
        equipItem,
        unequipItem,
        addGold,
        clearAction,
        getInventory,
        canAfford,
    };

    return (
        <InventoryContext.Provider value={value}>
            {children}
        </InventoryContext.Provider>
    );
}

export function useInventory() {
    const ctx = useContext(InventoryContext);
    if (!ctx) throw new Error('useInventory must be used within InventoryProvider');
    return ctx;
}
