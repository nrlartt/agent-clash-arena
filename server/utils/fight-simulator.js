// ═══════════════════════════════════════════════════════════════
// FIGHT SIMULATOR — Server-authoritative fight engine
// Runs a tick-based simulation on the server and streams state
// to all clients. Every client sees the same HP, rounds, and
// outcome. The GameEngine on the client only handles visuals.
// ═══════════════════════════════════════════════════════════════

'use strict';

const logger = require('./logger');

// ── Timing constants ──
const TICK_MS = 500;              // Server ticks every 500ms
const ROUND_DURATION_S = 60;      // 60 seconds per round
const MAX_ROUNDS = 3;             // 3 rounds per fight
const ROUND_PAUSE_MS = 3000;      // 3s pause between rounds
const HP_RECOVERY_PCT = 0.20;     // 20% HP recovery between rounds
const BASE_HP = 550;              // Base fighter HP
const COMBO_WINDOW_TICKS = 6;     // 3 seconds = 6 ticks

class FightSimulator {
    /**
     * @param {Object} opts
     * @param {Object} opts.agent1 - Formatted agent data (from matchmaker)
     * @param {Object} opts.agent2 - Formatted agent data (from matchmaker)
     * @param {import('socket.io').Server} opts.io - Socket.IO server
     * @param {string} opts.matchId - Current match ID
     * @param {Function} opts.onEnd - Callback when fight ends: onEnd(result)
     */
    constructor({ agent1, agent2, io, matchId, onEnd }) {
        this.io = io;
        this.matchId = matchId;
        this.onEnd = onEnd;
        this.agent1Data = agent1;
        this.agent2Data = agent2;

        this.fighters = {
            '1': this._initFighter('1', agent1),
            '2': this._initFighter('2', agent2),
        };

        this.round = 1;
        this.roundElapsedMs = 0;
        this.totalElapsedMs = 0;
        this.state = 'fighting'; // 'fighting' | 'round_pause' | 'finished'
        this.pauseEndMs = 0;
        this.winner = null;
        this.method = null;
        this.tickInterval = null;
        this.tickCount = 0;
        this._lastTick = null;
        this._ended = false;
    }

    // ── Initialize a fighter from agent data ──
    _initFighter(id, agent) {
        const eb = agent.equipmentBonus || {};
        const maxHp = BASE_HP + (eb.maxHP || 0);
        const pr = agent.powerRating || 50;

        return {
            id,
            name: agent.name,
            hp: maxHp,
            maxHp,
            score: 0,
            hitsLanded: 0,
            critHits: 0,
            dodges: 0,
            combo: 0,
            maxCombo: 0,
            lastHitTick: -100,
            specialMeter: 0,
            specialReady: false,

            // Cooldown in ticks
            attackCooldownTicks: Math.max(2, Math.round((1500 - (eb.attackSpeed || 0) * 40) / TICK_MS)),
            lastAttackTick: -100,

            // Combat stats from equipment
            bonusDamage: eb.damage || 0,
            defense: eb.defense || 0,
            critChance: 7 + (eb.critChance || 0),
            critDamage: 155 + (eb.critDamage || 0),
            lifesteal: eb.lifesteal || 0,
            dodgeChance: 5 + (eb.dodgeChance || 0),
            burnDamage: eb.burnDamage || 0,
            armorPen: eb.armorPen || 0,
            lowHPBonus: eb.lowHPBonus || 0,
            thornDamage: eb.thornDamage || 0,
            reflect: eb.reflect || 0,
            slowEffect: eb.slowEffect || 0,

            // Derived
            powerRating: pr,
            baseDamage: 12 + pr * 0.15,
            strategy: agent.strategy || 'balanced',

            // Per-tick status flags (visual + logic)
            isAttacking: false,
            isDefending: false,
            isDodging: false,
            isBurning: false,
            burnEndTick: 0,
            isStunned: false,
            stunEndTick: 0,
            isSlowed: false,
            slowEndTick: 0,
        };
    }

    // ── Public API ──

    start() {
        logger.info(`[FightSim] Starting: ${this.agent1Data.name} vs ${this.agent2Data.name} (${this.matchId})`);
        this._emitFightEvent('round_start', '🔔', `Round 1 — FIGHT!`, '#836EF9');
        this.tickInterval = setInterval(() => this._tick(), TICK_MS);
        this._emitState();
    }

