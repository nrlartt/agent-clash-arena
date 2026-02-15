// ═══════════════════════════════════════════════════════════════
// GAME ENGINE v4 — Full 60-Second Rounds, Phase-Based AI
// Dramatic pacing: approach → engage → flurry → reposition
// HP scaled for long rounds, momentum-driven comebacks
// ═══════════════════════════════════════════════════════════════

import Matter from 'matter-js';

const { Engine, World, Bodies, Body, Composite, Vector } = Matter;

// AI combat phases
const AI_PHASE = {
    APPROACH: 'approach',     // Close distance
    ENGAGE: 'engage',         // Fight at medium range
    FLURRY: 'flurry',         // Rapid attacks
    REPOSITION: 'reposition', // Circle/retreat
    DASH: 'dash',             // Lunge attack
};

export class GameEngine {
    constructor(width, height) {
        this.width = width;
        this.height = height;
        this.engine = Engine.create({ gravity: { x: 0, y: 0 } });
        this.world = this.engine.world;
        this.agents = {};
        this.weapons = {};
        this.particles = [];
        this.hitEffects = [];
        this.comboEffects = [];
        this.shakeIntensity = 0;
        this.gameTime = 0;
        this.isRunning = false;
        this.isFinished = false;
        this.isPaused = false;
        this.winner = null;
        this.finishReason = null;
        this.finishTime = 0;

        // ── Match timing: 3 × 60s rounds ──
        this.roundTime = 60;
        this.currentRound = 1;
        this.maxRounds = 3;
        this.roundTimer = this.roundTime;
        this.roundPauseUntil = 0;
        this.roundJustStarted = 0;

        this.momentum = { '1': 0, '2': 0 };

        // Server-authoritative mode: when true, HP/rounds/finish
        // are controlled by server fight ticks. Local engine only
        // handles visuals (movement, particles, animations).
        this.serverDriven = false;
        this._lastServerRound = 1;

        // Callbacks
        this.onHit = null;
        this.onUpdate = null;
        this.onGameEnd = null;
        this.onRoundEnd = null;

        this._createBounds();
    }

    _createBounds() {
        const t = 40;
        const walls = [
            Bodies.rectangle(this.width / 2, -t / 2, this.width + t * 2, t, { isStatic: true, label: 'wall' }),
            Bodies.rectangle(this.width / 2, this.height + t / 2, this.width + t * 2, t, { isStatic: true, label: 'wall' }),
            Bodies.rectangle(-t / 2, this.height / 2, t, this.height + t * 2, { isStatic: true, label: 'wall' }),
            Bodies.rectangle(this.width + t / 2, this.height / 2, t, this.height + t * 2, { isStatic: true, label: 'wall' }),
        ];
        walls.forEach(w => { w.render = { visible: false }; w.restitution = 0.8; });
        Composite.add(this.world, walls);
    }

    addAgent(id, x, y, color, equipmentBonus = null) {
        const body = Bodies.circle(x, y, 28, {
            label: `agent-${id}`,
            frictionAir: 0.035,
            restitution: 0.65,
            density: 0.002,
        });

        const weaponLength = 60;
        const weaponBody = Bodies.rectangle(x + 40, y, weaponLength, 6, {
            label: `weapon-${id}`,
            frictionAir: 0.02,
            density: 0.001,
        });

        const constraint = Matter.Constraint.create({
            bodyA: body,
            bodyB: weaponBody,
            pointA: { x: 20, y: 0 },
            pointB: { x: -weaponLength / 2, y: 0 },
            stiffness: 0.25,
            damping: 0.05,
            length: 8,
        });

        Composite.add(this.world, [body, weaponBody, constraint]);

        const eb = equipmentBonus || {};
        const baseHP = 550;   // Higher base HP — KO should be rare and dramatic
        const maxHp = baseHP + (eb.maxHP || 0);

        this.agents[id] = {
            body, color,
            hp: maxHp, maxHp,
            score: 0,
            lastAttack: 0,
            isAttacking: false,
            attackCooldown: Math.max(300, 550 - (eb.attackSpeed || 0) * 20),
            weaponLength,
            invincible: 0,

            // Equipment
            bonusDamage: eb.damage || 0,
            defense: eb.defense || 0,
            speedBonus: eb.speed || 0,
            critChance: 7 + (eb.critChance || 0),
            critDamage: 155 + (eb.critDamage || 0),
            lifesteal: eb.lifesteal || 0,
            dodgeChance: eb.dodgeChance || 0,
            burnDamage: eb.burnDamage || 0,
            reflect: eb.reflect || 0,
            thornDamage: eb.thornDamage || 0,
            slowEffect: eb.slowEffect || 0,
            armorPen: eb.armorPen || 0,
            lowHPBonus: eb.lowHPBonus || 0,

            // Combat
            combo: 0, maxCombo: 0,
            lastHitTime: 0,
            comboWindowMs: 3000,
            specialMeter: 0, specialReady: false,
            isDefending: false, defendUntil: 0,
            isDodging: false, dodgeUntil: 0,
            stunUntil: 0, burnUntil: 0, slowUntil: 0,
            hitsTaken: 0, hitsLanded: 0, critHits: 0, dodges: 0,

            // AI state machine
            aiPhase: AI_PHASE.APPROACH,
            aiPhaseTimer: 0,         // when to switch phase
            aiFlurryCount: 0,        // attacks remaining in flurry
            aiDashTarget: null,      // dash destination
            aiDashUntil: 0,

            // Personality — unique per agent
            personality: {
                aggression: 0.5 + Math.random() * 0.35,    // 0.5–0.85
                speed: 0.8 + Math.random() * 0.4,          // 0.8–1.2
                flurryChance: 0.15 + Math.random() * 0.15,  // 0.15–0.30
                dashChance: 0.08 + Math.random() * 0.12,    // 0.08–0.20
                defenseChance: 0.05 + Math.random() * 0.1,  // 0.05–0.15
            },
        };

        this.weapons[id] = { body: weaponBody, constraint };
        return this.agents[id];
    }

