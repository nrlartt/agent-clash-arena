// ═══════════════════════════════════════════════════════════════
// GAME CANVAS v2 — Enhanced visuals with combos, crits,
// screen shake, elemental effects, status indicators
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

    useEffect(() => { onStateUpdateRef.current = onStateUpdate; }, [onStateUpdate]);
    useEffect(() => { onMatchEndRef.current = onMatchEnd; }, [onMatchEnd]);
    useEffect(() => { agent1Ref.current = agent1; }, [agent1]);
    useEffect(() => { agent2Ref.current = agent2; }, [agent2]);

    const drawCountRef = useRef(0);

    const draw = useCallback((ctx, state, w, h) => {
        const a1 = agent1Ref.current;
        const a2 = agent2Ref.current;

        // Debug: log first few draws
        drawCountRef.current++;
        if (drawCountRef.current <= 3) {
            console.log(`[GameCanvas] draw #${drawCountRef.current} — w=${w}, h=${h}, agents=${state?.agents ? Object.keys(state.agents).length : 0}`);
        }

        // ── Screen Shake ──
        ctx.save();
        if (state?.shakeIntensity > 0) {
            const sx = (Math.random() - 0.5) * state.shakeIntensity * 2;
            const sy = (Math.random() - 0.5) * state.shakeIntensity * 2;
            ctx.translate(sx, sy);
        }

        // ── Background — Boxing Ring ──
        ctx.clearRect(-20, -20, w + 40, h + 40);

        // Dark arena floor
        const bgGrad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w * 0.75);
        bgGrad.addColorStop(0, '#1a1428');
        bgGrad.addColorStop(0.6, '#0f0c18');
        bgGrad.addColorStop(1, '#080610');
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, w, h);

        // Ring mat (canvas floor) — slightly lighter area
        const pad = 30;
        const ringGrad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w * 0.45);
        ringGrad.addColorStop(0, 'rgba(131, 110, 249, 0.06)');
        ringGrad.addColorStop(0.7, 'rgba(131, 110, 249, 0.02)');
        ringGrad.addColorStop(1, 'transparent');
        ctx.fillStyle = ringGrad;
        ctx.fillRect(pad, pad, w - pad * 2, h - pad * 2);

        // Ring corner pads (red and blue, boxing style)
        const cornerSize = 16;
        const corners = [
            { x: pad, y: pad, color: '#FF2D78' },           // top-left (red)
            { x: w - pad, y: pad, color: '#00F5FF' },       // top-right (blue)
            { x: pad, y: h - pad, color: '#836EF9' },       // bottom-left (purple)
            { x: w - pad, y: h - pad, color: '#FFE93E' },   // bottom-right (gold)
        ];
        corners.forEach(c => {
            ctx.beginPath();
            ctx.arc(c.x, c.y, cornerSize, 0, Math.PI * 2);
            ctx.fillStyle = c.color + '30';
            ctx.fill();
            ctx.beginPath();
            ctx.arc(c.x, c.y, cornerSize * 0.5, 0, Math.PI * 2);
            ctx.fillStyle = c.color + '60';
            ctx.fill();
        });

        // Ring ropes — 3 horizontal lines (top, middle, bottom of the ring border)
        const ropeOffsets = [0.25, 0.5, 0.75];
        ropeOffsets.forEach((ratio, i) => {
            const alpha = [0.15, 0.25, 0.15][i];
            const ropeColor = i === 1 ? '#FF2D78' : '#ffffff'; // Middle rope is red

            // Top rope
            ctx.beginPath();
            ctx.moveTo(pad, pad + (h - pad * 2) * ratio);
            ctx.lineTo(w - pad, pad + (h - pad * 2) * ratio);
            ctx.strokeStyle = ropeColor + Math.round(alpha * 255).toString(16).padStart(2, '0');
            ctx.lineWidth = i === 1 ? 2.5 : 1.5;
            ctx.stroke();

            // Side ropes
            ctx.beginPath();
            ctx.moveTo(pad + (w - pad * 2) * ratio, pad);
            ctx.lineTo(pad + (w - pad * 2) * ratio, h - pad);
            ctx.stroke();
        });

        // Arena border — glow ropes
        const borderGrad = ctx.createLinearGradient(0, 0, w, 0);
        borderGrad.addColorStop(0, '#FF2D78');
        borderGrad.addColorStop(0.3, '#836EF9');
        borderGrad.addColorStop(0.7, '#836EF9');
        borderGrad.addColorStop(1, '#00F5FF');
        ctx.strokeStyle = borderGrad;
        ctx.lineWidth = 3;
        ctx.shadowColor = '#836EF9';
        ctx.shadowBlur = 12;
        ctx.strokeRect(pad, pad, w - pad * 2, h - pad * 2);
        ctx.shadowBlur = 0;

        // Center ring circle (like boxing center mark)
        ctx.beginPath();
        ctx.arc(w / 2, h / 2, Math.min(w, h) * 0.12, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(131, 110, 249, 0.12)';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 6]);
        ctx.stroke();
        ctx.setLineDash([]);

        // Spotlight effects from corners
        const spotGrad1 = ctx.createRadialGradient(0, 0, 0, 0, 0, w * 0.5);
        spotGrad1.addColorStop(0, 'rgba(255, 45, 120, 0.04)');
        spotGrad1.addColorStop(1, 'transparent');
        ctx.fillStyle = spotGrad1;
        ctx.fillRect(0, 0, w, h);

        const spotGrad2 = ctx.createRadialGradient(w, 0, 0, w, 0, w * 0.5);
        spotGrad2.addColorStop(0, 'rgba(0, 245, 255, 0.04)');
        spotGrad2.addColorStop(1, 'transparent');
        ctx.fillStyle = spotGrad2;
        ctx.fillRect(0, 0, w, h);

        // Crowd silhouettes along edges (subtle)
        ctx.fillStyle = 'rgba(255, 255, 255, 0.015)';
        for (let i = 0; i < 30; i++) {
            const cx = (w / 30) * i + (w / 60);
            // Top crowd
            ctx.beginPath();
            ctx.arc(cx, 8, 5 + Math.sin(i * 1.3) * 2, 0, Math.PI * 2);
            ctx.fill();
            // Bottom crowd
            ctx.beginPath();
            ctx.arc(cx, h - 8, 5 + Math.cos(i * 1.1) * 2, 0, Math.PI * 2);
            ctx.fill();
        }
        for (let i = 0; i < 15; i++) {
            const cy = (h / 15) * i + (h / 30);
            ctx.beginPath();
            ctx.arc(8, cy, 4 + Math.sin(i * 1.5) * 2, 0, Math.PI * 2);
            ctx.fill();
            ctx.beginPath();
            ctx.arc(w - 8, cy, 4 + Math.cos(i * 1.2) * 2, 0, Math.PI * 2);
            ctx.fill();
        }

        if (!state || !state.agents) { ctx.restore(); return; }

        const agents = state.agents;
        const agentIds = Object.keys(agents);

        // ── Particles ──
        state.particles?.forEach(p => {
            ctx.beginPath();
            const alpha = Math.min(1, p.life);
            if (p.type === 'afterimage') {
                ctx.arc(p.x, p.y, p.size * alpha, 0, Math.PI * 2);
                ctx.fillStyle = p.color + Math.round(alpha * 60).toString(16).padStart(2, '0');
                ctx.fill();
            } else if (p.type === 'fire') {
                ctx.arc(p.x, p.y, p.size * alpha, 0, Math.PI * 2);
                ctx.fillStyle = p.color + Math.round(alpha * 200).toString(16).padStart(2, '0');
                ctx.shadowColor = '#FF6B35';
                ctx.shadowBlur = 8;
                ctx.fill();
                ctx.shadowBlur = 0;
            } else if (p.type === 'heal') {
                ctx.font = `${10 + p.size}px sans-serif`;
                ctx.textAlign = 'center';
                ctx.fillStyle = p.color + Math.round(alpha * 200).toString(16).padStart(2, '0');
                ctx.fillText('+', p.x, p.y);
            } else if (p.type === 'special' || p.type === 'ko') {
                ctx.arc(p.x, p.y, p.size * alpha, 0, Math.PI * 2);
                ctx.fillStyle = p.color + Math.round(alpha * 255).toString(16).padStart(2, '0');
                ctx.shadowColor = p.color;
                ctx.shadowBlur = 12;
                ctx.fill();
                ctx.shadowBlur = 0;
            } else {
                ctx.arc(p.x, p.y, p.size * alpha, 0, Math.PI * 2);
                ctx.fillStyle = p.color + Math.round(alpha * 255).toString(16).padStart(2, '0');
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
                ctx.strokeStyle = `${a.color}44`;
                ctx.lineWidth = 2;
                ctx.setLineDash([4, 4]);
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
                ctx.arc(a.x, a.y, 42, 0, Math.PI * 2);
                ctx.strokeStyle = '#FF6B3566';
                ctx.lineWidth = 3;
                ctx.shadowColor = '#FF6B35';
                ctx.shadowBlur = 15;
                ctx.stroke();
                ctx.shadowBlur = 0;
            }

            if (a.isSlowed) {
                ctx.beginPath();
                ctx.arc(a.x, a.y, 44, 0, Math.PI * 2);
                ctx.strokeStyle = '#69D2E744';
                ctx.lineWidth = 3;
                ctx.setLineDash([5, 5]);
                ctx.stroke();
                ctx.setLineDash([]);
            }

            if (a.isDefending) {
                // Shield visual
                const shieldAngle = Math.atan2(
                    agents[agentIds.find(k => k !== id)]?.y - a.y || 0,
                    agents[agentIds.find(k => k !== id)]?.x - a.x || 0
                );
                ctx.beginPath();
                ctx.arc(a.x, a.y, 36, shieldAngle - 0.8, shieldAngle + 0.8);
                ctx.strokeStyle = '#836EF9';
                ctx.lineWidth = 5;
                ctx.shadowColor = '#836EF9';
                ctx.shadowBlur = 12;
                ctx.stroke();
                ctx.shadowBlur = 0;
            }

            // Dodge transparency
            const agentAlpha = a.isDodging ? 0.3 : 1;

            // Glow ring
            ctx.beginPath();
            ctx.arc(a.x, a.y, 38, 0, Math.PI * 2);
            ctx.fillStyle = `${a.color}${Math.round(agentAlpha * 21).toString(16).padStart(2, '0')}`;
            ctx.fill();

            // Agent body
            ctx.globalAlpha = agentAlpha;
            const bodyGrad = ctx.createRadialGradient(a.x - 5, a.y - 5, 0, a.x, a.y, 28);
            bodyGrad.addColorStop(0, a.color);
            bodyGrad.addColorStop(1, `${a.color}88`);
            ctx.beginPath();
            ctx.arc(a.x, a.y, 28, 0, Math.PI * 2);
            ctx.fillStyle = bodyGrad;
            ctx.fill();

            // Border
            ctx.beginPath();
            ctx.arc(a.x, a.y, 28, 0, Math.PI * 2);
            ctx.strokeStyle = a.color;
            ctx.lineWidth = 2.5;
            ctx.shadowColor = a.color;
            ctx.shadowBlur = a.isAttacking ? 25 : (a.specialReady ? 15 : 8);
            ctx.stroke();
            ctx.shadowBlur = 0;

            // Stun stars
            if (a.isStunned) {
                const t = state.gameTime / 300;
                for (let s = 0; s < 3; s++) {
                    const sx = a.x + Math.cos(t + s * 2.1) * 22;
                    const sy = a.y - 30 + Math.sin(t + s * 2.1) * 8;
                    ctx.font = '10px sans-serif';
                    ctx.textAlign = 'center';
                    ctx.fillText('⭐', sx, sy);
                }
            }

            // Agent emoji
            ctx.font = '22px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(agentData?.avatar || '⚔️', a.x, a.y + 1);
            ctx.globalAlpha = 1;

            // ── Weapon (type-specific shapes) ──
            if (a.weaponX && a.weaponY) {
                ctx.save();
                ctx.translate(a.weaponX, a.weaponY);
                ctx.rotate(a.weaponAngle || 0);
                ctx.globalAlpha = agentAlpha;

                if (a.isAttacking) {
                    ctx.shadowColor = a.color;
                    ctx.shadowBlur = 20;
                }

                const wType = agentData?.weapon?.id || 'blade';

                switch (wType) {
                    case 'blade': {
                        // ── Katana / Sword ──
                        const bg = ctx.createLinearGradient(-28, 0, 30, 0);
                        bg.addColorStop(0, '#666');
                        bg.addColorStop(0.3, '#ccc');
                        bg.addColorStop(0.7, '#eee');
                        bg.addColorStop(1, a.color);
                        ctx.fillStyle = bg;
                        // Blade body — tapered
                        ctx.beginPath();
                        ctx.moveTo(-28, -2);
                        ctx.lineTo(26, -4);
                        ctx.lineTo(38, 0);
                        ctx.lineTo(26, 4);
                        ctx.lineTo(-28, 2);
                        ctx.closePath();
                        ctx.fill();
                        // Guard
                        ctx.fillStyle = '#A08040';
                        ctx.fillRect(-30, -6, 4, 12);
                        // Handle wrap
                        ctx.fillStyle = '#553322';
                        ctx.fillRect(-40, -3, 12, 6);
                        for (let i = 0; i < 3; i++) {
                            ctx.fillStyle = '#77553388';
                            ctx.fillRect(-39 + i * 4, -3, 2, 6);
                        }
                        break;
                    }

                    case 'mace': {
                        // ── Thunder Mace — shaft + spiked ball ──
                        ctx.fillStyle = '#8B7355';
                        ctx.fillRect(-30, -3, 40, 6);
                        // Chain links
                        ctx.strokeStyle = '#888';
                        ctx.lineWidth = 2;
                        for (let i = 0; i < 3; i++) {
                            ctx.beginPath();
                            ctx.arc(12 + i * 6, 0, 3, 0, Math.PI * 2);
                            ctx.stroke();
                        }
                        // Spiked ball head
                        ctx.beginPath();
                        ctx.arc(32, 0, 10, 0, Math.PI * 2);
                        const mg = ctx.createRadialGradient(30, -2, 0, 32, 0, 10);
                        mg.addColorStop(0, '#ddd');
                        mg.addColorStop(1, a.color);
                        ctx.fillStyle = mg;
                        ctx.fill();
                        // Spikes
                        ctx.fillStyle = a.color;
                        for (let i = 0; i < 6; i++) {
                            const sa = (Math.PI * 2 / 6) * i;
                            ctx.beginPath();
                            ctx.moveTo(32 + Math.cos(sa) * 8, Math.sin(sa) * 8);
                            ctx.lineTo(32 + Math.cos(sa) * 14, Math.sin(sa) * 14);
                            ctx.lineTo(32 + Math.cos(sa + 0.3) * 8, Math.sin(sa + 0.3) * 8);
                            ctx.closePath();
                            ctx.fill();
                        }
                        break;
                    }

                    case 'scythe': {
                        // ── Void Scythe / Orak ──
                        // Staff
                        ctx.fillStyle = '#5C4033';
                        ctx.fillRect(-35, -2.5, 55, 5);
                        // Curved blade (sickle/orak shape)
                        ctx.beginPath();
                        ctx.moveTo(18, -3);
                        ctx.quadraticCurveTo(40, -20, 35, -35);
                        ctx.quadraticCurveTo(32, -30, 28, -22);
                        ctx.quadraticCurveTo(24, -12, 18, -3);
                        ctx.closePath();
                        const sg = ctx.createLinearGradient(18, 0, 35, -35);
                        sg.addColorStop(0, '#aaa');
                        sg.addColorStop(1, a.color);
                        ctx.fillStyle = sg;
                        ctx.fill();
                        // Inner blade edge (highlight)
                        ctx.beginPath();
                        ctx.moveTo(20, -5);
                        ctx.quadraticCurveTo(38, -18, 34, -32);
                        ctx.strokeStyle = '#ffffff44';
                        ctx.lineWidth = 1;
                        ctx.stroke();
                        break;
                    }

                    case 'whip': {
                        // ── Inferno Whip / Halat+Kırbaç ──
                        // Handle
                        ctx.fillStyle = '#6B3A2A';
                        ctx.fillRect(-32, -3, 18, 6);
                        ctx.fillStyle = '#A08040';
                        ctx.fillRect(-14, -2, 4, 4);
                        // Whip segments — wavy rope
                        ctx.beginPath();
                        ctx.moveTo(-10, 0);
                        const t = (state?.gameTime || 0) / 200;
                        for (let i = 0; i <= 8; i++) {
                            const px = -10 + i * 6;
                            const py = Math.sin(t + i * 0.8) * (3 + i * 0.7);
                            if (i === 0) ctx.moveTo(px, py);
                            else ctx.lineTo(px, py);
                        }
                        ctx.strokeStyle = a.color;
                        ctx.lineWidth = 3;
                        ctx.lineCap = 'round';
                        ctx.stroke();
                        // Tip / knot
                        ctx.beginPath();
                        ctx.arc(38, Math.sin(t + 6.4) * 8, 4, 0, Math.PI * 2);
                        ctx.fillStyle = a.color;
                        ctx.fill();
                        // Rope texture dots
                        for (let i = 1; i < 8; i++) {
                            const px = -10 + i * 6;
                            const py = Math.sin(t + i * 0.8) * (3 + i * 0.7);
                            ctx.beginPath();
                            ctx.arc(px, py, 1.5, 0, Math.PI * 2);
                            ctx.fillStyle = '#ffffff33';
                            ctx.fill();
                        }
                        break;
                    }

                    case 'lance': {
                        // ── Crystal Lance / Mızrak ──
                        // Long shaft
                        const lg = ctx.createLinearGradient(-35, 0, 20, 0);
                        lg.addColorStop(0, '#5C4033');
                        lg.addColorStop(1, '#8B7355');
                        ctx.fillStyle = lg;
                        ctx.fillRect(-35, -2.5, 55, 5);
                        // Crystal diamond tip
                        ctx.beginPath();
                        ctx.moveTo(20, -7);
                        ctx.lineTo(42, 0);
                        ctx.lineTo(20, 7);
                        ctx.lineTo(24, 0);
                        ctx.closePath();
                        const ltg = ctx.createLinearGradient(20, 0, 42, 0);
                        ltg.addColorStop(0, '#88ccff');
                        ltg.addColorStop(0.5, '#ffffff');
                        ltg.addColorStop(1, a.color);
                        ctx.fillStyle = ltg;
                        ctx.fill();
                        // Crystal sparkle
                        ctx.fillStyle = '#ffffff88';
                        ctx.beginPath();
                        ctx.arc(32, -2, 1.5, 0, Math.PI * 2);
                        ctx.fill();
                        // Hand guard
                        ctx.fillStyle = '#A08040';
                        ctx.beginPath();
                        ctx.ellipse(-8, 0, 2, 6, 0, 0, Math.PI * 2);
                        ctx.fill();
                        break;
                    }

                    case 'hammer': {
                        // ── Storm Hammer / Çekiç ──
                        // Handle
                        ctx.fillStyle = '#6B4226';
                        ctx.fillRect(-30, -2.5, 42, 5);
                        // Hammer head (wide rectangle)
                        const hg = ctx.createLinearGradient(10, -12, 10, 12);
                        hg.addColorStop(0, '#bbb');
                        hg.addColorStop(0.5, a.color);
                        hg.addColorStop(1, '#888');
                        ctx.fillStyle = hg;
                        ctx.fillRect(10, -12, 22, 24);
                        // Flat striking face
                        ctx.fillStyle = '#ddd';
                        ctx.fillRect(30, -10, 4, 20);
                        // Rivets
                        ctx.fillStyle = '#FFE93E88';
                        ctx.beginPath(); ctx.arc(16, -6, 2, 0, Math.PI * 2); ctx.fill();
                        ctx.beginPath(); ctx.arc(16, 6, 2, 0, Math.PI * 2); ctx.fill();
                        ctx.beginPath(); ctx.arc(26, 0, 2, 0, Math.PI * 2); ctx.fill();
                        break;
                    }

                    case 'axe': {
                        // ── Shadow Axe / Balta ──
                        // Handle
                        ctx.fillStyle = '#5C4033';
                        ctx.fillRect(-32, -2.5, 48, 5);
                        // Axe blade — curved crescent
                        ctx.beginPath();
                        ctx.moveTo(14, -5);
                        ctx.quadraticCurveTo(30, -18, 20, -22);
                        ctx.lineTo(10, -12);
                        ctx.closePath();
                        const axg = ctx.createLinearGradient(10, 0, 30, -22);
                        axg.addColorStop(0, '#aaa');
                        axg.addColorStop(1, a.color);
                        ctx.fillStyle = axg;
                        ctx.fill();
                        // Mirror blade (double-sided balta)
                        ctx.beginPath();
                        ctx.moveTo(14, 5);
                        ctx.quadraticCurveTo(30, 18, 20, 22);
                        ctx.lineTo(10, 12);
                        ctx.closePath();
                        const axg2 = ctx.createLinearGradient(10, 0, 30, 22);
                        axg2.addColorStop(0, '#aaa');
                        axg2.addColorStop(1, a.color);
                        ctx.fillStyle = axg2;
                        ctx.fill();
                        // Edge highlight
                        ctx.strokeStyle = '#ffffff44';
                        ctx.lineWidth = 1;
                        ctx.beginPath();
                        ctx.moveTo(15, -6);
                        ctx.quadraticCurveTo(28, -16, 19, -20);
                        ctx.stroke();
                        break;
                    }

                    case 'fist': {
                        // ── Iron Fist / Yumruk / Muşta ──
                        // Knuckle duster base
                        ctx.beginPath();
                        ctx.arc(0, 0, 12, 0, Math.PI * 2);
                        const fg = ctx.createRadialGradient(-2, -2, 0, 0, 0, 12);
                        fg.addColorStop(0, '#ccc');
                        fg.addColorStop(0.6, '#888');
                        fg.addColorStop(1, a.color);
                        ctx.fillStyle = fg;
                        ctx.fill();
                        // Finger guard bumps
                        for (let i = 0; i < 4; i++) {
                            const bx = -6 + i * 4;
                            ctx.beginPath();
                            ctx.arc(bx, -11, 3, 0, Math.PI * 2);
                            ctx.fillStyle = '#aaa';
                            ctx.fill();
                            ctx.strokeStyle = a.color + '88';
                            ctx.lineWidth = 1;
                            ctx.stroke();
                        }
                        // Spike/stud
                        ctx.fillStyle = a.color;
                        ctx.beginPath();
                        ctx.moveTo(0, -14);
                        ctx.lineTo(3, -18);
                        ctx.lineTo(-3, -18);
                        ctx.closePath();
                        ctx.fill();
                        break;
                    }

                    default: {
                        // ── Fallback — generic blade ──
                        const dfg = ctx.createLinearGradient(-25, 0, 25, 0);
                        dfg.addColorStop(0, '#888');
                        dfg.addColorStop(0.5, '#ddd');
                        dfg.addColorStop(1, a.color);
                        ctx.fillStyle = dfg;
                        ctx.fillRect(-25, -3, 50, 6);
                        ctx.fillStyle = a.color;
                        ctx.beginPath();
                        ctx.moveTo(25, -8);
                        ctx.lineTo(38, 0);
                        ctx.lineTo(25, 8);
                        ctx.closePath();
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
            ctx.fillText(agentData?.name || `Agent ${id}`, a.x, a.y - 45);

            // ── Mini HP bar ──
            const hpBarW = 54;
            const hpBarH = 5;
            const hpX = a.x - hpBarW / 2;
            const hpY = a.y - 38;
            const hpPct = a.hp / a.maxHp;

            ctx.fillStyle = '#1a1a2588';
            ctx.fillRect(hpX - 1, hpY - 1, hpBarW + 2, hpBarH + 2);
            const hpColor = hpPct > 0.5 ? '#39FF14' : hpPct > 0.25 ? '#FFE93E' : '#FF3131';
            const hpGrad = ctx.createLinearGradient(hpX, 0, hpX + hpBarW * hpPct, 0);
            hpGrad.addColorStop(0, hpColor);
            hpGrad.addColorStop(1, hpColor + '88');
            ctx.fillStyle = hpGrad;
            ctx.fillRect(hpX, hpY, hpBarW * hpPct, hpBarH);

            // ── Special meter bar (thin, below HP) ──
            if (a.specialMeter > 0) {
                const spY = hpY + hpBarH + 2;
                const spPct = a.specialMeter / 100;
                ctx.fillStyle = '#1a1a2566';
                ctx.fillRect(hpX, spY, hpBarW, 2);
                ctx.fillStyle = a.specialReady ? '#FFE93E' : '#836EF9';
                if (a.specialReady) {
                    ctx.shadowColor = '#FFE93E';
                    ctx.shadowBlur = 6;
                }
                ctx.fillRect(hpX, spY, hpBarW * spPct, 2);
                ctx.shadowBlur = 0;
            }
        });

        // ── Hit Effects ──
        state.hitEffects?.forEach(h => {
            const elapsed = state.gameTime - h.time;
            const progress = elapsed / 1200;
            if (progress > 1) return;

            const textSize = h.isCrit ? 24 : (h.isCombo ? 20 : 16);
            ctx.font = `800 ${textSize + progress * 6}px "Orbitron", sans-serif`;
            ctx.textAlign = 'center';
            const alpha = Math.round((1 - progress) * 255).toString(16).padStart(2, '0');
            ctx.fillStyle = (h.isCrit ? '#FFE93E' : h.color) + alpha;
            if (h.isCrit) {
                ctx.shadowColor = '#FFE93E';
                ctx.shadowBlur = 12;
            }
            ctx.fillText(`-${h.damage}`, h.x, h.y - 50 - progress * 40);
            ctx.shadowBlur = 0;

            // Impact ring
            ctx.beginPath();
            ctx.arc(h.x, h.y, (h.isCrit ? 15 : 10) + progress * (h.isCrit ? 60 : 40), 0, Math.PI * 2);
            ctx.strokeStyle = h.color + Math.round((1 - progress) * 80).toString(16).padStart(2, '0');
            ctx.lineWidth = (h.isCrit ? 3 : 2) * (1 - progress);
            ctx.stroke();
        });

        // ── Combo / Special / Status Text ──
        state.comboEffects?.forEach(c => {
            const elapsed = state.gameTime - c.time;
            const progress = elapsed / 1500;
            if (progress > 1) return;

            const alpha = Math.round((1 - progress) * 255).toString(16).padStart(2, '0');
            ctx.font = `800 ${c.size}px "Orbitron", sans-serif`;
            ctx.textAlign = 'center';
            ctx.fillStyle = c.color + alpha;
            ctx.shadowColor = c.color;
            ctx.shadowBlur = 10;
            ctx.fillText(c.text, c.x, c.y - progress * 30);
            ctx.shadowBlur = 0;
        });

        // ── Round/Timer HUD ──
        if (state.roundTimer !== undefined) {
            ctx.font = '700 12px "Orbitron", sans-serif';
            ctx.textAlign = 'center';
            ctx.fillStyle = 'rgba(131, 110, 249, 0.8)';
            ctx.fillText(`ROUND ${state.currentRound}/${state.maxRounds}`, w / 2, 42);

            const minutes = Math.floor(state.roundTimer / 60);
            const seconds = state.roundTimer % 60;
            const timerText = `${minutes}:${String(seconds).padStart(2, '0')}`;
            const timerColor = state.roundTimer <= 10 ? '#FF3131' : state.roundTimer <= 30 ? '#FFE93E' : '#ffffff';

            ctx.font = '700 22px "Orbitron", sans-serif';
            ctx.fillStyle = timerColor;
            if (state.roundTimer <= 10) {
                ctx.shadowColor = '#FF3131';
                ctx.shadowBlur = 10;
            }
            ctx.fillText(timerText, w / 2, 65);
            ctx.shadowBlur = 0;
        }

        // ── Match End Overlay — Boxing Style ──
        if (state.isFinished && state.winner) {
            // Dark overlay with vignette
            ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
            ctx.fillRect(0, 0, w, h);

            const winnerIdx = state.winner === '1' ? 0 : 1;
            const winnerData = winnerIdx === 0 ? a1 : a2;
            const winnerAgent = agents[state.winner];
            const loserAgent = agents[state.winner === '1' ? '2' : '1'];
            const wColor = winnerAgent?.color || '#836EF9';

            // Pulsing spotlight on winner
            const pulse = Math.sin(state.gameTime / 300) * 0.3 + 0.7;
            const spotR = Math.min(w, h) * 0.35 * pulse;

            // Spotlight cone
            const spotGrad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, spotR);
            spotGrad.addColorStop(0, `${wColor}35`);
            spotGrad.addColorStop(0.5, `${wColor}15`);
            spotGrad.addColorStop(1, 'transparent');
            ctx.fillStyle = spotGrad;
            ctx.fillRect(0, 0, w, h);

            // Confetti / sparkle particles
            const sparkleCount = 20;
            for (let i = 0; i < sparkleCount; i++) {
                const sx = (w * 0.2) + (w * 0.6) * ((Math.sin(state.gameTime / 500 + i * 7.3) + 1) / 2);
                const sy = (h * 0.1) + (h * 0.8) * ((Math.cos(state.gameTime / 400 + i * 5.1) + 1) / 2);
                const sSize = 2 + Math.sin(state.gameTime / 200 + i) * 1.5;
                const sAlpha = 0.3 + Math.sin(state.gameTime / 300 + i * 2) * 0.3;
                const colors = ['#FFE93E', '#FF2D78', '#00F5FF', '#836EF9', '#39FF14'];
                ctx.beginPath();
                ctx.arc(sx, sy, sSize, 0, Math.PI * 2);
                ctx.fillStyle = colors[i % colors.length] + Math.round(sAlpha * 255).toString(16).padStart(2, '0');
                ctx.fill();
            }

            // KO reason tag — boxing style
            const isKO = state.finishReason === 'ko';
            const reasonText = isKO ? 'K.O.' : state.finishReason === 'decision' ? 'DECISION' : 'TIME';

            // Big dramatic KO/DECISION text
            if (isKO) {
                const koScale = Math.min(1, (state.gameTime - (state.finishTime || state.gameTime)) / 500 + 0.5);
                ctx.font = `900 ${Math.floor(60 * koScale)}px "Orbitron", sans-serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillStyle = '#FF2D78';
                ctx.shadowColor = '#FF2D78';
                ctx.shadowBlur = 30;
                ctx.fillText('K.O.', w / 2, h / 2 - 60);
                ctx.shadowBlur = 0;
            } else {
                ctx.font = '700 20px "Orbitron", sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
                ctx.fillText(reasonText, w / 2, h / 2 - 70);
            }

            // Winner belt icon
            ctx.font = '40px sans-serif';
            ctx.fillText('🥊', w / 2, h / 2 - (isKO ? 15 : 30));

            // Winner name
            ctx.font = '700 24px "Orbitron", sans-serif';
            ctx.fillStyle = wColor;
            ctx.shadowColor = wColor;
            ctx.shadowBlur = 20;
            ctx.fillText(winnerData?.name || `Agent ${state.winner}`, w / 2, h / 2 + (isKO ? 20 : 10));
            ctx.shadowBlur = 0;

            // "WINS BY [REASON]" subtitle
            ctx.font = '600 14px "Orbitron", sans-serif';
            ctx.fillStyle = '#FFE93E';
            const reasonMap = { ko: 'WINS BY KNOCKOUT!', decision: 'WINS BY DECISION!', timeout: 'WINS BY TIME!' };
            ctx.fillText(reasonMap[state.finishReason] || 'WINS THE MATCH!', w / 2, h / 2 + (isKO ? 48 : 38));

            // Fight stats card
            if (winnerAgent && loserAgent) {
                const cardY = h / 2 + (isKO ? 70 : 60);
                const cardW = Math.min(w * 0.7, 360);
                const cardX = (w - cardW) / 2;

                // Card background (roundRect fallback for older browsers)
                ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
                ctx.strokeStyle = 'rgba(131, 110, 249, 0.2)';
                ctx.lineWidth = 1;
                const cr = 8;
                ctx.beginPath();
                if (ctx.roundRect) {
                    ctx.roundRect(cardX, cardY, cardW, 50, cr);
                } else {
                    // Fallback: manual rounded rect
                    ctx.moveTo(cardX + cr, cardY);
                    ctx.lineTo(cardX + cardW - cr, cardY);
                    ctx.arcTo(cardX + cardW, cardY, cardX + cardW, cardY + cr, cr);
                    ctx.lineTo(cardX + cardW, cardY + 50 - cr);
                    ctx.arcTo(cardX + cardW, cardY + 50, cardX + cardW - cr, cardY + 50, cr);
                    ctx.lineTo(cardX + cr, cardY + 50);
                    ctx.arcTo(cardX, cardY + 50, cardX, cardY + 50 - cr, cr);
                    ctx.lineTo(cardX, cardY + cr);
                    ctx.arcTo(cardX, cardY, cardX + cr, cardY, cr);
                    ctx.closePath();
                }
                ctx.fill();
                ctx.stroke();

                ctx.font = '600 11px "Inter", sans-serif';
                ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
                ctx.textAlign = 'center';
                ctx.fillText(
                    `🥊 Hits: ${winnerAgent.hitsLanded || 0}  ⚡ Crits: ${winnerAgent.critHits || 0}  🔥 Max Combo: ${winnerAgent.maxCombo || 0}x`,
                    w / 2, cardY + 20
                );
                ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
                ctx.fillText(
                    `${a1?.name}: ${Math.round(agents['1']?.hp || 0)} HP  ·  ${a2?.name}: ${Math.round(agents['2']?.hp || 0)} HP`,
                    w / 2, cardY + 38
                );
            }
        }

        ctx.restore(); // End screen shake
    }, []);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        const parent = canvas.parentElement;
        let running = true;
        let initFrame = null;
        let resizeObserver = null;

        // ── Responsive sizing function ──
        const sizeRef = { w: 0, h: 0 };

        const resizeCanvas = () => {
            if (!parent) return;

            // Use multiple measurement methods for robustness
            let w = parent.clientWidth || parent.offsetWidth || 0;
            let h = parent.clientHeight || parent.offsetHeight || 0;

            // Fallback to getBoundingClientRect
            if (w <= 0 || h <= 0) {
                const rect = parent.getBoundingClientRect();
                w = Math.floor(rect.width) || w;
                h = Math.floor(rect.height) || h;
            }

            if (w <= 0 || h <= 0) return; // Still no dimensions, skip
            h = Math.max(h, 200);

            if (w === sizeRef.w && h === sizeRef.h) return;
            sizeRef.w = w;
            sizeRef.h = h;

            // Set pixel buffer (high-DPI support)
            const dpr = window.devicePixelRatio || 1;
            canvas.width = w * dpr;
            canvas.height = h * dpr;
            // CSS sizing is handled by the stylesheet (position: absolute, 100% x 100%)
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

            if (engineRef.current) {
                engineRef.current.width = w;
                engineRef.current.height = h;
            }

            console.log(`[GameCanvas] Resized: ${w}x${h} (pixel: ${canvas.width}x${canvas.height}, dpr: ${dpr})`);
        };

        // ── Deferred initialization — wait for DOM layout ──
        const initialize = () => {
            resizeCanvas();

            // If parent STILL has no size, wait more
            if (sizeRef.w <= 0 || sizeRef.h <= 0) {
                if (running) initFrame = requestAnimationFrame(initialize);
                return;
            }

            const w = sizeRef.w;
            const h = sizeRef.h;

            console.log(`[GameCanvas] Initialized — canvas: ${w}x${h}, dpr: ${window.devicePixelRatio}, pixel: ${canvas.width}x${canvas.height}`);

            const a1 = agent1Ref.current;
            const a2 = agent2Ref.current;
            const engine = new GameEngine(w, h);
            engineRef.current = engine;

            engine.addAgent('1', w * 0.25, h * 0.5, a1?.color || '#FF2D78', agent1Equipment || null);
            engine.addAgent('2', w * 0.75, h * 0.5, a2?.color || '#00F5FF', agent2Equipment || null);

            let matchEnded = false;
            let lastTickNotify = 0;
            let lastSoundTime = 0;

            // ── Sound-integrated callbacks ──
            engine.onHit = (attackerId, targetId, damage, remainingHP, extra) => {
                const now = performance.now();
                if (now - lastSoundTime > 100) {
                    lastSoundTime = now;
                    if (extra?.isCrit) {
                        playSound('heavyPunch');
                    } else if (extra?.isCombo) {
                        playSound('combo');
                    } else if (extra?.blocked) {
                        playSound('block');
                    } else if (extra?.dodged) {
                        playSound('dodge');
                    } else {
                        playSound('punch');
                    }
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
                if (result.reason === 'ko') {
                    playSound('ko');
                } else {
                    playSound('cheer');
                }
                if (onStateUpdateRef.current) {
                    onStateUpdateRef.current({ type: 'match_end', ...result, agents: engine.getState().agents });
                }
                if (onMatchEndRef.current) {
                    onMatchEndRef.current(result);
                }
            };

            engine.onRoundEnd = (roundInfo) => {
                playSound('round');
                if (onStateUpdateRef.current) {
                    onStateUpdateRef.current({ type: 'round_end', ...roundInfo });
                }
            };

            engine.start();

            try { playSound('bell'); } catch (e) { /* ignore */ }
            setTimeout(() => { try { playSound('crowdMurmur'); } catch (e) { /* ignore */ } }, 1500);

            // ── ResizeObserver ──
            resizeObserver = new ResizeObserver(() => resizeCanvas());
            resizeObserver.observe(parent);

            // ── Animation loop ──
            let loopErrorCount = 0;
            const loop = () => {
                if (!running) return;
                try {
                    engine.update(16.67);
                    const state = engine.getState();
                    const cw = sizeRef.w;
                    const ch = sizeRef.h;

                    if (cw > 0 && ch > 0) {
                        draw(ctx, state, cw, ch);
                    }

                    const now = performance.now();
                    if (!state.isFinished && now - lastTickNotify > 200) {
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
                    if (loopErrorCount <= 3) {
                        console.error('[GameCanvas] Draw loop error:', err);
                    }
                }
                animFrameRef.current = requestAnimationFrame(loop);
            };

            animFrameRef.current = requestAnimationFrame(loop);
        };

        // Start initialization on next animation frame (ensures DOM is laid out)
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