    stop() {
        if (this.tickInterval) {
            clearInterval(this.tickInterval);
            this.tickInterval = null;
        }
    }

    getLastTick() {
        return this._lastTick;
    }

    /** Force-stop and return current state as result */
    forceEnd() {
        this.stop();
        if (this._ended) return;
        const f1 = this.fighters['1'];
        const f2 = this.fighters['2'];
        const winnerId = f1.hp >= f2.hp ? '1' : '2';
        this._finish(winnerId, 'Decision');
    }

    // ── Tick loop ──

    _tick() {
        if (this.state === 'finished') {
            this.stop();
            return;
        }

        this.tickCount++;
        this.totalElapsedMs += TICK_MS;

        // ── Round pause state ──
        if (this.state === 'round_pause') {
            if (this.totalElapsedMs >= this.pauseEndMs) {
                this.state = 'fighting';
                this.roundElapsedMs = 0;
                this._emitFightEvent('round_start', '🔔', `Round ${this.round} — FIGHT!`, '#836EF9');
            }
            this._emitState();
            return;
        }

        // ── Fighting state ──
        this.roundElapsedMs += TICK_MS;

        // Reset per-tick visual flags
        const f1 = this.fighters['1'];
        const f2 = this.fighters['2'];
        f1.isAttacking = false;
        f1.isDefending = false;
        f1.isDodging = false;
        f2.isAttacking = false;
        f2.isDefending = false;
        f2.isDodging = false;

        // Update status effects
        this._updateEffects(f1);
        this._updateEffects(f2);

        // Process actions
        if (!f1.isStunned) this._processAction('1', '2');
        if (!f2.isStunned) this._processAction('2', '1');

        // Burn DOT
        this._processBurn('1');
        this._processBurn('2');

        // Check KO
        if (f1.hp <= 0 || f2.hp <= 0) {
            const koWinner = f1.hp > 0 ? '1' : (f2.hp > 0 ? '2' : (f1.score >= f2.score ? '1' : '2'));
            this._finish(koWinner, 'KO');
            return;
        }

        // Check round end
        if (this.roundElapsedMs >= ROUND_DURATION_S * 1000) {
            if (this.round >= MAX_ROUNDS) {
                const w = f1.hp > f2.hp ? '1' : (f2.hp > f1.hp ? '2' : (f1.score >= f2.score ? '1' : '2'));
                this._finish(w, 'Decision');
                return;
            }
            this._endRound();
        }

        this._emitState();
    }

    // ── Status effect expiry ──
    _updateEffects(f) {
        if (f.burnEndTick > 0 && this.tickCount > f.burnEndTick) {
            f.isBurning = false;
            f.burnEndTick = 0;
        }
        if (f.stunEndTick > 0 && this.tickCount > f.stunEndTick) {
            f.isStunned = false;
            f.stunEndTick = 0;
        }
        if (f.slowEndTick > 0 && this.tickCount > f.slowEndTick) {
            f.isSlowed = false;
            f.slowEndTick = 0;
        }
    }

    // ── Action processing ──
    _processAction(attackerId, defenderId) {
        const attacker = this.fighters[attackerId];
        const defender = this.fighters[defenderId];

        // Check cooldown
        const ticksSince = this.tickCount - attacker.lastAttackTick;
        const effectiveCooldown = attacker.isSlowed
            ? Math.ceil(attacker.attackCooldownTicks * 1.5)
            : attacker.attackCooldownTicks;

        if (ticksSince < effectiveCooldown) return;

        // Strategy-driven aggression
        const baseAgg = attacker.strategy === 'aggressive' ? 0.75
            : attacker.strategy === 'defensive' ? 0.45
            : 0.60;

        // Dynamic adjustments
        const hpPct = attacker.hp / attacker.maxHp;
        const defHpPct = defender.hp / defender.maxHp;
        let agg = baseAgg;
        if (hpPct < 0.25) agg += 0.20;       // Berserker
        if (defHpPct < 0.2) agg += 0.15;      // Smell blood
        if (attacker.specialReady) agg += 0.10;
        agg = Math.min(1.0, agg);

        // Roll for action
        const roll = Math.random();
        const attackChance = agg * 0.55;
        const heavyChance = agg * 0.12;
        const specialChance = attacker.specialReady ? 0.08 : 0;
        const defendChance = (1 - agg) * 0.30;

        if (roll < attackChance) {
            this._performAttack(attackerId, defenderId, false);
        } else if (roll < attackChance + heavyChance) {
            this._performAttack(attackerId, defenderId, true);
        } else if (roll < attackChance + heavyChance + specialChance) {
            this._performSpecial(attackerId, defenderId);
        } else if (roll < attackChance + heavyChance + specialChance + defendChance) {
            attacker.isDefending = true;
        }
        // else: reposition (no action)

        attacker.lastAttackTick = this.tickCount;
    }