    // ═══════════════════════════════════════════════════════════
    // AI SYSTEM — Phase-based with transitions
    // ═══════════════════════════════════════════════════════════

    _aiTick(id) {
        const agent = this.agents[id];
        const otherId = Object.keys(this.agents).find(k => k !== id);
        if (!agent || !otherId) return;
        if (agent.stunUntil > this.gameTime) return;

        const other = this.agents[otherId];
        const pos = agent.body.position;
        const oPos = other.body.position;
        const dx = oPos.x - pos.x;
        const dy = oPos.y - pos.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const angle = Math.atan2(dy, dx);
        const now = this.gameTime;
        const p = agent.personality;

        // ── Dynamic aggression ──
        const hpPct = agent.hp / agent.maxHp;
        const oHpPct = other.hp / other.maxHp;
        let agg = p.aggression;
        if (hpPct > oHpPct + 0.15) agg += 0.12;
        if (hpPct < 0.25) agg += 0.25;           // Berserker
        if (oHpPct < 0.2) agg += 0.2;            // Smell blood
        if (agent.specialReady) agg += 0.1;
        agg += (this.momentum[id] || 0) * 0.03;
        agg = Math.min(1.0, Math.max(0.3, agg));

        const speedMult = p.speed * (1 + (agent.speedBonus || 0) * 0.01);
        const slowMult = agent.slowUntil > now ? 0.5 : 1;
        const spd = speedMult * slowMult;

        // ── Phase transitions ──
        if (now > agent.aiPhaseTimer) {
            this._aiChoosePhase(id, dist, agg);
        }

        // ── Execute current phase ──
        switch (agent.aiPhase) {
            case AI_PHASE.APPROACH:
                this._aiApproach(agent, angle, dist, spd);
                break;
            case AI_PHASE.ENGAGE:
                this._aiEngage(id, agent, other, angle, dist, spd, agg, now);
                break;
            case AI_PHASE.FLURRY:
                this._aiFlurry(id, agent, angle, dist, spd, now);
                break;
            case AI_PHASE.REPOSITION:
                this._aiReposition(id, agent, angle, dist, spd, now);
                break;
            case AI_PHASE.DASH:
                this._aiDash(id, agent, oPos, angle, dist, spd, now);
                break;
        }

        // ── Defend reactively (any phase) ──
        if (dist < 80 && !agent.isDefending && !agent.isAttacking && Math.random() < p.defenseChance * 0.5) {
            this._defend(id);
        }

        // ── Keep in bounds ──
        const pad = 50;
        const f = 0.0012;
        if (pos.x < pad) Body.applyForce(agent.body, pos, { x: f, y: 0 });
        if (pos.x > this.width - pad) Body.applyForce(agent.body, pos, { x: -f, y: 0 });
        if (pos.y < pad) Body.applyForce(agent.body, pos, { x: 0, y: f });
        if (pos.y > this.height - pad) Body.applyForce(agent.body, pos, { x: 0, y: -f });
    }

