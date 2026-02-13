// ═══════════════════════════════════════════════════════════════
// AUDIO SYSTEM — Boxing Match Sound Effects
// Synthesized via Web Audio API (no external files needed)
// ═══════════════════════════════════════════════════════════════

let audioContext;
let masterGain;

const initAudio = () => {
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        masterGain = audioContext.createGain();
        masterGain.gain.value = 0.3;
        masterGain.connect(audioContext.destination);
    }
    if (audioContext.state === 'suspended') {
        audioContext.resume().catch(() => {});
    }
    return audioContext;
};

// ── Low-level tone generator ──
const playTone = (freq, type = 'sine', duration = 0.5, volume = 0.15, delay = 0) => {
    try {
        const ctx = initAudio();
        const t = ctx.currentTime + delay;

        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, t);

        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(volume, t + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.001, t + duration);

        osc.connect(gain);
        gain.connect(masterGain);
        osc.start(t);
        osc.stop(t + duration);
    } catch (e) { /* ignore */ }
};

// ── Noise generator (for crowd, impacts) ──
const playNoise = (duration = 0.3, volume = 0.08, filterFreq = 1000, delay = 0) => {
    try {
        const ctx = initAudio();
        const t = ctx.currentTime + delay;
        const bufferSize = ctx.sampleRate * duration;
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = (Math.random() * 2 - 1);
        }

        const source = ctx.createBufferSource();
        source.buffer = buffer;

        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(filterFreq, t);

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(volume, t + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.001, t + duration);

        source.connect(filter);
        filter.connect(gain);
        gain.connect(masterGain);
        source.start(t);
        source.stop(t + duration);
    } catch (e) { /* ignore */ }
};

// ═══ BOXING SOUND EFFECTS ═══

export const playSound = (type) => {
    switch (type) {

        // ── Boxing Bell (Round start/end) ──
        case 'bell': {
            // Classic boxing ring bell — metallic ding-ding-ding
            playTone(1200, 'sine', 0.8, 0.2);
            playTone(1500, 'sine', 0.6, 0.12, 0.05);
            playTone(800, 'triangle', 0.5, 0.08, 0.02);
            // Second hit
            setTimeout(() => {
                playTone(1200, 'sine', 0.7, 0.18);
                playTone(1500, 'sine', 0.5, 0.1, 0.05);
            }, 250);
            // Third hit
            setTimeout(() => {
                playTone(1200, 'sine', 1.2, 0.22);
                playTone(1500, 'sine', 0.8, 0.12, 0.05);
                playTone(600, 'sine', 1.0, 0.04, 0.1);
            }, 500);
            break;
        }

        // ── Punch Impact ──
        case 'punch': {
            // Low thud + slap
            playNoise(0.12, 0.15, 600);
            playTone(120, 'sine', 0.15, 0.2);
            playTone(80, 'square', 0.08, 0.1, 0.02);
            break;
        }

        // ── Heavy Punch / Critical Hit ──
        case 'heavyPunch': {
            // Deep bass thud + crack
            playNoise(0.2, 0.2, 400);
            playTone(80, 'sine', 0.25, 0.25);
            playTone(60, 'square', 0.1, 0.15, 0.02);
            playNoise(0.08, 0.12, 3000, 0.05); // crack
            break;
        }

        // ── Crowd Roar (Match end celebration) ──
        case 'cheer': {
            // Layered noise simulating crowd roar
            playNoise(0.8, 0.06, 800);
            playNoise(1.2, 0.05, 600, 0.1);
            playNoise(1.5, 0.04, 400, 0.3);
            // Victory horns
            playTone(440, 'sawtooth', 0.3, 0.06, 0.2);
            playTone(554, 'sawtooth', 0.3, 0.06, 0.35);
            playTone(659, 'sawtooth', 0.5, 0.08, 0.5);
            break;
        }

        // ── Round End ──
        case 'round': {
            // Single bell hit + brief crowd murmur
            playTone(1200, 'sine', 1.0, 0.2);
            playTone(1500, 'sine', 0.7, 0.1, 0.05);
            playNoise(0.5, 0.03, 500, 0.2);
            break;
        }

        // ── Combo Hit ──
        case 'combo': {
            // Quick successive hits
            playTone(200, 'square', 0.08, 0.12);
            playNoise(0.06, 0.1, 800);
            playTone(300, 'square', 0.08, 0.12, 0.08);
            playNoise(0.06, 0.1, 1000, 0.08);
            break;
        }

        // ── Block / Shield ──
        case 'block': {
            // Metallic clang
            playTone(400, 'triangle', 0.2, 0.12);
            playTone(800, 'triangle', 0.15, 0.08, 0.02);
            playNoise(0.05, 0.06, 2000);
            break;
        }

        // ── Dodge / Whoosh ──
        case 'dodge': {
            // Quick whoosh sound
            try {
                const ctx = initAudio();
                const t = ctx.currentTime;
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(300, t);
                osc.frequency.exponentialRampToValueAtTime(100, t + 0.15);
                gain.gain.setValueAtTime(0.08, t);
                gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
                osc.connect(gain);
                gain.connect(masterGain);
                osc.start(t);
                osc.stop(t + 0.15);
            } catch (e) { /* ignore */ }
            playNoise(0.1, 0.04, 1500);
            break;
        }

        // ── Special Move Charge ──
        case 'special': {
            // Rising power-up tone
            try {
                const ctx = initAudio();
                const t = ctx.currentTime;
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'sawtooth';
                osc.frequency.setValueAtTime(200, t);
                osc.frequency.exponentialRampToValueAtTime(800, t + 0.4);
                gain.gain.setValueAtTime(0.06, t);
                gain.gain.linearRampToValueAtTime(0.12, t + 0.3);
                gain.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
                osc.connect(gain);
                gain.connect(masterGain);
                osc.start(t);
                osc.stop(t + 0.5);
            } catch (e) { /* ignore */ }
            playNoise(0.3, 0.05, 2000, 0.3);
            break;
        }

        // ── KO / Knockout ──
        case 'ko': {
            // Massive impact + crowd explosion
            playNoise(0.3, 0.25, 300);
            playTone(60, 'sine', 0.4, 0.3);
            playTone(40, 'square', 0.2, 0.2, 0.05);
            // Crowd goes wild
            playNoise(1.5, 0.08, 700, 0.2);
            playNoise(2.0, 0.06, 500, 0.5);
            // Dramatic low rumble
            playTone(30, 'sine', 1.0, 0.1, 0.1);
            break;
        }

        // ── Countdown Tick ──
        case 'tick': {
            playTone(800, 'sine', 0.05, 0.08);
            break;
        }

        // ── Bet Placed ──
        case 'bet': {
            playTone(600, 'sine', 0.1, 0.1);
            playTone(800, 'sine', 0.15, 0.1, 0.08);
            break;
        }

        // ── Crowd Murmur (ambient) ──
        case 'crowdMurmur': {
            playNoise(2.0, 0.015, 400);
            playNoise(1.5, 0.01, 300, 0.5);
            break;
        }

        default:
            playTone(440, 'sine', 0.1, 0.05);
    }
};

// Volume control
export const setVolume = (vol) => {
    if (masterGain) {
        masterGain.gain.value = Math.max(0, Math.min(1, vol));
    }
};