    // ── Normal/Heavy attack ──
    _performAttack(attackerId, defenderId, isHeavy) {
        const attacker = this.fighters[attackerId];
        const defender = this.fighters[defenderId];
        attacker.isAttacking = true;

        // Block check
        if (defender.isDefending) {
            const reducedDmg = Math.round(attacker.baseDamage * 0.3);
            defender.hp = Math.max(0, defender.hp - reducedDmg);

            // Stun attacker
            attacker.isStunned = true;
            attacker.stunEndTick = this.tickCount + 1;

            // Reflect
            if (defender.reflect > 0) {
                attacker.hp = Math.max(0, attacker.hp - Math.round(reducedDmg * defender.reflect / 100));
            }

            this._emitFightEvent('block', '🛡️',
                `${defender.name} blocked ${attacker.name}'s attack! (-${reducedDmg})`, '#836EF9');
            return;
        }

        // Dodge check
        if (Math.random() * 100 < defender.dodgeChance) {
            defender.isDodging = true;
            defender.dodges++;
            this._emitFightEvent('dodge', '💨',
                `${defender.name} dodged ${attacker.name}'s attack!`, '#00F5FF');
            return;
        }

        // ── Damage calculation ──
        let dmg = attacker.baseDamage + (isHeavy ? 8 : 0) + Math.random() * 12;
        dmg += attacker.bonusDamage * 0.7;

        // Low HP bonus
        if (attacker.lowHPBonus > 0 && attacker.hp / attacker.maxHp < 0.3) {
            dmg *= 1 + attacker.lowHPBonus / 100;
        }

        // Crit
        let isCrit = false;
        const effectiveCrit = isHeavy ? attacker.critChance * 1.5 : attacker.critChance;
        if (Math.random() * 100 < effectiveCrit) {
            dmg *= attacker.critDamage / 100;
            isCrit = true;
            attacker.critHits++;
        }

        // Defense reduction (capped at 40%)
        const effDef = Math.max(0, defender.defense - attacker.armorPen);
        dmg *= 1 - Math.min(0.4, effDef / (effDef + 60));

        const damage = Math.round(Math.max(2, dmg));
        defender.hp = Math.max(0, defender.hp - damage);
        attacker.score += damage;
        attacker.hitsLanded++;

        // Combo
        if (this.tickCount - attacker.lastHitTick <= COMBO_WINDOW_TICKS) {
            attacker.combo++;
            if (attacker.combo > attacker.maxCombo) attacker.maxCombo = attacker.combo;
        } else {
            attacker.combo = 1;
        }
        attacker.lastHitTick = this.tickCount;

        // Special meter
        attacker.specialMeter = Math.min(100,
            attacker.specialMeter + 8 + (isCrit ? 12 : 0) + (attacker.combo >= 3 ? 6 : 0));
        if (attacker.specialMeter >= 100 && !attacker.specialReady) {
            attacker.specialReady = true;
            this._emitFightEvent('special_ready', '⚡',
                `${attacker.name}'s SPECIAL is ready!`, '#FFE93E');
        }

        // Lifesteal
        if (attacker.lifesteal > 0) {
            attacker.hp = Math.min(attacker.maxHp, attacker.hp + Math.round(damage * attacker.lifesteal / 100));
        }

        // Thorn
        if (defender.thornDamage > 0) {
            attacker.hp = Math.max(0, attacker.hp - defender.thornDamage);
        }

        // Burn
        if (attacker.burnDamage > 0) {
            defender.isBurning = true;
            defender.burnEndTick = this.tickCount + 5;
        }

        // Slow
        if (attacker.slowEffect > 0) {
            defender.isSlowed = true;
            defender.slowEndTick = this.tickCount + 3;
        }

        // Emit fight event for activity feed
        this._emitHitEvent(attacker, defender, damage, isCrit, isHeavy);
    }