    _aiChoosePhase(id, dist, agg) {
        const agent = this.agents[id];
        const p = agent.personality;
        const roll = Math.random();

        if (dist > 200) {
            agent.aiPhase = AI_PHASE.APPROACH;
            agent.aiPhaseTimer = this.gameTime + 1500 + Math.random() * 1000;
        } else if (roll < p.dashChance * agg && dist > 100) {
            agent.aiPhase = AI_PHASE.DASH;
            agent.aiPhaseTimer = this.gameTime + 600;
        } else if (roll < p.flurryChance * agg + p.dashChance * agg) {
            agent.aiPhase = AI_PHASE.FLURRY;
            agent.aiFlurryCount = 3 + Math.floor(Math.random() * 4);
            agent.aiPhaseTimer = this.gameTime + 2000 + Math.random() * 1500;
        } else if (roll < 0.3 * (1 - agg)) {
            agent.aiPhase = AI_PHASE.REPOSITION;
            agent.aiPhaseTimer = this.gameTime + 1500 + Math.random() * 2000;
        } else {
            agent.aiPhase = AI_PHASE.ENGAGE;
            agent.aiPhaseTimer = this.gameTime + 2500 + Math.random() * 3000;
        }
    }

    _aiApproach(agent, angle, dist, spd) {
        const jitter = (Math.random() - 0.5) * 0.3;
        const force = dist > 250 ? 0.0012 : 0.0008;
        Body.applyForce(agent.body, agent.body.position, {
            x: Math.cos(angle + jitter) * force * spd,
            y: Math.sin(angle + jitter) * force * spd,
        });
    }

    _aiEngage(id, agent, other, angle, dist, spd, agg, now) {
        // Maintain optimal distance (80-130)
        const optDist = 105;
        if (dist > optDist + 30) {
            // Move closer with slight flanking
            const flank = Math.sin(now / 1200 + (id === '1' ? 0 : 3.14)) * 0.5;
            Body.applyForce(agent.body, agent.body.position, {
                x: Math.cos(angle + flank) * 0.0007 * spd,
                y: Math.sin(angle + flank) * 0.0007 * spd,
            });
        } else if (dist < optDist - 20) {
            // Back off slightly
            Body.applyForce(agent.body, agent.body.position, {
                x: -Math.cos(angle) * 0.0005 * spd,
                y: -Math.sin(angle) * 0.0005 * spd,
            });
        } else {
            // Circle at optimal range
            const circleDir = id === '1' ? 1 : -1;
            const perpAngle = angle + (Math.PI / 2) * circleDir;
            Body.applyForce(agent.body, agent.body.position, {
                x: Math.cos(perpAngle) * 0.0004 * spd,
                y: Math.sin(perpAngle) * 0.0004 * spd,
            });
        }

        // Attack when in range
        const canAttack = now - agent.lastAttack > agent.attackCooldown;
        if (dist < 150 && canAttack) {
            if (agent.specialReady && Math.random() < 0.25) {
                this._specialAttack(id, angle);
            } else if (Math.random() < agg * 0.3) {
                this._attack(id, angle);
            } else if (Math.random() < 0.06) {
                this._heavyAttack(id, angle);
            }
        }

        // Dodge incoming if close
        if (dist < 60 && Math.random() < 0.04 && !agent.isDodging) {
            this._dodge(id);
        }
    }

    _aiFlurry(id, agent, angle, dist, spd, now) {
        // Rush in and attack rapidly
        if (dist > 80) {
            Body.applyForce(agent.body, agent.body.position, {
                x: Math.cos(angle) * 0.001 * spd,
                y: Math.sin(angle) * 0.001 * spd,
            });
        }

        const canAttack = now - agent.lastAttack > agent.attackCooldown * 0.7; // Faster during flurry
        if (dist < 150 && canAttack && agent.aiFlurryCount > 0) {
            agent.aiFlurryCount--;
            if (agent.specialReady && agent.aiFlurryCount <= 1) {
                this._specialAttack(id, angle);
            } else {
                this._attack(id, angle);
            }

            if (agent.aiFlurryCount <= 0) {
                agent.aiPhase = AI_PHASE.REPOSITION;
                agent.aiPhaseTimer = this.gameTime + 1500 + Math.random() * 1000;
            }
        }
    }

    _aiReposition(id, agent, angle, dist, spd, now) {
        // Back away and circle
        const retreatAngle = angle + Math.PI + (Math.random() - 0.5) * 1.0;
        const force = dist < 100 ? 0.0008 : 0.0004;
        Body.applyForce(agent.body, agent.body.position, {
            x: Math.cos(retreatAngle) * force * spd,
            y: Math.sin(retreatAngle) * force * spd,
        });

        // Occasional dodge during reposition
        if (dist < 80 && Math.random() < 0.03 && !agent.isDodging) {
            this._dodge(id);
        }
    }

