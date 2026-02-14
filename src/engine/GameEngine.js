// ═══════════════════════════════════════════════════════════════
// GAME ENGINE v3 — Fast-Paced Arena Combat
// Aggressive AI, combos, crits, comeback mechanics, specials
// Synced to 45s backend FIGHT_DURATION (3 rounds × ~13s + pauses)
// ═══════════════════════════════════════════════════════════════

import Matter from 'matter-js';

const { Engine, World, Bodies, Body, Composite, Vector } = Matter;

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

        // Match timing — synced to backend FIGHT_DURATION (45s)
        this.roundTime = 13;
        this.currentRound = 1;
        this.maxRounds = 3;
        this.roundTimer = this.roundTime;
        this.roundPauseUntil = 0;
        this.roundJustStarted = 0;    // timestamp when current round started (for "ROUND X" overlay)

        // Momentum: tracks who is dominating
        this.momentum = { '1': 0, '2': 0 };

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
            frictionAir: 0.04,
            restitution: 0.7,
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
            stiffness: 0.35,
            damping: 0.08,
            length: 5,
        });

        Composite.add(this.world, [body, weaponBody, constraint]);

        const eb = equipmentBonus || {};
        const baseHP = 160;  // Lower HP = faster fights
        const maxHp = baseHP + (eb.maxHP || 0);

        this.agents[id] = {
            body,
            color,
            hp: maxHp,
            maxHp,
            score: 0,
            lastAttack: 0,
            isAttacking: false,
            attackCooldown: Math.max(250, 420 - (eb.attackSpeed || 0) * 20), // Faster attacks
            weaponLength,
            invincible: 0,

            // Equipment stats
            bonusDamage: eb.damage || 0,
            defense: eb.defense || 0,
            speedBonus: eb.speed || 0,
            critChance: 8 + (eb.critChance || 0),      // Higher base crit
            critDamage: 160 + (eb.critDamage || 0),
            lifesteal: eb.lifesteal || 0,
            dodgeChance: eb.dodgeChance || 0,
            burnDamage: eb.burnDamage || 0,
            reflect: eb.reflect || 0,
            thornDamage: eb.thornDamage || 0,
            slowEffect: eb.slowEffect || 0,
            armorPen: eb.armorPen || 0,
            lowHPBonus: eb.lowHPBonus || 0,
            chainDamage: eb.chainDamage || 0,

            // Combat state
            combo: 0,
            maxCombo: 0,
            lastHitTime: 0,
            comboWindowMs: 2500,   // Wider combo window
            specialMeter: 0,
            specialReady: false,
            isDefending: false,
            defendUntil: 0,
            isDodging: false,
            dodgeUntil: 0,
            stunUntil: 0,
            burnUntil: 0,
            slowUntil: 0,
            hitsTaken: 0,
            hitsLanded: 0,
            critHits: 0,
            dodges: 0,

            // Personality (randomized per agent for variety)
            personality: {
                baseAggression: 0.55 + Math.random() * 0.3,
                preferMelee: Math.random() > 0.5,
                defensive: Math.random() < 0.25,
            },
        };

        this.weapons[id] = { body: weaponBody, constraint };
        return this.agents[id];
    }

    _aiTick(id) {
        const agent = this.agents[id];
        const otherId = Object.keys(this.agents).find(k => k !== id);
        if (!agent || !otherId) return;
        if (agent.stunUntil > this.gameTime) return;

        const other = this.agents[otherId];
        const pos = agent.body.position;
        const otherPos = other.body.position;
        const dx = otherPos.x - pos.x;
        const dy = otherPos.y - pos.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const angle = Math.atan2(dy, dx);
        const now = this.gameTime;

        // ── Dynamic aggression ──
        const hpPct = agent.hp / agent.maxHp;
        const otherHpPct = other.hp / other.maxHp;
        let aggression = agent.personality.baseAggression;

        // Winning → push harder
        if (hpPct > otherHpPct + 0.15) aggression += 0.15;
        // Losing → get desperate
        if (hpPct < otherHpPct - 0.15) aggression += 0.1;
        // LOW HP BERSERKER MODE: Fight harder when close to death
        if (hpPct < 0.25) aggression += 0.35;
        // Smell blood: opponent is weak
        if (otherHpPct < 0.2) aggression += 0.25;
        // Special ready → more aggressive
        if (agent.specialReady) aggression += 0.15;
        // Momentum bonus
        aggression += (this.momentum[id] || 0) * 0.05;
        // Clamp
        aggression = Math.min(1.0, Math.max(0.3, aggression));

        // Speed
        const speedMult = 1 + (agent.speedBonus || 0) * 0.01;
        const slowMult = agent.slowUntil > this.gameTime ? 0.5 : 1;
        const totalSpeedMult = speedMult * slowMult;

        // ── Movement: Aggressive approach with flanking ──
        const randomOffset = (Math.random() - 0.5) * 0.8;
        const speed = (3.0 + Math.random() * 2.5) * totalSpeedMult;

        if (dist > 150) {
            // Sprint towards opponent
            const approachAngle = angle + randomOffset * 0.3;
            Body.applyForce(agent.body, pos, {
                x: Math.cos(approachAngle) * 0.001 * speed,
                y: Math.sin(approachAngle) * 0.001 * speed,
            });
        } else if (dist > 80) {
            // Medium range: approach with flanking
            const flankDir = Math.sin(now / 800 + (id === '1' ? 0 : Math.PI)) * 0.8;
            const moveAngle = angle + flankDir;
            Body.applyForce(agent.body, pos, {
                x: Math.cos(moveAngle) * 0.0008 * speed,
                y: Math.sin(moveAngle) * 0.0008 * speed,
            });
        } else if (dist < 50) {
            // Very close: sometimes retreat, sometimes go all in
            if (Math.random() > aggression * 0.8) {
                Body.applyForce(agent.body, pos, {
                    x: -Math.cos(angle) * 0.001 * totalSpeedMult,
                    y: -Math.sin(angle) * 0.001 * totalSpeedMult,
                });
                if (Math.random() < 0.15 && !agent.isDodging) {
                    this._dodge(id);
                }
            }
        }

        // ── Defend decision (less frequent, more tactical) ──
        if (dist < 90 && Math.random() < (1 - aggression) * 0.04 && !agent.isDefending && !agent.isAttacking) {
            this._defend(id);
        }

        // ── Attack logic: More frequent, more variety ──
        const canAttack = now - agent.lastAttack > agent.attackCooldown;
        if (dist < 160 && canAttack) {
            const roll = Math.random();

            if (agent.specialReady && roll < 0.2) {
                // SPECIAL MOVE (20% chance when ready)
                this._specialAttack(id, angle);
            } else if (roll < aggression * 0.35) {
                // Normal attack (very frequent)
                this._attack(id, angle);
            } else if (roll < aggression * 0.08 + 0.05) {
                // Heavy attack (occasional)
                this._heavyAttack(id, angle);
            }
        }

        // ── Finishing blow: when opponent is very low, relentless attack ──
        if (otherHpPct < 0.15 && dist < 140 && canAttack) {
            this._heavyAttack(id, angle);
        }

        // ── Circle strafe (dynamic movement) ──
        if (Math.random() < 0.06 * totalSpeedMult) {
            const strafeAngle = angle + Math.PI / 2 * (Math.random() > 0.5 ? 1 : -1);
            Body.applyForce(agent.body, pos, {
                x: Math.cos(strafeAngle) * 0.0007 * totalSpeedMult,
                y: Math.sin(strafeAngle) * 0.0007 * totalSpeedMult,
            });
        }

        // ── Keep in bounds ──
        const padding = 50;
        if (pos.x < padding) Body.applyForce(agent.body, pos, { x: 0.0015, y: 0 });
        if (pos.x > this.width - padding) Body.applyForce(agent.body, pos, { x: -0.0015, y: 0 });
        if (pos.y < padding) Body.applyForce(agent.body, pos, { x: 0, y: 0.0015 });
        if (pos.y > this.height - padding) Body.applyForce(agent.body, pos, { x: 0, y: -0.0015 });
    }

    _attack(id, angle) {
        const agent = this.agents[id];
        const weapon = this.weapons[id];
        if (!agent || !weapon) return;

        agent.lastAttack = this.gameTime;
        agent.isAttacking = true;

        const force = 0.018;
        Body.applyForce(weapon.body, weapon.body.position, {
            x: Math.cos(angle) * force,
            y: Math.sin(angle) * force,
        });
        Body.setAngularVelocity(weapon.body, (Math.random() > 0.5 ? 1 : -1) * 0.35);

        setTimeout(() => { if (this.agents[id]) agent.isAttacking = false; }, 250);
    }

    _heavyAttack(id, angle) {
        const agent = this.agents[id];
        const weapon = this.weapons[id];
        if (!agent || !weapon) return;

        agent.lastAttack = this.gameTime;
        agent.isAttacking = true;

        const force = 0.03;
        Body.applyForce(weapon.body, weapon.body.position, {
            x: Math.cos(angle) * force,
            y: Math.sin(angle) * force,
        });
        Body.setAngularVelocity(weapon.body, (Math.random() > 0.5 ? 1 : -1) * 0.55);

        // Windup sparks
        for (let i = 0; i < 3; i++) {
            this.particles.push({
                x: agent.body.position.x + Math.cos(angle) * 20,
                y: agent.body.position.y + Math.sin(angle) * 20,
                vx: Math.cos(angle) * (2 + Math.random() * 3),
                vy: Math.sin(angle) * (2 + Math.random() * 3),
                life: 0.8,
                color: '#FFE93E',
                size: 1.5 + Math.random() * 2.5,
                type: 'spark',
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

        const force = 0.045;
        Body.applyForce(weapon.body, weapon.body.position, {
            x: Math.cos(angle) * force,
            y: Math.sin(angle) * force,
        });
        Body.setAngularVelocity(weapon.body, (Math.random() > 0.5 ? 1 : -1) * 0.9);

        // Dramatic particle burst
        for (let i = 0; i < 20; i++) {
            const a = (Math.PI * 2 / 20) * i;
            this.particles.push({
                x: agent.body.position.x,
                y: agent.body.position.y,
                vx: Math.cos(a) * (4 + Math.random() * 6),
                vy: Math.sin(a) * (4 + Math.random() * 6),
                life: 1.2,
                color: agent.color,
                size: 3 + Math.random() * 5,
                type: 'special',
            });
        }

        this.shakeIntensity = 15;

        this.comboEffects.push({
            x: agent.body.position.x,
            y: agent.body.position.y - 55,
            text: '⚡ SPECIAL!',
            time: this.gameTime,
            color: '#FFE93E',
            size: 26,
        });

        setTimeout(() => { if (this.agents[id]) agent.isAttacking = false; }, 500);
    }

    _defend(id) {
        const agent = this.agents[id];
        agent.isDefending = true;
        agent.defendUntil = this.gameTime + 800;
        setTimeout(() => { if (this.agents[id]) agent.isDefending = false; }, 800);
    }

    _dodge(id) {
        const agent = this.agents[id];
        agent.isDodging = true;
        agent.dodgeUntil = this.gameTime + 350;
        agent.dodges++;

        const otherId = Object.keys(this.agents).find(k => k !== id);
        if (otherId) {
            const otherPos = this.agents[otherId].body.position;
            const angle = Math.atan2(otherPos.y - agent.body.position.y, otherPos.x - agent.body.position.x);
            const dodgeAngle = angle + (Math.PI / 2) * (Math.random() > 0.5 ? 1 : -1);
            Body.applyForce(agent.body, agent.body.position, {
                x: Math.cos(dodgeAngle) * 0.004,
                y: Math.sin(dodgeAngle) * 0.004,
            });
        }

        // Quick afterimage
        for (let i = 0; i < 3; i++) {
            this.particles.push({
                x: agent.body.position.x + (Math.random() - 0.5) * 15,
                y: agent.body.position.y + (Math.random() - 0.5) * 15,
                vx: 0, vy: 0,
                life: 0.5,
                color: agent.color,
                size: 12 + Math.random() * 8,
                type: 'afterimage',
            });
        }

        setTimeout(() => { if (this.agents[id]) agent.isDodging = false; }, 350);
    }

    _checkCollisions() {
        const ids = Object.keys(this.agents);
        if (ids.length < 2) return;

        for (const id of ids) {
            const otherId = ids.find(k => k !== id);
            const weapon = this.weapons[id];
            const other = this.agents[otherId];
            const attacker = this.agents[id];

            if (!weapon || !other || other.invincible > this.gameTime) continue;

            const weaponPos = weapon.body.position;
            const otherPos = other.body.position;
            const dist = Vector.magnitude(Vector.sub(weaponPos, otherPos));
            const weaponSpeed = Vector.magnitude(weapon.body.velocity);

            if (dist < 38 && weaponSpeed > 2.5) {
                // Dodge check
                if (other.isDodging || (other.dodgeChance > 0 && Math.random() * 100 < other.dodgeChance)) {
                    this.comboEffects.push({
                        x: otherPos.x, y: otherPos.y - 40,
                        text: 'DODGE!', time: this.gameTime,
                        color: '#00F5FF', size: 16,
                    });
                    other.dodges++;
                    continue;
                }

                // Defend check
                if (other.isDefending) {
                    const reducedDamage = Math.round(weaponSpeed * 0.4);
                    other.hp = Math.max(0, other.hp - reducedDamage);
                    other.invincible = this.gameTime + 250;

                    this.comboEffects.push({
                        x: otherPos.x, y: otherPos.y - 40,
                        text: `🛡️ -${reducedDamage}`, time: this.gameTime,
                        color: '#836EF9', size: 14,
                    });

                    attacker.stunUntil = this.gameTime + 300;

                    if (other.reflect > 0) {
                        const reflectDmg = Math.round(reducedDamage * other.reflect / 100);
                        attacker.hp = Math.max(0, attacker.hp - reflectDmg);
                    }
                    // Small screen shake for blocks
                    this.shakeIntensity = Math.max(this.shakeIntensity, 3);
                    continue;
                }

                // ── Calculate damage ──
                let baseDamage = 10 + weaponSpeed * 3.0 + Math.random() * 8;

                baseDamage += attacker.bonusDamage;

                // Low HP berserker bonus
                if (attacker.lowHPBonus > 0 && attacker.hp / attacker.maxHp < 0.3) {
                    baseDamage *= (1 + attacker.lowHPBonus / 100);
                }

                // Momentum bonus: consecutive hits deal more
                baseDamage *= (1 + (this.momentum[id] || 0) * 0.02);

                // Critical hit
                let isCrit = false;
                if (Math.random() * 100 < attacker.critChance) {
                    baseDamage *= (attacker.critDamage / 100);
                    isCrit = true;
                    attacker.critHits++;
                }

                // Defense
                const effectiveDefense = Math.max(0, other.defense - attacker.armorPen);
                baseDamage *= (1 - effectiveDefense / (effectiveDefense + 50));

                const damage = Math.round(Math.max(2, baseDamage));
                other.hp = Math.max(0, other.hp - damage);
                other.invincible = this.gameTime + 400;
                attacker.score += damage;
                attacker.hitsLanded++;
                other.hitsTaken++;

                // ── Momentum shift ──
                this.momentum[id] = Math.min(8, (this.momentum[id] || 0) + 1);
                this.momentum[otherId] = Math.max(0, (this.momentum[otherId] || 0) - 0.5);

                // ── Combo tracking ──
                if (this.gameTime - attacker.lastHitTime < attacker.comboWindowMs) {
                    attacker.combo++;
                    if (attacker.combo > attacker.maxCombo) attacker.maxCombo = attacker.combo;
                } else {
                    attacker.combo = 1;
                }
                attacker.lastHitTime = this.gameTime;

                // Build special meter (faster)
                attacker.specialMeter = Math.min(100, attacker.specialMeter + 15 + (isCrit ? 20 : 0) + (attacker.combo >= 3 ? 12 : 0));
                if (attacker.specialMeter >= 100 && !attacker.specialReady) {
                    attacker.specialReady = true;
                    this.comboEffects.push({
                        x: attacker.body.position.x,
                        y: attacker.body.position.y - 65,
                        text: '⚡ SPECIAL READY!',
                        time: this.gameTime,
                        color: '#FFE93E', size: 20,
                    });
                }

                // ── Lifesteal ──
                if (attacker.lifesteal > 0) {
                    const healAmount = Math.round(damage * attacker.lifesteal / 100);
                    attacker.hp = Math.min(attacker.maxHp, attacker.hp + healAmount);
                    this.particles.push({
                        x: attacker.body.position.x, y: attacker.body.position.y - 10,
                        vx: 0, vy: -2,
                        life: 0.8, color: '#39FF14', size: 3, type: 'heal',
                    });
                }

                // Thorn damage
                if (other.thornDamage > 0) {
                    attacker.hp = Math.max(0, attacker.hp - other.thornDamage);
                }

                // Burn effect
                if (attacker.burnDamage > 0) {
                    other.burnUntil = this.gameTime + 2500;
                    for (let i = 0; i < 3; i++) {
                        this.particles.push({
                            x: otherPos.x + (Math.random() - 0.5) * 15,
                            y: otherPos.y + (Math.random() - 0.5) * 15,
                            vx: (Math.random() - 0.5) * 2,
                            vy: -1.5 - Math.random() * 2,
                            life: 0.8, color: '#FF6B35',
                            size: 2 + Math.random() * 3, type: 'fire',
                        });
                    }
                }

                // Slow effect
                if (attacker.slowEffect > 0) {
                    other.slowUntil = this.gameTime + 1500;
                }

                // ── Hit visual effects ──
                this.hitEffects.push({
                    x: otherPos.x, y: otherPos.y,
                    damage, time: this.gameTime,
                    color: attacker.color,
                    isCrit, isCombo: attacker.combo >= 3,
                });

                // Combo text
                if (attacker.combo >= 2) {
                    const comboTexts = ['', '', 'DOUBLE!', 'TRIPLE!', 'ULTRA!', 'MEGA!', 'INSANE!', 'GODLIKE!'];
                    const comboText = comboTexts[Math.min(attacker.combo, comboTexts.length - 1)];
                    this.comboEffects.push({
                        x: otherPos.x, y: otherPos.y - 70,
                        text: `${attacker.combo}x ${comboText}`,
                        time: this.gameTime,
                        color: attacker.combo >= 5 ? '#FFE93E' : attacker.combo >= 3 ? '#FF6B35' : '#00F5FF',
                        size: 14 + Math.min(attacker.combo * 2, 12),
                    });
                }

                // Critical hit text
                if (isCrit) {
                    this.comboEffects.push({
                        x: otherPos.x + (Math.random() - 0.5) * 20,
                        y: otherPos.y - 55,
                        text: '💥 CRITICAL!', time: this.gameTime,
                        color: '#FF2D78', size: 22,
                    });
                    this.shakeIntensity = Math.max(this.shakeIntensity, 10);
                }

                // Impact particles — proportional to damage
                const particleCount = Math.min(isCrit ? 12 : (attacker.combo >= 3 ? 8 : 5), 12);
                for (let i = 0; i < particleCount; i++) {
                    const pAngle = (Math.PI * 2 / particleCount) * i + Math.random() * 0.4;
                    this.particles.push({
                        x: otherPos.x, y: otherPos.y,
                        vx: Math.cos(pAngle) * (3 + Math.random() * (isCrit ? 7 : 4)),
                        vy: Math.sin(pAngle) * (3 + Math.random() * (isCrit ? 7 : 4)),
                        life: 0.9,
                        color: isCrit ? '#FFE93E' : attacker.color,
                        size: isCrit ? (2 + Math.random() * 4) : (1.5 + Math.random() * 3),
                        type: 'impact',
                    });
                }

                // Screen shake
                this.shakeIntensity = Math.max(this.shakeIntensity, Math.min(damage * 0.35, 18));

                // Knockback
                const knockAngle = Math.atan2(otherPos.y - weaponPos.y, otherPos.x - weaponPos.x);
                const knockForce = isCrit ? 0.006 : 0.003;
                Body.applyForce(other.body, otherPos, {
                    x: Math.cos(knockAngle) * knockForce,
                    y: Math.sin(knockAngle) * knockForce,
                });

                if (this.onHit) {
                    this.onHit(id, otherId, damage, other.hp, { isCrit, combo: attacker.combo });
                }
            }
        }
    }

    update(delta = 16.67) {
        if (!this.isRunning || this.isFinished || this.isPaused) return;

        this.gameTime += delta;

        // Round pause
        if (this.roundPauseUntil > this.gameTime) return;

        this.roundTimer -= delta / 1000;

        if (this.roundTimer <= 0) {
            this._endRound();
            return;
        }

        Engine.update(this.engine, delta);

        // AI
        Object.keys(this.agents).forEach(id => this._aiTick(id));

        // Collisions
        this._checkCollisions();

        // KO check
        this._checkKO();

        // Burn DOT
        Object.keys(this.agents).forEach(id => {
            const a = this.agents[id];
            if (a.burnUntil > this.gameTime && Math.random() < 0.06) {
                a.hp = Math.max(0, a.hp - 2);
                this.particles.push({
                    x: a.body.position.x + (Math.random() - 0.5) * 15,
                    y: a.body.position.y - 10,
                    vx: (Math.random() - 0.5) * 1.5,
                    vy: -2 - Math.random() * 1.5,
                    life: 0.6, color: '#FF6B35',
                    size: 2 + Math.random() * 2, type: 'fire',
                });
            }
        });

        // ── Particle management (cap for performance) ──
        this.particles = this.particles.filter(p => {
            p.x += p.vx;
            p.y += p.vy;
            p.vx *= 0.95;
            p.vy *= 0.95;
            p.life -= 0.03;
            return p.life > 0;
        });
        // Hard cap
        if (this.particles.length > 60) {
            this.particles = this.particles.slice(-60);
        }

        // Clean effects
        this.hitEffects = this.hitEffects.filter(h => this.gameTime - h.time < 1000);
        this.comboEffects = this.comboEffects.filter(c => this.gameTime - c.time < 1200);

        // Decay shake
        this.shakeIntensity *= 0.82;
        if (this.shakeIntensity < 0.3) this.shakeIntensity = 0;

        // Decay momentum
        this.momentum['1'] = Math.max(0, (this.momentum['1'] || 0) - 0.003);
        this.momentum['2'] = Math.max(0, (this.momentum['2'] || 0) - 0.003);
    }

    _checkKO() {
        const ids = Object.keys(this.agents);
        for (const id of ids) {
            if (this.agents[id].hp <= 0) {
                const winnerId = ids.find(k => k !== id);
                const pos = this.agents[id].body.position;

                // KO explosion
                for (let i = 0; i < 24; i++) {
                    const angle = (Math.PI * 2 / 24) * i;
                    this.particles.push({
                        x: pos.x, y: pos.y,
                        vx: Math.cos(angle) * (5 + Math.random() * 8),
                        vy: Math.sin(angle) * (5 + Math.random() * 8),
                        life: 1.2,
                        color: this.agents[id].color,
                        size: 3 + Math.random() * 5,
                        type: 'ko',
                    });
                }
                this.shakeIntensity = 25;
                this._finishMatch(winnerId, 'ko');
                return;
            }
        }
    }

    _endRound() {
        if (this.currentRound >= this.maxRounds) {
            const ids = Object.keys(this.agents);
            const [id1, id2] = ids;
            const hp1 = this.agents[id1].hp;
            const hp2 = this.agents[id2].hp;
            const winnerId = hp1 !== hp2
                ? (hp1 > hp2 ? id1 : id2)
                : (this.agents[id1].score >= this.agents[id2].score ? id1 : id2);
            this._finishMatch(winnerId, 'decision');
            return;
        }

        // Next round
        this.currentRound++;
        this.roundTimer = this.roundTime;
        this.roundPauseUntil = this.gameTime + 2000;
        this.roundJustStarted = this.gameTime + 2000; // mark for overlay

        // Partial HP restore + reset combos
        Object.values(this.agents).forEach(a => {
            a.hp = Math.min(a.maxHp, a.hp + 30);
            a.combo = 0;
            a.specialMeter = Math.min(100, a.specialMeter + 15); // Free special charge
        });

        // Reset momentum
        this.momentum = { '1': 0, '2': 0 };

        if (this.onRoundEnd) {
            this.onRoundEnd({
                round: this.currentRound - 1,
                nextRound: this.currentRound,
                agents: this._agentStates(),
            });
        }
    }

    _finishMatch(winnerId, reason) {
        this.isFinished = true;
        this.winner = winnerId;
        this.finishReason = reason;
        this.finishTime = this.gameTime;
        this.stop();

        if (this.onGameEnd) {
            this.onGameEnd({
                winner: winnerId,
                reason,
                agents: this._agentStates(),
                round: this.currentRound,
                duration: Math.round(this.gameTime / 1000),
            });
        }
    }

    forceEnd() {
        if (this.isFinished) return;
        const ids = Object.keys(this.agents);
        const [id1, id2] = ids;
        const winnerId = this.agents[id1].hp >= this.agents[id2].hp ? id1 : id2;
        this._finishMatch(winnerId, 'timeout');
    }

    _agentStates() {
        const s = {};
        Object.keys(this.agents).forEach(id => {
            const a = this.agents[id];
            s[id] = {
                hp: a.hp, maxHp: a.maxHp, score: a.score,
                combo: a.combo, maxCombo: a.maxCombo,
                specialMeter: a.specialMeter,
                hitsLanded: a.hitsLanded, hitsTaken: a.hitsTaken,
                critHits: a.critHits, dodges: a.dodges,
            };
        });
        return s;
    }

    getState() {
        const state = {};
        Object.keys(this.agents).forEach(id => {
            const a = this.agents[id];
            state[id] = {
                x: a.body.position.x,
                y: a.body.position.y,
                angle: a.body.angle,
                hp: a.hp,
                maxHp: a.maxHp,
                score: a.score,
                isAttacking: a.isAttacking,
                isDefending: a.isDefending,
                isDodging: a.isDodging,
                isBurning: a.burnUntil > this.gameTime,
                isSlowed: a.slowUntil > this.gameTime,
                isStunned: a.stunUntil > this.gameTime,
                specialMeter: a.specialMeter,
                specialReady: a.specialReady,
                combo: a.combo,
                maxCombo: a.maxCombo,
                hitsLanded: a.hitsLanded,
                critHits: a.critHits,
                weaponX: this.weapons[id]?.body.position.x,
                weaponY: this.weapons[id]?.body.position.y,
                weaponAngle: this.weapons[id]?.body.angle,
                color: a.color,
            };
        });
        return {
            agents: state,
            particles: this.particles,
            hitEffects: this.hitEffects,
            comboEffects: this.comboEffects,
            shakeIntensity: this.shakeIntensity,
            gameTime: this.gameTime,
            roundTimer: Math.max(0, Math.ceil(this.roundTimer)),
            currentRound: this.currentRound,
            maxRounds: this.maxRounds,
            isFinished: this.isFinished,
            winner: this.winner,
            finishReason: this.finishReason,
            finishTime: this.finishTime,
            roundPauseUntil: this.roundPauseUntil,
            roundJustStarted: this.roundJustStarted,
            momentum: this.momentum,
        };
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