    // ── Special attack ──
    _performSpecial(attackerId, defenderId) {
        const attacker = this.fighters[attackerId];
        const defender = this.fighters[defenderId];
        if (!attacker.specialReady) return;

        attacker.isAttacking = true;
        attacker.specialMeter = 0;
        attacker.specialReady = false;

        // Special: 2x-3x base damage, always crits
        let dmg = attacker.baseDamage * (2 + Math.random());
        dmg += attacker.bonusDamage;
        dmg *= attacker.critDamage / 100;
        attacker.critHits++;

        const effDef = Math.max(0, defender.defense - attacker.armorPen);
        dmg *= 1 - Math.min(0.4, effDef / (effDef + 60));

        const damage = Math.round(Math.max(5, dmg));
        defender.hp = Math.max(0, defender.hp - damage);
        attacker.score += damage;
        attacker.hitsLanded++;

        // Combo
        if (this.tickCount - attacker.lastHitTick <= COMBO_WINDOW_TICKS) {
            attacker.combo++;
            if (attacker.combo > attacker.maxCombo) attacker.maxCombo = attacker.combo;
        } else {
            attacker.combo = 1;
        }
        attacker.lastHitTick = this.tickCount;

        // Lifesteal
        if (attacker.lifesteal > 0) {
            attacker.hp = Math.min(attacker.maxHp, attacker.hp + Math.round(damage * attacker.lifesteal / 100));
        }

        this._emitFightEvent('special', '🌟',
            `${attacker.name} SPECIAL MOVE on ${defender.name}! -${damage}`, '#FFE93E');
    }

    // ── Burn DOT ──
    _processBurn(fighterId) {
        const f = this.fighters[fighterId];
        if (!f.isBurning) return;
        f.hp = Math.max(0, f.hp - 2);
    }

    // ── Round management ──
    _endRound() {
        const f1 = this.fighters['1'];
        const f2 = this.fighters['2'];

        this._emitFightEvent('round_end', '🔔',
            `Round ${this.round} ended! ${f1.name}: ${f1.hp}HP | ${f2.name}: ${f2.hp}HP`, '#836EF9');

        this.round++;
        this.state = 'round_pause';
        this.pauseEndMs = this.totalElapsedMs + ROUND_PAUSE_MS;

        // Heal between rounds
        f1.hp = Math.min(f1.maxHp, f1.hp + Math.round(f1.maxHp * HP_RECOVERY_PCT));
        f2.hp = Math.min(f2.maxHp, f2.hp + Math.round(f2.maxHp * HP_RECOVERY_PCT));

        // Reset combos
        f1.combo = 0;
        f2.combo = 0;

        // Bonus special meter
        f1.specialMeter = Math.min(100, f1.specialMeter + 10);
        f2.specialMeter = Math.min(100, f2.specialMeter + 10);

        // Clear effects
        [f1, f2].forEach(f => {
            f.isBurning = false; f.burnEndTick = 0;
            f.isStunned = false; f.stunEndTick = 0;
            f.isSlowed = false;  f.slowEndTick = 0;
        });

        logger.info(`[FightSim] Round ${this.round - 1} ended. ${f1.name}: ${f1.hp}HP, ${f2.name}: ${f2.hp}HP`);
    }