    _aiDash(id, agent, oPos, angle, dist, spd, now) {
        // Lunge towards opponent with heavy force
        const dashForce = 0.0025 * spd;
        Body.applyForce(agent.body, agent.body.position, {
            x: Math.cos(angle) * dashForce,
            y: Math.sin(angle) * dashForce,
        });

        // Dash particles
        if (Math.random() < 0.3) {
            this.particles.push({
                x: agent.body.position.x - Math.cos(angle) * 15,
                y: agent.body.position.y - Math.sin(angle) * 15,
                vx: -Math.cos(angle) * 2, vy: -Math.sin(angle) * 2,
                life: 0.4, color: agent.color,
                size: 8 + Math.random() * 6, type: 'afterimage',
            });
        }

        // Attack on arrival
        const canAttack = now - agent.lastAttack > agent.attackCooldown * 0.5;
        if (dist < 120 && canAttack) {
            this._heavyAttack(id, angle);
            agent.aiPhase = AI_PHASE.ENGAGE;
            agent.aiPhaseTimer = this.gameTime + 2000 + Math.random() * 2000;
        }
    }

    // ═══════════════════════════════════════════════════════════
    // ATTACKS
    // ═══════════════════════════════════════════════════════════

    _attack(id, angle) {
        const agent = this.agents[id];
        const weapon = this.weapons[id];
        if (!agent || !weapon) return;

        agent.lastAttack = this.gameTime;
        agent.isAttacking = true;

        const force = 0.035;
        Body.applyForce(weapon.body, weapon.body.position, {
            x: Math.cos(angle) * force,
            y: Math.sin(angle) * force,
        });
        Body.setAngularVelocity(weapon.body, (Math.random() > 0.5 ? 1 : -1) * 0.45);

        // Also push agent slightly forward into the swing
        Body.applyForce(agent.body, agent.body.position, {
            x: Math.cos(angle) * 0.0004,
            y: Math.sin(angle) * 0.0004,
        });

        setTimeout(() => { if (this.agents[id]) agent.isAttacking = false; }, 280);
    }

    _heavyAttack(id, angle) {
        const agent = this.agents[id];
        const weapon = this.weapons[id];
        if (!agent || !weapon) return;

        agent.lastAttack = this.gameTime;
        agent.isAttacking = true;

        const force = 0.055;
        Body.applyForce(weapon.body, weapon.body.position, {
            x: Math.cos(angle) * force,
            y: Math.sin(angle) * force,
        });
        Body.setAngularVelocity(weapon.body, (Math.random() > 0.5 ? 1 : -1) * 0.6);

        // Windup sparks
        for (let i = 0; i < 3; i++) {
            this.particles.push({
                x: agent.body.position.x + Math.cos(angle) * 18,
                y: agent.body.position.y + Math.sin(angle) * 18,
                vx: Math.cos(angle + (Math.random() - 0.5)) * 3,
                vy: Math.sin(angle + (Math.random() - 0.5)) * 3,
                life: 0.7, color: '#FFE93E',
                size: 1.5 + Math.random() * 2, type: 'spark',
            });
        }

        setTimeout(() => { if (this.agents[id]) agent.isAttacking = false; }, 400);
    }

    _specialAttack(id, angle) {
        const agent = this.agents[id];
        const weapon = this.weapons[id];
        if (!agent || !weapon || !agent.specialReady) return;

        agent.specialMeter = 0;
        agent.specialReady = false;
        agent.lastAttack = this.gameTime;
        agent.isAttacking = true;

        const force = 0.07;
        Body.applyForce(weapon.body, weapon.body.position, {
            x: Math.cos(angle) * force,
            y: Math.sin(angle) * force,
        });
        Body.setAngularVelocity(weapon.body, (Math.random() > 0.5 ? 1 : -1) * 0.9);

        // Big burst
        for (let i = 0; i < 16; i++) {
            const a = (Math.PI * 2 / 16) * i;
            this.particles.push({
                x: agent.body.position.x,
                y: agent.body.position.y,
                vx: Math.cos(a) * (4 + Math.random() * 5),
                vy: Math.sin(a) * (4 + Math.random() * 5),
                life: 1.0, color: agent.color,
                size: 3 + Math.random() * 4, type: 'special',
            });
        }

        this.shakeIntensity = Math.max(this.shakeIntensity, 5);
        this.comboEffects.push({
            x: agent.body.position.x, y: agent.body.position.y - 55,
            text: '⚡ SPECIAL!', time: this.gameTime,
            color: '#FFE93E', size: 24,
        });

        setTimeout(() => { if (this.agents[id]) agent.isAttacking = false; }, 500);
    }

    _defend(id) {
        const agent = this.agents[id];
        if (!agent || agent.isDefending || agent.isAttacking) return;
        agent.isDefending = true;
        agent.defendUntil = this.gameTime + 900;
        setTimeout(() => { if (this.agents[id]) agent.isDefending = false; }, 900);
    }

