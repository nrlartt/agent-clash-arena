// ═══════════════════════════════════════════════════════════════
// GAME CANVAS v3 — Optimized rendering, round transitions,
// screen shake, elemental effects, performance-capped particles
// ═══════════════════════════════════════════════════════════════

import { useEffect, useRef, useCallback } from 'react';
import { GameEngine } from '../engine/GameEngine';
import { playSound } from '../utils/audio';

export default function GameCanvas({ agent1, agent2, onStateUpdate, onMatchEnd, isPlaying = true, agent1Equipment, agent2Equipment }) {
    const canvasRef = useRef(null);
    const engineRef = useRef(null);
    const animFrameRef = useRef(null);

    const onStateUpdateRef = useRef(onStateUpdate);
    const onMatchEndRef = useRef(onMatchEnd);
    const agent1Ref = useRef(agent1);
    const agent2Ref = useRef(agent2);
    const isPlayingRef = useRef(isPlaying);

    useEffect(() => { onStateUpdateRef.current = onStateUpdate; }, [onStateUpdate]);
    useEffect(() => { onMatchEndRef.current = onMatchEnd; }, [onMatchEnd]);
    useEffect(() => { agent1Ref.current = agent1; }, [agent1]);
    useEffect(() => { agent2Ref.current = agent2; }, [agent2]);

    // When backend says match is over, pause engine
    useEffect(() => {
        isPlayingRef.current = isPlaying;
        if (!isPlaying && engineRef.current) {
            try { engineRef.current.pause(); } catch (e) { /* ignore */ }
        }
    }, [isPlaying]);

    const draw = useCallback((ctx, state, w, h) => {
        const a1 = agent1Ref.current;
        const a2 = agent2Ref.current;

        // ── Screen Shake ──
        ctx.save();
        if (state?.shakeIntensity > 0) {
            const sx = (Math.random() - 0.5) * state.shakeIntensity * 2;
            const sy = (Math.random() - 0.5) * state.shakeIntensity * 2;
            ctx.translate(sx, sy);
        }

        // ── Background ──
        ctx.clearRect(-20, -20, w + 40, h + 40);

        const bgGrad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w * 0.75);
        bgGrad.addColorStop(0, '#1a1428');
        bgGrad.addColorStop(0.6, '#0f0c18');
        bgGrad.addColorStop(1, '#080610');
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, w, h);

        // Ring mat
        const pad = 30;
        const ringGrad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w * 0.45);
        ringGrad.addColorStop(0, 'rgba(131, 110, 249, 0.06)');
        ringGrad.addColorStop(0.7, 'rgba(131, 110, 249, 0.02)');
        ringGrad.addColorStop(1, 'transparent');
        ctx.fillStyle = ringGrad;
        ctx.fillRect(pad, pad, w - pad * 2, h - pad * 2);

        // Corner pads
        const cornerSize = 14;
        const corners = [
            { x: pad, y: pad, color: '#FF2D78' },
            { x: w - pad, y: pad, color: '#00F5FF' },
            { x: pad, y: h - pad, color: '#836EF9' },
            { x: w - pad, y: h - pad, color: '#FFE93E' },
        ];
        corners.forEach(c => {
            ctx.beginPath();
            ctx.arc(c.x, c.y, cornerSize, 0, Math.PI * 2);
            ctx.fillStyle = c.color + '25';
            ctx.fill();
            ctx.beginPath();
            ctx.arc(c.x, c.y, cornerSize * 0.4, 0, Math.PI * 2);
            ctx.fillStyle = c.color + '50';
            ctx.fill();
        });

        // Ring ropes
        ctx.lineWidth = 1;
        [0.25, 0.5, 0.75].forEach((ratio, i) => {
            const alpha = [0.1, 0.2, 0.1][i];
            const ropeColor = i === 1 ? '#FF2D78' : '#ffffff';
            const hex = Math.round(alpha * 255).toString(16).padStart(2, '0');

            ctx.beginPath();
            ctx.moveTo(pad, pad + (h - pad * 2) * ratio);
            ctx.lineTo(w - pad, pad + (h - pad * 2) * ratio);
            ctx.strokeStyle = ropeColor + hex;
            ctx.lineWidth = i === 1 ? 2 : 1;
            ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(pad + (w - pad * 2) * ratio, pad);
            ctx.lineTo(pad + (w - pad * 2) * ratio, h - pad);
            ctx.stroke();
        });

        // Arena border
        const borderGrad = ctx.createLinearGradient(0, 0, w, 0);
        borderGrad.addColorStop(0, '#FF2D78');
        borderGrad.addColorStop(0.5, '#836EF9');
        borderGrad.addColorStop(1, '#00F5FF');
        ctx.strokeStyle = borderGrad;
        ctx.lineWidth = 2.5;
        ctx.shadowColor = '#836EF9';
        ctx.shadowBlur = 10;
        ctx.strokeRect(pad, pad, w - pad * 2, h - pad * 2);
        ctx.shadowBlur = 0;

        // Center ring
        ctx.beginPath();
        ctx.arc(w / 2, h / 2, Math.min(w, h) * 0.12, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(131, 110, 249, 0.1)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 5]);
        ctx.stroke();
        ctx.setLineDash([]);

        if (!state || !state.agents) { ctx.restore(); return; }

        const agents = state.agents;
        const agentIds = Object.keys(agents);

        // ── Particles (batched drawing) ──
        state.particles?.forEach(p => {
            const alpha = Math.min(1, p.life);
            if (alpha <= 0) return;
            const hex = Math.round(alpha * 200).toString(16).padStart(2, '0');

            ctx.beginPath();
            if (p.type === 'afterimage') {
                ctx.arc(p.x, p.y, p.size * alpha, 0, Math.PI * 2);
                ctx.fillStyle = p.color + Math.round(alpha * 40).toString(16).padStart(2, '0');
                ctx.fill();
            } else if (p.type === 'fire') {
                ctx.arc(p.x, p.y, p.size * alpha, 0, Math.PI * 2);
                ctx.fillStyle = p.color + hex;
                ctx.fill();
            } else if (p.type === 'heal') {
                ctx.font = `${10 + p.size}px sans-serif`;
                ctx.textAlign = 'center';
                ctx.fillStyle = p.color + hex;
                ctx.fillText('+', p.x, p.y);
            } else if (p.type === 'special' || p.type === 'ko') {
                ctx.arc(p.x, p.y, p.size * alpha, 0, Math.PI * 2);
                ctx.fillStyle = p.color + Math.round(alpha * 255).toString(16).padStart(2, '0');
                ctx.shadowColor = p.color;
                ctx.shadowBlur = 8;
                ctx.fill();
                ctx.shadowBlur = 0;
            } else {
                ctx.arc(p.x, p.y, p.size * alpha, 0, Math.PI * 2);
                ctx.fillStyle = p.color + hex;
                ctx.fill();
            }
        });

        // ── Weapon chains ──
        agentIds.forEach(id => {
            const a = agents[id];
            if (a.weaponX && a.weaponY) {
                ctx.beginPath();
                ctx.moveTo(a.x, a.y);
                ctx.lineTo(a.weaponX, a.weaponY);
                ctx.strokeStyle = `${a.color}33`;
                ctx.lineWidth = 1.5;
                ctx.setLineDash([3, 3]);
                ctx.stroke();
                ctx.setLineDash([]);
            }
        });

        // ── Draw Agents ──
        agentIds.forEach((id, idx) => {
            const a = agents[id];
            const agentData = idx === 0 ? a1 : a2;

            // Status ring effects
            if (a.isBurning) {
                ctx.beginPath();
                ctx.arc(a.x, a.y, 40, 0, Math.PI * 2);
                ctx.strokeStyle = '#FF6B3555';
                ctx.lineWidth = 2.5;
                ctx.stroke();
            }

            if (a.isSlowed) {
                ctx.beginPath();
                ctx.arc(a.x, a.y, 42, 0, Math.PI * 2);
                ctx.strokeStyle = '#69D2E733';
                ctx.lineWidth = 2;
                ctx.setLineDash([4, 4]);
                ctx.stroke();
                ctx.setLineDash([]);
            }

            if (a.isDefending) {
                const shieldAngle = Math.atan2(
                    agents[agentIds.find(k => k !== id)]?.y - a.y || 0,
                    agents[agentIds.find(k => k !== id)]?.x - a.x || 0
                );
                ctx.beginPath();
                ctx.arc(a.x, a.y, 34, shieldAngle - 0.9, shieldAngle + 0.9);
                ctx.strokeStyle = '#836EF9';
                ctx.lineWidth = 4;
                ctx.shadowColor = '#836EF9';
                ctx.shadowBlur = 10;
                ctx.stroke();
                ctx.shadowBlur = 0;
            }

            const agentAlpha = a.isDodging ? 0.25 : 1;

            // Glow ring
            ctx.beginPath();
            ctx.arc(a.x, a.y, 36, 0, Math.PI * 2);
            ctx.fillStyle = `${a.color}${Math.round(agentAlpha * 18).toString(16).padStart(2, '0')}`;
            ctx.fill();

            // Agent body
            ctx.globalAlpha = agentAlpha;
            const bodyGrad = ctx.createRadialGradient(a.x - 4, a.y - 4, 0, a.x, a.y, 26);
            bodyGrad.addColorStop(0, a.color);
            bodyGrad.addColorStop(1, `${a.color}77`);
            ctx.beginPath();
            ctx.arc(a.x, a.y, 26, 0, Math.PI * 2);
            ctx.fillStyle = bodyGrad;
            ctx.fill();

            // Border with attack glow
            ctx.beginPath();
            ctx.arc(a.x, a.y, 26, 0, Math.PI * 2);
            ctx.strokeStyle = a.color;
            ctx.lineWidth = 2;
            ctx.shadowColor = a.color;
            ctx.shadowBlur = a.isAttacking ? 22 : (a.specialReady ? 14 : 6);
            ctx.stroke();
            ctx.shadowBlur = 0;

            // Stun stars
            if (a.isStunned) {
                const t = state.gameTime / 250;
                for (let s = 0; s < 3; s++) {
                    const sx = a.x + Math.cos(t + s * 2.1) * 20;
                    const sy = a.y - 28 + Math.sin(t + s * 2.1) * 6;
                    ctx.font = '9px sans-serif';
                    ctx.textAlign = 'center';
                    ctx.globalAlpha = 1;
                    ctx.fillText('⭐', sx, sy);
                }
            }

            // Agent emoji
            ctx.globalAlpha = agentAlpha;
            ctx.font = '20px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(agentData?.avatar || '⚔️', a.x, a.y + 1);
            ctx.globalAlpha = 1;

            // ── Weapon Drawing ──
            if (a.weaponX && a.weaponY) {
                ctx.save();
                ctx.translate(a.weaponX, a.weaponY);
                ctx.rotate(a.weaponAngle || 0);
                ctx.globalAlpha = agentAlpha;

                if (a.isAttacking) {
                    ctx.shadowColor = a.color;
                    ctx.shadowBlur = 16;
                }

                const wType = agentData?.weapon?.id || 'blade';

                // Simplified weapon drawing for performance
                switch (wType) {
                    case 'blade': {
                        const bg = ctx.createLinearGradient(-25, 0, 30, 0);
                        bg.addColorStop(0, '#888');
                        bg.addColorStop(0.5, '#ddd');
                        bg.addColorStop(1, a.color);
                        ctx.fillStyle = bg;
                        ctx.beginPath();
                        ctx.moveTo(-25, -2);
                        ctx.lineTo(24, -3.5);
                        ctx.lineTo(35, 0);
                        ctx.lineTo(24, 3.5);
                        ctx.lineTo(-25, 2);
                        ctx.closePath();
                        ctx.fill();
                        ctx.fillStyle = '#A08040';
                        ctx.fillRect(-27, -5, 3, 10);
                        ctx.fillStyle = '#553322';
                        ctx.fillRect(-35, -2.5, 10, 5);
                        break;
                    }
                    case 'mace': {
                        ctx.fillStyle = '#8B7355';
                        ctx.fillRect(-28, -2.5, 38, 5);
                        ctx.beginPath();
                        ctx.arc(30, 0, 9, 0, Math.PI * 2);
                        const mg = ctx.createRadialGradient(28, -2, 0, 30, 0, 9);
                        mg.addColorStop(0, '#ddd');
                        mg.addColorStop(1, a.color);
                        ctx.fillStyle = mg;
                        ctx.fill();
                        ctx.fillStyle = a.color;
                        for (let i = 0; i < 5; i++) {
                            const sa = (Math.PI * 2 / 5) * i;
                            ctx.beginPath();
                            ctx.moveTo(30 + Math.cos(sa) * 7, Math.sin(sa) * 7);
                            ctx.lineTo(30 + Math.cos(sa) * 12, Math.sin(sa) * 12);
                            ctx.lineTo(30 + Math.cos(sa + 0.35) * 7, Math.sin(sa + 0.35) * 7);
                            ctx.closePath();
                            ctx.fill();
                        }
                        break;
                    }
                    case 'scythe': {
                        ctx.fillStyle = '#5C4033';
                        ctx.fillRect(-32, -2, 50, 4);
                        ctx.beginPath();
                        ctx.moveTo(16, -2);
                        ctx.quadraticCurveTo(36, -18, 32, -30);
                        ctx.quadraticCurveTo(29, -26, 26, -18);
                        ctx.quadraticCurveTo(22, -10, 16, -2);
                        ctx.closePath();
                        const sg = ctx.createLinearGradient(16, 0, 32, -30);
                        sg.addColorStop(0, '#aaa');
                        sg.addColorStop(1, a.color);
                        ctx.fillStyle = sg;
                        ctx.fill();
                        break;
                    }
                    case 'whip': {
                        ctx.fillStyle = '#6B3A2A';
                        ctx.fillRect(-28, -2.5, 16, 5);
                        ctx.beginPath();
                        const t = (state?.gameTime || 0) / 180;
                        for (let i = 0; i <= 7; i++) {
                            const px = -12 + i * 6;
                            const py = Math.sin(t + i * 0.9) * (2.5 + i * 0.6);
                            if (i === 0) ctx.moveTo(px, py);
                            else ctx.lineTo(px, py);
                        }
                        ctx.strokeStyle = a.color;
                        ctx.lineWidth = 2.5;
                        ctx.lineCap = 'round';
                        ctx.stroke();
                        ctx.beginPath();
                        ctx.arc(30, Math.sin(t + 5.6) * 6, 3.5, 0, Math.PI * 2);
                        ctx.fillStyle = a.color;
                        ctx.fill();
                        break;
                    }
                    case 'lance': {
                        ctx.fillStyle = '#7B6545';
                        ctx.fillRect(-32, -2, 50, 4);
                        ctx.beginPath();
                        ctx.moveTo(18, -6);
                        ctx.lineTo(38, 0);
                        ctx.lineTo(18, 6);
                        ctx.lineTo(22, 0);
                        ctx.closePath();
                        const ltg = ctx.createLinearGradient(18, 0, 38, 0);
                        ltg.addColorStop(0, '#88ccff');
                        ltg.addColorStop(1, a.color);
                        ctx.fillStyle = ltg;
                        ctx.fill();
                        break;
                    }
                    case 'hammer': {
                        ctx.fillStyle = '#6B4226';
                        ctx.fillRect(-28, -2, 38, 4);
                        const hg = ctx.createLinearGradient(8, -10, 8, 10);
                        hg.addColorStop(0, '#bbb');
                        hg.addColorStop(0.5, a.color);
                        hg.addColorStop(1, '#888');
                        ctx.fillStyle = hg;
                        ctx.fillRect(8, -10, 20, 20);
                        ctx.fillStyle = '#ddd';
                        ctx.fillRect(26, -8, 3, 16);
                        break;
                    }
                    case 'axe': {
                        ctx.fillStyle = '#5C4033';
                        ctx.fillRect(-28, -2, 44, 4);
                        ctx.beginPath();
                        ctx.moveTo(14, -4);
                        ctx.quadraticCurveTo(28, -16, 18, -20);
                        ctx.lineTo(10, -10);
                        ctx.closePath();
                        const axg = ctx.createLinearGradient(10, 0, 28, -20);
                        axg.addColorStop(0, '#aaa');
                        axg.addColorStop(1, a.color);
                        ctx.fillStyle = axg;
                        ctx.fill();
                        ctx.beginPath();
                        ctx.moveTo(14, 4);
                        ctx.quadraticCurveTo(28, 16, 18, 20);
                        ctx.lineTo(10, 10);
                        ctx.closePath();
                        ctx.fill();
                        break;
                    }
                    case 'fist': {
                        ctx.beginPath();
                        ctx.arc(0, 0, 10, 0, Math.PI * 2);
                        const fg = ctx.createRadialGradient(-1, -1, 0, 0, 0, 10);
                        fg.addColorStop(0, '#ccc');
                        fg.addColorStop(1, a.color);
                        ctx.fillStyle = fg;
                        ctx.fill();
                        for (let i = 0; i < 4; i++) {
                            ctx.beginPath();
                            ctx.arc(-5 + i * 3.5, -9, 2.5, 0, Math.PI * 2);
                            ctx.fillStyle = '#aaa';
                            ctx.fill();
                        }
                        break;
                    }
                    default: {
                        const dfg = ctx.createLinearGradient(-22, 0, 22, 0);
                        dfg.addColorStop(0, '#888');
                        dfg.addColorStop(1, a.color);
                        ctx.fillStyle = dfg;
                        ctx.fillRect(-22, -2.5, 44, 5);
                        ctx.beginPath();
                        ctx.moveTo(22, -6);
                        ctx.lineTo(34, 0);
                        ctx.lineTo(22, 6);
                        ctx.closePath();
                        ctx.fillStyle = a.color;
                        ctx.fill();
                    }
                }

                ctx.shadowBlur = 0;
                ctx.globalAlpha = 1;
                ctx.restore();
            }

            // ── Name tag ──
            ctx.font = '600 11px "Inter", sans-serif';
            ctx.textAlign = 'center';
            ctx.fillStyle = a.color;
            ctx.shadowColor = a.color;
            ctx.shadowBlur = 4;
            ctx.fillText(agentData?.name || `Agent ${id}`, a.x, a.y - 52);
            ctx.shadowBlur = 0;

            // ── HP bar (enhanced) ──
            const hpBarW = 64;
            const hpBarH = 8;
            const hpX = a.x - hpBarW / 2;
            const hpY = a.y - 44;
            const hpPct = Math.max(0, a.hp / a.maxHp);

            // Background (dark with border)
            ctx.fillStyle = '#0a0a1599';
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
            ctx.lineWidth = 0.5;
            const hpRadius = 3;
            ctx.beginPath();
            ctx.roundRect(hpX - 1, hpY - 1, hpBarW + 2, hpBarH + 2, hpRadius + 1);
            ctx.fill();
            ctx.stroke();

            // HP fill with gradient
            const hpColor = hpPct > 0.6 ? '#39FF14' : hpPct > 0.35 ? '#FFE93E' : '#FF3131';
            const hpColor2 = hpPct > 0.6 ? '#22CC00' : hpPct > 0.35 ? '#FF9900' : '#CC0000';
            const hpGrad = ctx.createLinearGradient(hpX, hpY, hpX, hpY + hpBarH);
            hpGrad.addColorStop(0, hpColor);
            hpGrad.addColorStop(1, hpColor2);

            if (hpPct > 0) {
                ctx.save();
                ctx.beginPath();
                ctx.roundRect(hpX, hpY, hpBarW * hpPct, hpBarH, hpRadius);
                ctx.clip();
                ctx.fillStyle = hpGrad;
                ctx.fillRect(hpX, hpY, hpBarW * hpPct, hpBarH);

                // Shiny top highlight
                ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
                ctx.fillRect(hpX, hpY, hpBarW * hpPct, hpBarH * 0.35);
                ctx.restore();
            }

            // Glow when low HP
            if (hpPct < 0.3 && hpPct > 0) {
                const pulse = 0.3 + Math.sin(state.gameTime / 200) * 0.2;
                ctx.shadowColor = '#FF3131';
                ctx.shadowBlur = 8 * pulse;
                ctx.beginPath();
                ctx.roundRect(hpX, hpY, hpBarW * hpPct, hpBarH, hpRadius);
                ctx.fillStyle = `rgba(255, 49, 49, ${pulse * 0.3})`;
                ctx.fill();
                ctx.shadowBlur = 0;
            }

            // HP text
            ctx.font = '700 7px "Orbitron", "Inter", sans-serif';
            ctx.textAlign = 'center';
            ctx.fillStyle = '#ffffffCC';
            ctx.fillText(`${Math.round(a.hp)}/${a.maxHp}`, a.x, hpY + hpBarH - 1);

            // HP percentage on the right
            ctx.font = '600 7px "Inter", sans-serif';
            ctx.textAlign = 'right';
            ctx.fillStyle = hpColor;
            ctx.fillText(`${Math.round(hpPct * 100)}%`, hpX + hpBarW + 18, hpY + hpBarH - 1);

            // ── Special meter (enhanced) ──
            if (a.specialMeter > 0) {
                const spY = hpY + hpBarH + 3;
                const spBarH = 3;
                const spPct = a.specialMeter / 100;

                ctx.fillStyle = '#0a0a1566';
                ctx.beginPath();
                ctx.roundRect(hpX, spY, hpBarW, spBarH, 1.5);
                ctx.fill();

                const spColor = a.specialReady ? '#FFE93E' : '#836EF9';
                const spGrad = ctx.createLinearGradient(hpX, spY, hpX + hpBarW * spPct, spY);
                spGrad.addColorStop(0, spColor + '88');
                spGrad.addColorStop(1, spColor);

                if (a.specialReady) {
                    ctx.shadowColor = '#FFE93E';
                    ctx.shadowBlur = 8;
                }
                ctx.fillStyle = spGrad;
                ctx.beginPath();
                ctx.roundRect(hpX, spY, hpBarW * spPct, spBarH, 1.5);
                ctx.fill();
                ctx.shadowBlur = 0;

                // "SPECIAL" text when ready
                if (a.specialReady) {
                    ctx.font = '700 6px "Orbitron", sans-serif';
                    ctx.textAlign = 'center';
                    ctx.fillStyle = '#FFE93E';
                    ctx.shadowColor = '#FFE93E';
                    ctx.shadowBlur = 4;
                    ctx.fillText('SPECIAL', a.x, spY + spBarH + 8);
                    ctx.shadowBlur = 0;
                }
            }
        });

        // ── Hit Effects ──
        state.hitEffects?.forEach(h => {
            const elapsed = state.gameTime - h.time;
            const progress = elapsed / 1000;
            if (progress > 1) return;

            const textSize = h.isCrit ? 22 : (h.isCombo ? 18 : 14);
            ctx.font = `800 ${textSize + progress * 4}px "Orbitron", sans-serif`;
            ctx.textAlign = 'center';
            const alpha = Math.round((1 - progress) * 255).toString(16).padStart(2, '0');
            ctx.fillStyle = (h.isCrit ? '#FFE93E' : h.color) + alpha;
            if (h.isCrit) {
                ctx.shadowColor = '#FFE93E';
                ctx.shadowBlur = 8;
            }
            ctx.fillText(`-${h.damage}`, h.x, h.y - 48 - progress * 35);
            ctx.shadowBlur = 0;

            // Impact ring
            ctx.beginPath();
            ctx.arc(h.x, h.y, (h.isCrit ? 12 : 8) + progress * (h.isCrit ? 45 : 30), 0, Math.PI * 2);
            ctx.strokeStyle = h.color + Math.round((1 - progress) * 60).toString(16).padStart(2, '0');
            ctx.lineWidth = (h.isCrit ? 2.5 : 1.5) * (1 - progress);
            ctx.stroke();
        });

        // ── Combo / Special Text ──
        state.comboEffects?.forEach(c => {
            const elapsed = state.gameTime - c.time;
            const progress = elapsed / 1200;
            if (progress > 1) return;

            const alpha = Math.round((1 - progress) * 255).toString(16).padStart(2, '0');
            ctx.font = `800 ${c.size}px "Orbitron", sans-serif`;
            ctx.textAlign = 'center';
            ctx.fillStyle = c.color + alpha;
            ctx.shadowColor = c.color;
            ctx.shadowBlur = 8;
            ctx.fillText(c.text, c.x, c.y - progress * 25);
            ctx.shadowBlur = 0;
        });

        // ── Round/Timer HUD ──
        if (state.roundTimer !== undefined && !state.isFinished) {
            ctx.font = '700 11px "Orbitron", sans-serif';
            ctx.textAlign = 'center';
            ctx.fillStyle = 'rgba(131, 110, 249, 0.7)';
            ctx.fillText(`ROUND ${state.currentRound}/${state.maxRounds}`, w / 2, 38);

            const minutes = Math.floor(state.roundTimer / 60);
            const seconds = state.roundTimer % 60;
            const timerText = `${minutes}:${String(seconds).padStart(2, '0')}`;
            const timerColor = state.roundTimer <= 5 ? '#FF3131' : state.roundTimer <= 10 ? '#FFE93E' : '#ffffff';

            ctx.font = '700 20px "Orbitron", sans-serif';
            ctx.fillStyle = timerColor;
            if (state.roundTimer <= 5) {
                ctx.shadowColor = '#FF3131';
                ctx.shadowBlur = 8;
            }
            ctx.fillText(timerText, w / 2, 58);
            ctx.shadowBlur = 0;
        }

        // ── ROUND TRANSITION OVERLAY ──
        if (state.roundPauseUntil > state.gameTime) {
            const pauseRemaining = state.roundPauseUntil - state.gameTime;
            const pauseProgress = 1 - (pauseRemaining / 3000); // 0→1
            const fadeAlpha = pauseProgress < 0.2 ? pauseProgress / 0.2 :
                              pauseProgress > 0.7 ? (1 - pauseProgress) / 0.3 : 1;

            // Dark overlay
            ctx.fillStyle = `rgba(0, 0, 0, ${0.5 * fadeAlpha})`;
            ctx.fillRect(0, 0, w, h);

            // Round text
            const scale = 0.8 + pauseProgress * 0.4;
            ctx.save();
            ctx.translate(w / 2, h / 2);
            ctx.scale(scale, scale);

            ctx.font = '900 48px "Orbitron", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = `rgba(131, 110, 249, ${fadeAlpha})`;
            ctx.shadowColor = '#836EF9';
            ctx.shadowBlur = 20 * fadeAlpha;
            ctx.fillText(`ROUND ${state.currentRound}`, 0, -15);

            ctx.font = '600 16px "Orbitron", sans-serif';
            ctx.fillStyle = `rgba(255, 233, 62, ${fadeAlpha * 0.8})`;
            ctx.shadowColor = '#FFE93E';
            ctx.shadowBlur = 10 * fadeAlpha;
            ctx.fillText('FIGHT!', 0, 25);
            ctx.shadowBlur = 0;

            ctx.restore();

            // Horizontal flash lines
            if (pauseProgress > 0.3 && pauseProgress < 0.8) {
                const lineAlpha = fadeAlpha * 0.4;
                ctx.strokeStyle = `rgba(131, 110, 249, ${lineAlpha})`;
                ctx.lineWidth = 1;
                const lineY1 = h / 2 - 35;
                const lineY2 = h / 2 + 40;
                const lineW = w * 0.4 * pauseProgress;
                ctx.beginPath();
                ctx.moveTo(w / 2 - lineW, lineY1);
                ctx.lineTo(w / 2 + lineW, lineY1);
                ctx.stroke();
                ctx.beginPath();
                ctx.moveTo(w / 2 - lineW, lineY2);
                ctx.lineTo(w / 2 + lineW, lineY2);
                ctx.stroke();
            }
        }

        // ── Match End: simple dim (Arena banner handles the rest) ──
        if (state.isFinished) {
            ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
            ctx.fillRect(0, 0, w, h);
        }

        ctx.restore();
    }, []);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        const parent = canvas.parentElement;
        let running = true;
        let initFrame = null;
        let resizeObserver = null;
        const sizeRef = { w: 0, h: 0 };

        const resizeCanvas = () => {
            if (!parent) return;
            let w = parent.clientWidth || parent.offsetWidth || 0;
            let h = parent.clientHeight || parent.offsetHeight || 0;
            if (w <= 0 || h <= 0) {
                const rect = parent.getBoundingClientRect();
                w = Math.floor(rect.width) || w;
                h = Math.floor(rect.height) || h;
            }
            if (w <= 0 || h <= 0) return;
            h = Math.max(h, 200);
            if (w === sizeRef.w && h === sizeRef.h) return;
            sizeRef.w = w;
            sizeRef.h = h;
            const dpr = window.devicePixelRatio || 1;
            canvas.width = w * dpr;
            canvas.height = h * dpr;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            if (engineRef.current) {
                engineRef.current.width = w;
                engineRef.current.height = h;
            }
        };

        const initialize = () => {
            resizeCanvas();
            if (sizeRef.w <= 0 || sizeRef.h <= 0) {
                if (running) initFrame = requestAnimationFrame(initialize);
                return;
            }

            const w = sizeRef.w;
            const h = sizeRef.h;
            const a1 = agent1Ref.current;
            const a2 = agent2Ref.current;
            const engine = new GameEngine(w, h);
            engineRef.current = engine;

            engine.addAgent('1', w * 0.25, h * 0.5, a1?.color || '#FF2D78', agent1Equipment || null);
            engine.addAgent('2', w * 0.75, h * 0.5, a2?.color || '#00F5FF', agent2Equipment || null);

            let matchEnded = false;
            let lastTickNotify = 0;
            let lastSoundTime = 0;

            engine.onHit = (attackerId, targetId, damage, remainingHP, extra) => {
                const now = performance.now();
                if (now - lastSoundTime > 80) {
                    lastSoundTime = now;
                    if (extra?.isCrit) playSound('heavyPunch');
                    else if (extra?.combo >= 3) playSound('combo');
                    else playSound('punch');
                }
                if (onStateUpdateRef.current) {
                    onStateUpdateRef.current({
                        type: 'hit', attackerId, targetId, damage, remainingHP, ...extra,
                        agents: engine.getState().agents,
                    });
                }
            };

            engine.onGameEnd = (result) => {
                if (matchEnded) return;
                matchEnded = true;
                if (result.reason === 'ko') playSound('ko');
                // Backend controls match lifecycle — no onMatchEnd call
            };

            engine.onRoundEnd = (roundInfo) => {
                playSound('round');
                if (onStateUpdateRef.current) {
                    onStateUpdateRef.current({ type: 'round_end', ...roundInfo });
                }
            };

            engine.start();
            try { playSound('bell'); } catch (e) { /* ignore */ }

            resizeObserver = new ResizeObserver(() => resizeCanvas());
            resizeObserver.observe(parent);

            // ── Animation loop with proper timing ──
            let lastFrameTime = performance.now();
            let loopErrorCount = 0;

            const loop = (timestamp) => {
                if (!running) return;
                try {
                    // Use real delta for smoother animation
                    const delta = Math.min(timestamp - lastFrameTime, 33.33); // Cap at ~30fps minimum
                    lastFrameTime = timestamp;

                    // Only update engine if match is still playing
                    if (isPlayingRef.current && !engine.isPaused) {
                        engine.update(delta);
                    }

                    const state = engine.getState();
                    const cw = sizeRef.w;
                    const ch = sizeRef.h;

                    if (cw > 0 && ch > 0) {
                        draw(ctx, state, cw, ch);
                    }

                    const now = performance.now();
                    if (isPlayingRef.current && !state.isFinished && now - lastTickNotify > 200) {
                        lastTickNotify = now;
                        if (onStateUpdateRef.current) {
                            onStateUpdateRef.current({
                                type: 'tick', agents: state.agents,
                                roundTimer: state.roundTimer,
                                currentRound: state.currentRound,
                                maxRounds: state.maxRounds,
                            });
                        }
                    }
                } catch (err) {
                    loopErrorCount++;
                    if (loopErrorCount <= 3) console.error('[GameCanvas] Loop error:', err);
                }
                animFrameRef.current = requestAnimationFrame(loop);
            };

            animFrameRef.current = requestAnimationFrame(loop);
        };

        initFrame = requestAnimationFrame(initialize);

        return () => {
            running = false;
            if (initFrame) cancelAnimationFrame(initFrame);
            if (resizeObserver) resizeObserver.disconnect();
            if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
            if (engineRef.current) engineRef.current.destroy();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
        <div className="game-canvas-wrapper" id="game-canvas-wrapper">
            <canvas ref={canvasRef} className="game-canvas" id="game-canvas" />
        </div>
    );
}