    // ── Match finish ──
    _finish(winnerId, method) {
        if (this._ended) return;
        this._ended = true;
        this.state = 'finished';
        this.winner = winnerId;
        this.method = method;
        this.stop();

        const f1 = this.fighters['1'];
        const f2 = this.fighters['2'];
        const winner = winnerId === '1' ? f1 : f2;
        const loser = winnerId === '1' ? f2 : f1;

        const text = method === 'KO'
            ? `${winner.name} KNOCKED OUT ${loser.name}!`
            : `${winner.name} wins by DECISION! (${winner.hp}HP vs ${loser.hp}HP)`;

        this._emitFightEvent(method === 'KO' ? 'ko' : 'decision',
            method === 'KO' ? '💀' : '⚖️', text, '#FFE93E');

        // Emit final state
        this._emitState();

        const result = {
            winnerId,
            method,
            duration: Math.round(this.totalElapsedMs / 1000),
            round: this.round,
            fighters: {
                '1': this._exportFighter(f1),
                '2': this._exportFighter(f2),
            },
        };

        logger.info(`[FightSim] Fight ended: ${winner.name} wins by ${method} in ${result.duration}s`);

        if (this.onEnd) {
            // Use setImmediate to avoid calling onEnd within the same tick
            setImmediate(() => this.onEnd(result));
        }
    }

    // ── Emit helpers ──

    _emitState() {
        const roundTimeRemaining = this.state === 'round_pause'
            ? ROUND_DURATION_S
            : Math.max(0, ROUND_DURATION_S - Math.floor(this.roundElapsedMs / 1000));

        const tick = {
            matchId: this.matchId,
            fighters: {
                '1': this._tickFighter(this.fighters['1']),
                '2': this._tickFighter(this.fighters['2']),
            },
            round: this.round,
            maxRounds: MAX_ROUNDS,
            roundTimer: roundTimeRemaining,
            roundPaused: this.state === 'round_pause',
            finished: this.state === 'finished',
            winner: this.winner,
            method: this.method,
        };

        this._lastTick = tick;

        try {
            this.io.emit('match:fight_tick', tick);
        } catch (err) {
            logger.warn('[FightSim] Failed to emit fight tick', { error: err.message });
        }
    }

    _emitFightEvent(type, icon, text, color) {
        try {
            this.io.emit('match:fight_event', {
                type,
                icon,
                text,
                color,
                timestamp: Date.now(),
            });
        } catch { /* ignore */ }
    }

    _emitHitEvent(attacker, defender, damage, isCrit, isHeavy) {
        let text;
        if (isCrit && attacker.combo >= 3) {
            text = `${attacker.name} ${attacker.combo}x COMBO CRIT on ${defender.name}! -${damage}`;
        } else if (isCrit) {
            text = `${attacker.name} CRITICAL HIT on ${defender.name}! -${damage}`;
        } else if (attacker.combo >= 3) {
            text = `${attacker.name} ${attacker.combo}x COMBO on ${defender.name}! -${damage}`;
        } else if (isHeavy) {
            text = `${attacker.name} HEAVY ATTACK on ${defender.name}! -${damage}`;
        } else {
            text = `${attacker.name} hit ${defender.name} for ${damage} DMG`;
        }

        const eventType = isCrit ? 'critical' : (attacker.combo >= 3 ? 'combo' : (isHeavy ? 'heavy' : 'hit'));
        const icon = isCrit ? '💥' : (attacker.combo >= 3 ? '⚡' : (isHeavy ? '🔥' : '👊'));
        const color = isCrit ? '#FFE93E' : '#FF6B35';

        this._emitFightEvent(eventType, icon, text, color);
    }

    _tickFighter(f) {
        return {
            hp: f.hp,
            maxHp: f.maxHp,
            score: f.score,
            hitsLanded: f.hitsLanded,
            critHits: f.critHits,
            dodges: f.dodges,
            combo: f.combo,
            maxCombo: f.maxCombo,
            specialMeter: f.specialMeter,
            specialReady: f.specialReady,
            isAttacking: f.isAttacking,
            isDefending: f.isDefending,
            isDodging: f.isDodging,
            isBurning: f.isBurning,
            isStunned: f.isStunned,
            isSlowed: f.isSlowed,
        };
    }

    _exportFighter(f) {
        return {
            hp: f.hp,
            maxHp: f.maxHp,
            score: f.score,
            hitsLanded: f.hitsLanded,
            critHits: f.critHits,
            dodges: f.dodges,
            combo: f.combo,
            maxCombo: f.maxCombo,
            specialMeter: f.specialMeter,
        };
    }
}

module.exports = FightSimulator;