    _dodge(id) {
        const agent = this.agents[id];
        if (!agent || agent.isDodging) return;
        agent.isDodging = true;
        agent.dodgeUntil = this.gameTime + 350;
        agent.dodges++;

        const otherId = Object.keys(this.agents).find(k => k !== id);
        if (otherId) {
            const oPos = this.agents[otherId].body.position;
            const angle = Math.atan2(oPos.y - agent.body.position.y, oPos.x - agent.body.position.x);
            const dodgeAngle = angle + (Math.PI / 2) * (Math.random() > 0.5 ? 1 : -1);
            Body.applyForce(agent.body, agent.body.position, {
                x: Math.cos(dodgeAngle) * 0.0035,
                y: Math.sin(dodgeAngle) * 0.0035,
            });
        }

        for (let i = 0; i < 3; i++) {
            this.particles.push({
                x: agent.body.position.x + (Math.random() - 0.5) * 12,
                y: agent.body.position.y + (Math.random() - 0.5) * 12,
                vx: 0, vy: 0, life: 0.4,
                color: agent.color, size: 10 + Math.random() * 6, type: 'afterimage',
            });
        }

        setTimeout(() => { if (this.agents[id]) agent.isDodging = false; }, 350);
    }

    // ═══════════════════════════════════════════════════════════
    // COLLISION & DAMAGE
    // ═══════════════════════════════════════════════════════════

