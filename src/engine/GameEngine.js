// ═══════════════════════════════════════════════════════════════
// GAME ENGINE v2 — Enhanced Combat with Inventory Effects
// Combo system, critical hits, elemental effects, special moves
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
        this.elementEffects = [];
        this.shakeIntensity = 0;
        this.gameTime = 0;
        this.isRunning = false;
        this.isFinished = false;
        this.winner = null;
        this.finishReason = null;

        // Match timing
        this.roundTime = 60;         // 60 seconds per round (faster, more exciting)
        this.currentRound = 1;
        this.maxRounds = 3;
        this.roundTimer = this.roundTime;
        this.roundPauseUntil = 0;

        // Callbacks
        this.onHit = null;
        this.onUpdate = null;
        this.onGameEnd = null;
        this.onRoundEnd = null;
        this.onCombo = null;
        this.onCritical = null;
        this.onSpecialMove = null;

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
            frictionAir: 0.05,
            restitution: 0.6,
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
            stiffness: 0.3,
            damping: 0.1,
            length: 5,
        });

        Composite.add(this.world, [body, weaponBody, constraint]);

        // Apply equipment bonuses
        const eb = equipmentBonus || {};
        const baseHP = 200;
        const maxHp = baseHP + (eb.maxHP || 0);

        this.agents[id] = {
            body,
            color,
            hp: maxHp,
            maxHp,
            score: 0,
            lastAttack: 0,
            isAttacking: false,
            attackCooldown: Math.max(400, 800 - (eb.attackSpeed || 0) * 20),
            weaponLength,
            invincible: 0,

            // Equipment stats
            bonusDamage: eb.damage || 0,
            defense: eb.defense || 0,
            speedBonus: eb.speed || 0,
            critChance: eb.critChance || 5,      // base 5%
            critDamage: 150 + (eb.critDamage || 0), // base 150%
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
            comboWindowMs: 2000,
            specialMeter: 0,     // builds to 100
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
        };

        this.weapons[id] = {
            body: weaponBody,
            constraint,
        };

        return this.agents[id];
    }

    _aiTick(id) {
        const agent = this.agents[id];
        const otherId = Object.keys(this.agents).find(k => k !== id);
        if (!agent || !otherId) return;
        if (agent.stunUntil > this.gameTime) return; // Stunned, can't act

        const other = this.agents[otherId];
        const pos = agent.body.position;
        const otherPos = other.body.position;
        const dx = otherPos.x - pos.x;
        const dy = otherPos.y - pos.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const angle = Math.atan2(dy, dx);

        const now = this.gameTime;

        // Personality varies more per agent and changes during combat
        const hpPct = agent.hp / agent.maxHp;
        const otherHpPct = other.hp / other.maxHp;
        let aggression = id === '1' ? 0.7 : 0.5;

        // Get more aggressive when winning HP-wise
        if (hpPct > otherHpPct + 0.2) aggression += 0.15;
        // Get more defensive when losing
        if (hpPct < otherHpPct - 0.2) aggression -= 0.15;
        // Berserker mode at low HP
        if (hpPct < 0.3 && agent.lowHPBonus > 0) aggression += 0.3;
        // More aggressive with special ready
        if (agent.specialReady) aggression += 0.2;

        // Speed factor from equipment
        const speedMult = 1 + (agent.speedBonus || 0) * 0.01;
        // Apply slow effect
        const slowMult = agent.slowUntil > this.gameTime ? 0.5 : 1;
        const totalSpeedMult = speedMult * slowMult;

        const randomAngle = angle + (Math.random() - 0.5) * 1.0;
        const speed = (2.5 + Math.random() * 2.0) * totalSpeedMult;

        // Movement
        if (dist > 130) {
            // Approach with flanking
            const flankAngle = randomAngle + (Math.random() > 0.6 ? (Math.PI / 4) * (Math.random() > 0.5 ? 1 : -1) : 0);
            Body.applyForce(agent.body, pos, {
                x: Math.cos(flankAngle) * 0.0008 * speed,
                y: Math.sin(flankAngle) * 0.0008 * speed,
            });
        } else if (dist < 55) {
            // Close range — dodge or continue aggression
            if (Math.random() > aggression) {
                // Dodge backwards
                Body.applyForce(agent.body, pos, {
                    x: -Math.cos(angle) * 0.0012 * totalSpeedMult,
                    y: -Math.sin(angle) * 0.0012 * totalSpeedMult,
                });
                // Try dodge roll
                if (Math.random() < 0.1 && !agent.isDodging) {
                    this._dodge(id);
                }
            }
        }

        // Defend decision
        if (dist < 100 && Math.random() < (1 - aggression) * 0.06 && !agent.isDefending) {
            this._defend(id);
        }

        // Attack logic — more varied
        if (dist < 140 && now - agent.lastAttack > agent.attackCooldown) {
            const attackRoll = Math.random();
            if (attackRoll < aggression * 0.18) {
                // Normal attack
                this._attack(id, angle);
            } else if (attackRoll < aggression * 0.04 && agent.specialReady) {
                // Special move!
                this._specialAttack(id, angle);
            }
        }

        // Heavy attack at medium range
        if (dist > 80 && dist < 150 && Math.random() < 0.015 * aggression) {
            this._heavyAttack(id, angle);
        }

        // Random circle strafe (more frequent for fast agents)
        if (Math.random() < 0.04 * totalSpeedMult) {
            const strafeAngle = angle + Math.PI / 2 * (Math.random() > 0.5 ? 1 : -1);
            Body.applyForce(agent.body, pos, {
                x: Math.cos(strafeAngle) * 0.0006 * totalSpeedMult,
                y: Math.sin(strafeAngle) * 0.0006 * totalSpeedMult,
            });
        }

        // Quick juke movement
        if (Math.random() < 0.02) {
            Body.applyForce(agent.body, pos, {
                x: (Math.random() - 0.5) * 0.002 * totalSpeedMult,
                y: (Math.random() - 0.5) * 0.002 * totalSpeedMult,
            });
        }

        // Keep in bounds
        const padding = 60;
        if (pos.x < padding) Body.applyForce(agent.body, pos, { x: 0.001, y: 0 });
        if (pos.x > this.width - padding) Body.applyForce(agent.body, pos, { x: -0.001, y: 0 });
        if (pos.y < padding) Body.applyForce(agent.body, pos, { x: 0, y: 0.001 });
        if (pos.y > this.height - padding) Body.applyForce(agent.body, pos, { x: 0, y: -0.001 });
    }

    _attack(id, angle) {
        const agent = this.agents[id];
        const weapon = this.weapons[id];
        if (!agent || !weapon) return;

        agent.lastAttack = this.gameTime;
        agent.isAttacking = true;

        const force = 0.015;
        Body.applyForce(weapon.body, weapon.body.position, {
            x: Math.cos(angle) * force,
            y: Math.sin(angle) * force,
        });
        Body.setAngularVelocity(weapon.body, (Math.random() > 0.5 ? 1 : -1) * 0.3);

        setTimeout(() => { agent.isAttacking = false; }, 300);
    }

    _heavyAttack(id, angle) {
        const agent = this.agents[id];
        const weapon = this.weapons[id];
        if (!agent || !weapon) return;

        agent.lastAttack = this.gameTime;
        agent.isAttacking = true;

        // Heavier force
        const force = 0.025;
        Body.applyForce(weapon.body, weapon.body.position, {
            x: Math.cos(angle) * force,
            y: Math.sin(angle) * force,
        });
        Body.setAngularVelocity(weapon.body, (Math.random() > 0.5 ? 1 : -1) * 0.5);

        // Sparks from windup
        for (let i = 0; i < 4; i++) {
            this.particles.push({
                x: agent.body.position.x,
                y: agent.body.position.y,
                vx: Math.cos(angle) * (2 + Math.random() * 4),
                vy: Math.sin(angle) * (2 + Math.random() * 4),
                life: 1,
                color: '#FFE93E',
                size: 1 + Math.random() * 3,
                type: 'spark',
            });
        }

        setTimeout(() => { agent.isAttacking = false; }, 500);
    }

    _specialAttack(id, angle) {
        const agent = this.agents[id];
        const weapon = this.weapons[id];
        if (!agent || !weapon || !agent.specialReady) return;

        agent.specialMeter = 0;
        agent.specialReady = false;
        agent.lastAttack = this.gameTime;
        agent.isAttacking = true;

        // Massive force
        const force = 0.04;
        Body.applyForce(weapon.body, weapon.body.position, {
            x: Math.cos(angle) * force,
            y: Math.sin(angle) * force,
        });
        Body.setAngularVelocity(weapon.body, (Math.random() > 0.5 ? 1 : -1) * 0.8);

        // Big particle burst
        for (let i = 0; i < 16; i++) {
            const a = (Math.PI * 2 / 16) * i;
            this.particles.push({
                x: agent.body.position.x,
                y: agent.body.position.y,
                vx: Math.cos(a) * (3 + Math.random() * 5),
                vy: Math.sin(a) * (3 + Math.random() * 5),
                life: 1,
                color: agent.color,
                size: 3 + Math.random() * 5,
                type: 'special',
            });
        }

        // Screen shake
        this.shakeIntensity = 12;

        this.comboEffects.push({
            x: agent.body.position.x,
            y: agent.body.position.y - 50,
            text: '⚡ SPECIAL!',
            time: this.gameTime,
            color: '#FFE93E',
            size: 24,
        });

        setTimeout(() => { agent.isAttacking = false; }, 600);
    }

    _defend(id) {
        const agent = this.agents[id];
        agent.isDefending = true;
        agent.defendUntil = this.gameTime + 1200;
        setTimeout(() => { agent.isDefending = false; }, 1200);
    }

    _dodge(id) {
        const agent = this.agents[id];
        agent.isDodging = true;
        agent.dodgeUntil = this.gameTime + 400;
        agent.dodges++;

        // Quick dash in perpendicular direction
        const otherId = Object.keys(this.agents).find(k => k !== id);
        if (otherId) {
            const otherPos = this.agents[otherId].body.position;
            const angle = Math.atan2(otherPos.y - agent.body.position.y, otherPos.x - agent.body.position.x);
            const dodgeAngle = angle + (Math.PI / 2) * (Math.random() > 0.5 ? 1 : -1);
            Body.applyForce(agent.body, agent.body.position, {
                x: Math.cos(dodgeAngle) * 0.003,
                y: Math.sin(dodgeAngle) * 0.003,
            });
        }

        // Afterimage particles
        for (let i = 0; i < 5; i++) {
            this.particles.push({
                x: agent.body.position.x + (Math.random() - 0.5) * 20,
                y: agent.body.position.y + (Math.random() - 0.5) * 20,
                vx: 0,
                vy: 0,
                life: 0.7,
                color: agent.color,
                size: 15 + Math.random() * 10,
                type: 'afterimage',
            });
        }

        setTimeout(() => { agent.isDodging = false; }, 400);
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

            if (dist < 38 && weaponSpeed > 2) {
                // Dodge check
                if (other.isDodging || (other.dodgeChance > 0 && Math.random() * 100 < other.dodgeChance)) {
                    // Dodged!
                    this.comboEffects.push({
                        x: otherPos.x,
                        y: otherPos.y - 40,
                        text: 'DODGE!',
                        time: this.gameTime,
                        color: '#00F5FF',
                        size: 16,
                    });
                    other.dodges++;
                    continue;
                }

                // Defend check
                if (other.isDefending) {
                    const reducedDamage = Math.round(weaponSpeed * 0.5);
                    other.hp = Math.max(0, other.hp - reducedDamage);
                    other.invincible = this.gameTime + 300;

                    this.comboEffects.push({
                        x: otherPos.x,
                        y: otherPos.y - 40,
                        text: `🛡️ BLOCK -${reducedDamage}`,
                        time: this.gameTime,
                        color: '#836EF9',
                        size: 14,
                    });

                    // Stun attacker briefly on block
                    attacker.stunUntil = this.gameTime + 400;

                    // Reflect damage
                    if (other.reflect > 0) {
                        const reflectDmg = Math.round(reducedDamage * other.reflect / 100);
                        attacker.hp = Math.max(0, attacker.hp - reflectDmg);
                    }
                    continue;
                }

                // ── Calculate damage ──
                let baseDamage = 8 + weaponSpeed * 2.5 + Math.random() * 5;

                // Equipment bonus damage
                baseDamage += attacker.bonusDamage;

                // Low HP bonus (berserker)
                if (attacker.lowHPBonus > 0) {
                    const hpPct = attacker.hp / attacker.maxHp;
                    if (hpPct < 0.3) {
                        baseDamage *= (1 + attacker.lowHPBonus / 100);
                    }
                }

                // Critical hit check
                let isCrit = false;
                if (Math.random() * 100 < attacker.critChance) {
                    baseDamage = baseDamage * (attacker.critDamage / 100);
                    isCrit = true;
                    attacker.critHits++;
                }

                // Apply defense (with armor penetration)
                const effectiveDefense = Math.max(0, other.defense - attacker.armorPen);
                const damageReduction = effectiveDefense / (effectiveDefense + 50); // Diminishing returns
                baseDamage *= (1 - damageReduction);

                const damage = Math.round(Math.max(1, baseDamage));
                other.hp = Math.max(0, other.hp - damage);
                other.invincible = this.gameTime + 500;
                attacker.score += damage;
                attacker.hitsLanded++;
                other.hitsTaken++;

                // ── Combo tracking ──
                const comboWindow = attacker.comboWindowMs;
                if (this.gameTime - attacker.lastHitTime < comboWindow) {
                    attacker.combo++;
                    if (attacker.combo > attacker.maxCombo) attacker.maxCombo = attacker.combo;
                } else {
                    attacker.combo = 1;
                }
                attacker.lastHitTime = this.gameTime;

                // Build special meter
                attacker.specialMeter = Math.min(100, attacker.specialMeter + 8 + (isCrit ? 15 : 0) + (attacker.combo >= 3 ? 10 : 0));
                if (attacker.specialMeter >= 100 && !attacker.specialReady) {
                    attacker.specialReady = true;
                    this.comboEffects.push({
                        x: attacker.body.position.x,
                        y: attacker.body.position.y - 60,
                        text: '⚡ SPECIAL READY!',
                        time: this.gameTime,
                        color: '#FFE93E',
                        size: 18,
                    });
                }

                // ── Lifesteal ──
                if (attacker.lifesteal > 0) {
                    const healAmount = Math.round(damage * attacker.lifesteal / 100);
                    attacker.hp = Math.min(attacker.maxHp, attacker.hp + healAmount);

                    // Green heal particles
                    for (let i = 0; i < 3; i++) {
                        this.particles.push({
                            x: attacker.body.position.x + (Math.random() - 0.5) * 20,
                            y: attacker.body.position.y,
                            vx: (Math.random() - 0.5) * 2,
                            vy: -1 - Math.random() * 2,
                            life: 1,
                            color: '#39FF14',
                            size: 2 + Math.random() * 3,
                            type: 'heal',
                        });
                    }
                }

                // ── Thorn damage ──
                if (other.thornDamage > 0) {
                    attacker.hp = Math.max(0, attacker.hp - other.thornDamage);
                }

                // ── Burn effect ──
                if (attacker.burnDamage > 0) {
                    other.burnUntil = this.gameTime + 3000;
                    // Fire particles on target
                    for (let i = 0; i < 4; i++) {
                        this.particles.push({
                            x: otherPos.x + (Math.random() - 0.5) * 20,
                            y: otherPos.y + (Math.random() - 0.5) * 20,
                            vx: (Math.random() - 0.5) * 3,
                            vy: -1 - Math.random() * 3,
                            life: 1,
                            color: '#FF6B35',
                            size: 2 + Math.random() * 4,
                            type: 'fire',
                        });
                    }
                }

                // ── Slow effect ──
                if (attacker.slowEffect > 0) {
                    other.slowUntil = this.gameTime + 2000;
                }

                // ── Hit visual effects ──

                // Hit effect
                this.hitEffects.push({
                    x: otherPos.x,
                    y: otherPos.y,
                    damage,
                    time: this.gameTime,
                    color: attacker.color,
                    isCrit,
                    isCombo: attacker.combo >= 3,
                });

                // Combo text
                if (attacker.combo >= 2) {
                    const comboTexts = ['', '', 'DOUBLE!', 'TRIPLE!', 'ULTRA!', 'MEGA!', 'INSANE!', 'GODLIKE!'];
                    const comboText = comboTexts[Math.min(attacker.combo, comboTexts.length - 1)];
                    this.comboEffects.push({
                        x: otherPos.x,
                        y: otherPos.y - 70,
                        text: `${attacker.combo}x ${comboText}`,
                        time: this.gameTime,
                        color: attacker.combo >= 5 ? '#FFE93E' : attacker.combo >= 3 ? '#FF6B35' : '#00F5FF',
                        size: 14 + Math.min(attacker.combo * 2, 12),
                    });
                }

                // Critical hit text
                if (isCrit) {
                    this.comboEffects.push({
                        x: otherPos.x + (Math.random() - 0.5) * 30,
                        y: otherPos.y - 55,
                        text: '💥 CRITICAL!',
                        time: this.gameTime,
                        color: '#FF2D78',
                        size: 20,
                    });
                    this.shakeIntensity = Math.max(this.shakeIntensity, 8);
                }

                // Spawn particles — more for bigger hits
                const particleCount = isCrit ? 14 : (attacker.combo >= 3 ? 10 : 6);
                for (let i = 0; i < particleCount; i++) {
                    const pAngle = (Math.PI * 2 / particleCount) * i + Math.random() * 0.5;
                    this.particles.push({
                        x: otherPos.x,
                        y: otherPos.y,
                        vx: Math.cos(pAngle) * (3 + Math.random() * (isCrit ? 8 : 4)),
                        vy: Math.sin(pAngle) * (3 + Math.random() * (isCrit ? 8 : 4)),
                        life: 1,
                        color: isCrit ? '#FFE93E' : attacker.color,
                        size: isCrit ? (3 + Math.random() * 5) : (2 + Math.random() * 4),
                        type: 'impact',
                    });
                }

                // Screen shake proportional to damage
                this.shakeIntensity = Math.max(this.shakeIntensity, Math.min(damage * 0.3, 15));

                // Knockback
                const knockAngle = Math.atan2(otherPos.y - weaponPos.y, otherPos.x - weaponPos.x);
                const knockForce = isCrit ? 0.005 : 0.003;
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
        if (!this.isRunning || this.isFinished) return;

        this.gameTime += delta;

        // Round timer countdown
        if (this.roundPauseUntil > this.gameTime) return;

        this.roundTimer -= delta / 1000;

        if (this.roundTimer <= 0) {
            this._endRound();
            return;
        }

        Engine.update(this.engine, delta);

        // AI control
        Object.keys(this.agents).forEach(id => this._aiTick(id));

        // Check weapon hits
        this._checkCollisions();

        // Check KO
        this._checkKO();

        // Burn damage over time
        Object.keys(this.agents).forEach(id => {
            const a = this.agents[id];
            if (a.burnUntil > this.gameTime) {
                if (Math.random() < 0.05) {
                    const burnDmg = 2;
                    a.hp = Math.max(0, a.hp - burnDmg);
                    // Fire particles
                    this.particles.push({
                        x: a.body.position.x + (Math.random() - 0.5) * 20,
                        y: a.body.position.y - 10,
                        vx: (Math.random() - 0.5) * 2,
                        vy: -2 - Math.random() * 2,
                        life: 0.8,
                        color: '#FF6B35',
                        size: 2 + Math.random() * 3,
                        type: 'fire',
                    });
                }
            }
        });

        // Update particles
        this.particles = this.particles.filter(p => {
            p.x += p.vx;
            p.y += p.vy;
            p.vx *= 0.96;
            p.vy *= 0.96;
            p.life -= 0.025;
            return p.life > 0;
        });

        // Clean old effects
        this.hitEffects = this.hitEffects.filter(h => this.gameTime - h.time < 1200);
        this.comboEffects = this.comboEffects.filter(c => this.gameTime - c.time < 1500);

        // Decay screen shake
        this.shakeIntensity *= 0.85;
        if (this.shakeIntensity < 0.5) this.shakeIntensity = 0;

        if (this.onUpdate) {
            this.onUpdate(this.getState());
        }
    }

    _checkKO() {
        const ids = Object.keys(this.agents);
        for (const id of ids) {
            if (this.agents[id].hp <= 0) {
                const winnerId = ids.find(k => k !== id);
                // KO explosion
                const pos = this.agents[id].body.position;
                for (let i = 0; i < 30; i++) {
                    const angle = (Math.PI * 2 / 30) * i;
                    this.particles.push({
                        x: pos.x,
                        y: pos.y,
                        vx: Math.cos(angle) * (4 + Math.random() * 8),
                        vy: Math.sin(angle) * (4 + Math.random() * 8),
                        life: 1,
                        color: this.agents[id].color,
                        size: 3 + Math.random() * 6,
                        type: 'ko',
                    });
                }
                this.shakeIntensity = 20;
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

            if (hp1 === hp2) {
                const winnerId = this.agents[id1].score >= this.agents[id2].score ? id1 : id2;
                this._finishMatch(winnerId, 'decision');
            } else {
                const winnerId = hp1 > hp2 ? id1 : id2;
                this._finishMatch(winnerId, 'decision');
            }
            return;
        }

        // Next round
        this.currentRound++;
        this.roundTimer = this.roundTime;
        this.roundPauseUntil = this.gameTime + 3000;

        // Partial HP restore
        Object.values(this.agents).forEach(a => {
            a.hp = Math.min(a.maxHp, a.hp + 40);
            a.combo = 0;
        });

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
        };
    }

    start() { this.isRunning = true; }
    stop() { this.isRunning = false; }

    destroy() {
        this.stop();
        Engine.clear(this.engine);
        World.clear(this.world);
    }
}