    _checkCollisions() {
        const ids = Object.keys(this.agents);
        if (ids.length < 2) return;

        for (const id of ids) {
            const otherId = ids.find(k => k !== id);
            const weapon = this.weapons[id];
            const other = this.agents[otherId];
            const attacker = this.agents[id];

            if (!weapon || !other || other.invincible > this.gameTime) continue;

            const wPos = weapon.body.position;
            const oPos = other.body.position;
            const dist = Vector.magnitude(Vector.sub(wPos, oPos));
            const wSpeed = Vector.magnitude(weapon.body.velocity);

            // Lower threshold: weapon just needs to be near + moving
            if (dist < 42 && wSpeed > 0.8) {
                // Dodge
                if (other.isDodging || (other.dodgeChance > 0 && Math.random() * 100 < other.dodgeChance)) {
                    this.comboEffects.push({
                        x: oPos.x, y: oPos.y - 38,
                        text: 'DODGE!', time: this.gameTime,
                        color: '#00F5FF', size: 15,
                    });
                    other.dodges++;
                    continue;
                }

                // Block
                if (other.isDefending) {
                    const reducedDmg = Math.round(wSpeed * 0.3);
                    other.hp = Math.max(0, other.hp - reducedDmg);
                    other.invincible = this.gameTime + 200;
                    attacker.stunUntil = this.gameTime + 350;
                    this.comboEffects.push({
                        x: oPos.x, y: oPos.y - 38,
                        text: `🛡️ -${reducedDmg}`, time: this.gameTime,
                        color: '#836EF9', size: 13,
                    });
                    this.shakeIntensity = Math.max(this.shakeIntensity, 3);
                    if (other.reflect > 0) {
                        attacker.hp = Math.max(1, attacker.hp - Math.round(reducedDmg * other.reflect / 100));
                    }
                    continue;
                }

                // ── Damage calc (for visual effects; HP only changes locally when not server-driven) ──
                let dmg = 10 + wSpeed * 2.8 + Math.random() * 8;
                dmg += attacker.bonusDamage * 0.7;

                if (attacker.lowHPBonus > 0 && attacker.hp / attacker.maxHp < 0.3) {
                    dmg *= 1 + attacker.lowHPBonus / 100;
                }

                dmg *= 1 + (this.momentum[id] || 0) * 0.02;

                let isCrit = false;
                if (Math.random() * 100 < attacker.critChance) {
                    dmg *= attacker.critDamage / 100;
                    isCrit = true;
                }

                const effDef = Math.max(0, other.defense - attacker.armorPen);
                dmg *= 1 - Math.min(0.4, effDef / (effDef + 60));

                const damage = Math.round(Math.max(2, dmg));

                // Only mutate game state locally when NOT server-driven
                if (!this.serverDriven) {
                    other.hp = Math.max(1, other.hp - damage);
                    attacker.score += damage;
                    attacker.hitsLanded++;
                    other.hitsTaken++;
                    if (isCrit) attacker.critHits++;

                    this.momentum[id] = Math.min(8, (this.momentum[id] || 0) + 1);
                    this.momentum[otherId] = Math.max(0, (this.momentum[otherId] || 0) - 0.5);

                    if (this.gameTime - attacker.lastHitTime < attacker.comboWindowMs) {
                        attacker.combo++;
                        if (attacker.combo > attacker.maxCombo) attacker.maxCombo = attacker.combo;
                    } else {
                        attacker.combo = 1;
                    }
                    attacker.lastHitTime = this.gameTime;

                    attacker.specialMeter = Math.min(100, attacker.specialMeter + 10 + (isCrit ? 15 : 0) + (attacker.combo >= 3 ? 8 : 0));
                    if (attacker.specialMeter >= 100 && !attacker.specialReady) {
                        attacker.specialReady = true;
                        this.comboEffects.push({
                            x: attacker.body.position.x, y: attacker.body.position.y - 60,
                            text: '⚡ SPECIAL READY!', time: this.gameTime,
                            color: '#FFE93E', size: 18,
                        });
                    }

                    if (attacker.lifesteal > 0) {
                        attacker.hp = Math.min(attacker.maxHp, attacker.hp + Math.round(damage * attacker.lifesteal / 100));
                    }
                    if (other.thornDamage > 0) attacker.hp = Math.max(1, attacker.hp - other.thornDamage);
                    if (attacker.burnDamage > 0) other.burnUntil = this.gameTime + 2500;
                    if (attacker.slowEffect > 0) other.slowUntil = this.gameTime + 1500;
                }

                other.invincible = this.gameTime + 350;

                // ── Visual effects ──
                this.hitEffects.push({
                    x: oPos.x, y: oPos.y, damage,
                    time: this.gameTime, color: attacker.color,
                    isCrit, isCombo: attacker.combo >= 3,
                });

                if (attacker.combo >= 2) {
                    const texts = ['', '', 'DOUBLE!', 'TRIPLE!', 'ULTRA!', 'MEGA!', 'INSANE!', 'GODLIKE!'];
                    this.comboEffects.push({
                        x: oPos.x, y: oPos.y - 65,
                        text: `${attacker.combo}x ${texts[Math.min(attacker.combo, texts.length - 1)]}`,
                        time: this.gameTime,
                        color: attacker.combo >= 5 ? '#FFE93E' : attacker.combo >= 3 ? '#FF6B35' : '#00F5FF',
                        size: 14 + Math.min(attacker.combo * 2, 10),
                    });
                }

                if (isCrit) {
                    this.comboEffects.push({
                        x: oPos.x + (Math.random() - 0.5) * 18,
                        y: oPos.y - 50,
                        text: '💥 CRITICAL!', time: this.gameTime,
                        color: '#FF2D78', size: 20,
                    });
                    this.shakeIntensity = Math.max(this.shakeIntensity, 4);
                }

                // Particles
                const pCount = Math.min(isCrit ? 10 : (attacker.combo >= 3 ? 7 : 4), 10);
                for (let i = 0; i < pCount; i++) {
                    const pa = (Math.PI * 2 / pCount) * i + Math.random() * 0.4;
                    this.particles.push({
                        x: oPos.x, y: oPos.y,
                        vx: Math.cos(pa) * (3 + Math.random() * (isCrit ? 6 : 3)),
                        vy: Math.sin(pa) * (3 + Math.random() * (isCrit ? 6 : 3)),
                        life: 0.8, color: isCrit ? '#FFE93E' : attacker.color,
                        size: isCrit ? (2 + Math.random() * 3) : (1 + Math.random() * 2.5),
                        type: 'impact',
                    });
                }

                // Knockback (minimal shake)
                this.shakeIntensity = Math.max(this.shakeIntensity, Math.min(damage * 0.08, 3));
                const kAngle = Math.atan2(oPos.y - wPos.y, oPos.x - wPos.x);
                Body.applyForce(other.body, oPos, {
                    x: Math.cos(kAngle) * (isCrit ? 0.005 : 0.003),
                    y: Math.sin(kAngle) * (isCrit ? 0.005 : 0.003),
                });

                if (this.onHit) {
                    this.onHit(id, otherId, damage, other.hp, { isCrit, combo: attacker.combo });
                }
            }
        }
    }

    // ═══════════════════════════════════════════════════════════
    // UPDATE LOOP
    // ═══════════════════════════════════════════════════════════

    update(delta = 16.67) {
        if (!this.isRunning || this.isFinished || this.isPaused) return;
        this.gameTime += delta;

        if (this.roundPauseUntil > this.gameTime) return;

        // Round timer: only managed locally when NOT server-driven
        if (!this.serverDriven) {
            this.roundTimer -= delta / 1000;
            if (this.roundTimer <= 0) { this._endRound(); return; }
        }

        Engine.update(this.engine, delta);
        Object.keys(this.agents).forEach(id => this._aiTick(id));
        this._checkCollisions();
        // KO disabled locally — server controls match end

        // Burn DOT visual particles (HP change only when not server-driven)
        Object.keys(this.agents).forEach(id => {
            const a = this.agents[id];
            if (a.burnUntil > this.gameTime && Math.random() < 0.04) {
                if (!this.serverDriven) {
                    a.hp = Math.max(1, a.hp - 2);
                }
                this.particles.push({
                    x: a.body.position.x + (Math.random() - 0.5) * 12,
                    y: a.body.position.y - 8,
                    vx: (Math.random() - 0.5) * 1.5,
                    vy: -2 - Math.random(),
                    life: 0.5, color: '#FF6B35',
                    size: 2 + Math.random() * 2, type: 'fire',
                });
            }
        });

        // Particles
        this.particles = this.particles.filter(p => {
            p.x += p.vx; p.y += p.vy;
            p.vx *= 0.95; p.vy *= 0.95;
            p.life -= 0.028;
            return p.life > 0;
        });
        if (this.particles.length > 70) this.particles = this.particles.slice(-70);

        this.hitEffects = this.hitEffects.filter(h => this.gameTime - h.time < 1000);
        this.comboEffects = this.comboEffects.filter(c => this.gameTime - c.time < 1200);
        this.shakeIntensity *= 0.84;
        if (this.shakeIntensity < 0.3) this.shakeIntensity = 0;
        this.momentum['1'] = Math.max(0, (this.momentum['1'] || 0) - 0.002);
        this.momentum['2'] = Math.max(0, (this.momentum['2'] || 0) - 0.002);
    }

    _checkKO() {
        const ids = Object.keys(this.agents);
        for (const id of ids) {
            if (this.agents[id].hp <= 0) {
                const winnerId = ids.find(k => k !== id);
                const pos = this.agents[id].body.position;
                // KO particle burst (no screen shake)
                for (let i = 0; i < 16; i++) {
                    const a = (Math.PI * 2 / 16) * i;
                    this.particles.push({
                        x: pos.x, y: pos.y,
                        vx: Math.cos(a) * (4 + Math.random() * 5),
                        vy: Math.sin(a) * (4 + Math.random() * 5),
                        life: 1.0, color: this.agents[id].color,
                        size: 3 + Math.random() * 3, type: 'ko',
                    });
                }
                // No shakeIntensity — removed per user request
                this._finishMatch(winnerId, 'ko');
                return;
            }
        }
    }

    _endRound() {
        if (this.currentRound >= this.maxRounds) {
            const ids = Object.keys(this.agents);
            const [a, b] = ids;
            const hpA = this.agents[a].hp, hpB = this.agents[b].hp;
            const winner = hpA !== hpB ? (hpA > hpB ? a : b) : (this.agents[a].score >= this.agents[b].score ? a : b);
            this._finishMatch(winner, 'decision');
            return;
        }

        this.currentRound++;
        this.roundTimer = this.roundTime;
        this.roundPauseUntil = this.gameTime + 3000;
        this.roundJustStarted = this.gameTime + 3000;

        Object.values(this.agents).forEach(a => {
            a.hp = Math.min(a.maxHp, a.hp + Math.round(a.maxHp * 0.20)); // 20% heal between rounds
            a.combo = 0;
            a.specialMeter = Math.min(100, a.specialMeter + 10);
            a.aiPhase = AI_PHASE.APPROACH;
            a.aiPhaseTimer = 0;
        });
        this.momentum = { '1': 0, '2': 0 };

        if (this.onRoundEnd) {
            this.onRoundEnd({ round: this.currentRound - 1, nextRound: this.currentRound, agents: this._agentStates() });
        }
    }

    _finishMatch(winnerId, reason) {
        this.isFinished = true;
        this.winner = winnerId;
        this.finishReason = reason;
        this.finishTime = this.gameTime;
        this.stop();
        if (this.onGameEnd) {
            this.onGameEnd({ winner: winnerId, reason, agents: this._agentStates(), round: this.currentRound, duration: Math.round(this.gameTime / 1000) });
        }
    }

    forceEnd() {
        if (this.isFinished) return;
        const ids = Object.keys(this.agents);
        const [a, b] = ids;
        this._finishMatch(this.agents[a].hp >= this.agents[b].hp ? a : b, 'timeout');
    }

    _agentStates() {
        const s = {};
        Object.keys(this.agents).forEach(id => {
            const a = this.agents[id];
            s[id] = { hp: a.hp, maxHp: a.maxHp, score: a.score, combo: a.combo, maxCombo: a.maxCombo, specialMeter: a.specialMeter, hitsLanded: a.hitsLanded, hitsTaken: a.hitsTaken, critHits: a.critHits, dodges: a.dodges };
        });
        return s;
    }

    getState() {
        const state = {};
        Object.keys(this.agents).forEach(id => {
            const a = this.agents[id];
            state[id] = {
                x: a.body.position.x, y: a.body.position.y, angle: a.body.angle,
                hp: a.hp, maxHp: a.maxHp, score: a.score,
                isAttacking: a.isAttacking, isDefending: a.isDefending,
                isDodging: a.isDodging,
                isBurning: a.burnUntil > this.gameTime,
                isSlowed: a.slowUntil > this.gameTime,
                isStunned: a.stunUntil > this.gameTime,
                specialMeter: a.specialMeter, specialReady: a.specialReady,
                combo: a.combo, maxCombo: a.maxCombo,
                hitsLanded: a.hitsLanded, critHits: a.critHits,
                weaponX: this.weapons[id]?.body.position.x,
                weaponY: this.weapons[id]?.body.position.y,
                weaponAngle: this.weapons[id]?.body.angle,
                color: a.color,
            };
        });
        return {
            agents: state, particles: this.particles,
            hitEffects: this.hitEffects, comboEffects: this.comboEffects,
            shakeIntensity: this.shakeIntensity, gameTime: this.gameTime,
            roundTimer: Math.max(0, Math.ceil(this.roundTimer)),
            currentRound: this.currentRound, maxRounds: this.maxRounds,
            isFinished: this.isFinished, winner: this.winner,
            finishReason: this.finishReason, finishTime: this.finishTime,
            roundPauseUntil: this.roundPauseUntil,
            roundJustStarted: this.roundJustStarted,
            momentum: this.momentum,
        };
    }

    // ═══════════════════════════════════════════════════════════
    // SERVER SYNC — Overwrite game-logic state from server ticks
    // Local engine keeps running for visuals (AI movement, physics,
    // particles) but HP, rounds, and match end come from server.
    // ═══════════════════════════════════════════════════════════

    syncServerState(serverTick) {
        if (!serverTick || !serverTick.fighters) return;
        this.serverDriven = true;

        const { fighters, round, roundTimer, roundPaused, finished, winner, method } = serverTick;

        // Sync round transitions
        if (round && round !== this._lastServerRound) {
            if (round > this._lastServerRound && roundPaused) {
                // Trigger visual round transition overlay
                this.roundPauseUntil = this.gameTime + 3000;
                this.roundJustStarted = this.gameTime + 3000;
            }
            this._lastServerRound = round;
            this.currentRound = round;

            // Reset HP positions toward center for new round visual
            const ids = Object.keys(this.agents);
            ids.forEach((id, idx) => {
                const a = this.agents[id];
                if (!a) return;
                a.combo = 0;
                a.aiPhase = 'approach';
                a.aiPhaseTimer = 0;
            });
            this.momentum = { '1': 0, '2': 0 };
        }
        this.currentRound = round || this.currentRound;

        // Sync round timer
        if (typeof roundTimer === 'number') {
            this.roundTimer = roundTimer;
        }

        // Sync round pause
        if (roundPaused && this.roundPauseUntil <= this.gameTime) {
            this.roundPauseUntil = this.gameTime + 3000;
        }

        // Sync fighter state
        for (const [id, fState] of Object.entries(fighters)) {
            const agent = this.agents[id];
            if (!agent) continue;

            // Overwrite HP from server (authoritative)
            agent.hp = fState.hp;
            agent.maxHp = fState.maxHp;

            // Sync combat stats
            agent.specialMeter = fState.specialMeter;
            agent.specialReady = fState.specialReady;
            agent.combo = fState.combo;
            agent.maxCombo = fState.maxCombo;
            agent.hitsLanded = fState.hitsLanded;
            agent.critHits = fState.critHits;
            agent.dodges = fState.dodges;

            // Status effects — set timeout-based flags from server booleans
            if (fState.isBurning && agent.burnUntil <= this.gameTime) {
                agent.burnUntil = this.gameTime + 2500;
            } else if (!fState.isBurning) {
                agent.burnUntil = 0;
            }

            if (fState.isStunned && agent.stunUntil <= this.gameTime) {
                agent.stunUntil = this.gameTime + 500;
            } else if (!fState.isStunned) {
                agent.stunUntil = 0;
            }

            if (fState.isSlowed && agent.slowUntil <= this.gameTime) {
                agent.slowUntil = this.gameTime + 1500;
            } else if (!fState.isSlowed) {
                agent.slowUntil = 0;
            }
        }

        // Sync match end
        if (finished && !this.isFinished) {
            this.isFinished = true;
            this.winner = winner;
            this.finishReason = (method || 'decision').toLowerCase();
            this.finishTime = this.gameTime;
            this.stop();
        }
    }

    start() { this.isRunning = true; }
    stop() { this.isRunning = false; }
    pause() { this.isPaused = true; }
    resume() { this.isPaused = false; }

    destroy() {
        this.stop();
        Engine.clear(this.engine);
        World.clear(this.world);
    }
}
