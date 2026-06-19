import { useEffect, useRef, useState } from "react";
import { TrophyIcon } from "./icons";
import { Flag } from "./Flag";
import type { Celebration } from "../lib/celebrations";
import "../styles/victory.css";

/* ============================================================
   VICTORY CELEBRATION — canvas particle system + WebAudio score
   Self-contained: no external assets. Plays a 5s timeline once.
   ============================================================ */

/* ---- Synthesised carnival soundtrack (whistle, crowd, samba, fireworks, fanfare) ---- */
function createVictoryAudio() {
  let actx: AudioContext | undefined;
  try { actx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)(); }
  catch { return { start() {}, resume() {}, stop() {} }; }

  // actx is defined past the try-catch (the catch returns early)
  const ctx = actx as AudioContext;

  const master = ctx.createGain();
  master.gain.value = 0.85;
  master.connect(ctx.destination);

  // shared noise buffer
  const nb = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const nd = nb.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  const noise = () => { const s = ctx.createBufferSource(); s.buffer = nb; s.loop = true; return s; };

  function whistle(t: number) {
    const o = ctx.createOscillator(); o.type = "sawtooth"; o.frequency.value = 3000;
    const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 3200; bp.Q.value = 7;
    const g = ctx.createGain(); g.gain.value = 0;
    const lfo = ctx.createOscillator(); lfo.type = "sine"; lfo.frequency.value = 30;
    const lg = ctx.createGain(); lg.gain.value = 190;
    lfo.connect(lg); lg.connect(o.frequency);
    o.connect(bp); bp.connect(g); g.connect(master);
    const pips: [number, number][] = [[t, 0.12], [t + 0.17, 0.12], [t + 0.34, 0.46]];
    pips.forEach(([pt, dur]) => {
      g.gain.setValueAtTime(0, pt);
      g.gain.linearRampToValueAtTime(0.46, pt + 0.012);
      g.gain.setValueAtTime(0.46, pt + dur - 0.04);
      g.gain.linearRampToValueAtTime(0, pt + dur);
    });
    o.start(t); lfo.start(t); o.stop(t + 1.0); lfo.stop(t + 1.0);
  }

  function crowd(t: number, dur: number) {
    const s = noise();
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 1100;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.05, t);
    g.gain.linearRampToValueAtTime(0.20, t + 0.7);
    g.gain.setValueAtTime(0.20, t + dur - 1.2);
    g.gain.linearRampToValueAtTime(0.05, t + dur);
    s.connect(lp); lp.connect(g); g.connect(master);
    s.start(t); s.stop(t + dur);
  }

  function kick(t: number) {
    const o = ctx.createOscillator(); o.type = "sine";
    const g = ctx.createGain();
    o.frequency.setValueAtTime(135, t); o.frequency.exponentialRampToValueAtTime(46, t + 0.11);
    g.gain.setValueAtTime(0.95, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.17);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.2);
  }
  function snare(t: number) {
    const s = noise();
    const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 1700;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.11);
    s.connect(hp); hp.connect(g); g.connect(master); s.start(t); s.stop(t + 0.13);
  }
  function agogo(t: number, freq: number) {
    const o = ctx.createOscillator(); o.type = "triangle"; o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.22, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.17);
  }
  function pop(t: number) {
    const s = noise();
    const bp = ctx.createBiquadFilter(); bp.type = "bandpass";
    bp.frequency.value = 900 + Math.random() * 1600; bp.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.55, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
    s.connect(bp); bp.connect(g); g.connect(master); s.start(t); s.stop(t + 0.3);
  }
  function fanfare(t: number) {
    const notes = [392, 494, 587, 784];
    notes.forEach((f, i) => {
      const st = t + i * 0.10;
      const o = ctx.createOscillator(); o.type = "sawtooth"; o.frequency.value = f;
      const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 2600;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, st); g.gain.linearRampToValueAtTime(0.16, st + 0.03);
      g.gain.setValueAtTime(0.16, st + 0.5); g.gain.exponentialRampToValueAtTime(0.001, st + 1.25);
      o.connect(lp); lp.connect(g); g.connect(master); o.start(st); o.stop(st + 1.3);
    });
  }

  let started = false;
  function start() {
    if (started) return; started = true;
    if (ctx.state === "suspended") ctx.resume();
    const t0 = ctx.currentTime + 0.04;
    whistle(t0);
    crowd(t0, 8.0);
    // samba groove 1.5s → 8s
    const step = 0.1375; let i = 0;
    for (let tt = 1.5; tt < 8.0; tt += step, i++) {
      const at = t0 + tt;
      if (i % 4 === 0 || i % 4 === 2) kick(at);
      if (i % 4 === 2) snare(at);
      if (i % 2 === 1) agogo(at, i % 4 === 1 ? 660 : 880);
    }
    // firework pops 1.6 → 7.5
    for (let tt = 1.6; tt < 7.6; tt += 0.28 + Math.random() * 0.22) pop(t0 + tt);
    fanfare(t0 + 2.95);
    fanfare(t0 + 5.3);
  }
  function resume() { if (ctx.state === "suspended") ctx.resume(); }
  function stop() {
    try {
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setValueAtTime(master.gain.value, ctx.currentTime);
      master.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.3);
      setTimeout(() => { try { ctx.close(); } catch { /* ignore */ } }, 420);
    } catch { /* ignore */ }
  }
  return { start, resume, stop };
}

/* ---- Particle visuals ---- */
const VC_COLORS = ["#009C3B", "#FFDF00", "#002776", "#FFD700", "#ffffff", "#36d27a"];

type Props = { celebration: Celebration; onDone: () => void };

export function VictoryCelebration({ celebration, onDone }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<ReturnType<typeof createVictoryAudio> | null>(null);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const [stage, setStage] = useState<"playing" | "fading">("playing");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rawCtx = canvas.getContext("2d");
    if (!rawCtx) return;
    // Assign to non-nullable consts so closures below don't need narrowing.
    const cv = canvas as HTMLCanvasElement;
    const ctx = rawCtx as CanvasRenderingContext2D;
    let raf: number, W = 0, H = 0;
    const DPR = Math.min(2, window.devicePixelRatio || 1);
    function resize() {
      W = cv.clientWidth; H = cv.clientHeight;
      cv.width = W * DPR; cv.height = H * DPR;
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    }
    resize();
    window.addEventListener("resize", resize);

    const confetti: {
      x: number; y: number; w: number; h: number;
      vx: number; vy: number; rot: number; vr: number;
      sway: number; phase: number; color: string;
    }[] = [];
    const sparks: {
      x: number; y: number; vx: number; vy: number;
      life: number; max: number; size: number; color: string;
    }[] = [];
    const gold: {
      x: number; y: number; vx: number; vy: number;
      life: number; max: number; size: number; tw: number;
    }[] = [];
    const rnd = (a: number, b: number) => a + Math.random() * (b - a);
    const pick = (arr: string[]) => arr[(Math.random() * arr.length) | 0];

    function spawnConfetti(n: number) {
      for (let k = 0; k < n && confetti.length < 460; k++) {
        confetti.push({
          x: rnd(0, W), y: rnd(-40, -8),
          w: rnd(6, 12), h: rnd(8, 16),
          vx: rnd(-0.6, 0.6), vy: rnd(1.6, 4.2),
          rot: rnd(0, Math.PI * 2), vr: rnd(-0.2, 0.2),
          sway: rnd(0.5, 1.6), phase: rnd(0, Math.PI * 2),
          color: pick(VC_COLORS),
        });
      }
    }
    function spawnFirework(x: number, y: number) {
      const base = pick(VC_COLORS), n = 26 + (Math.random() * 14 | 0);
      for (let i = 0; i < n; i++) {
        const ang = (i / n) * Math.PI * 2 + rnd(-0.1, 0.1);
        const sp = rnd(1.8, 4.4);
        sparks.push({
          x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
          life: 0, max: rnd(46, 78), size: rnd(1.4, 3),
          color: Math.random() < 0.5 ? "#FFD700" : base,
        });
      }
    }
    function spawnGold() {
      const edge = Math.random();
      let x, y;
      if (edge < 0.4) { x = rnd(0, W); y = H + 8; }
      else if (edge < 0.7) { x = -8; y = rnd(H * 0.2, H); }
      else { x = W + 8; y = rnd(H * 0.2, H); }
      gold.push({
        x, y, vx: rnd(-0.3, 0.3), vy: rnd(-1.3, -0.5),
        life: 0, max: rnd(90, 160), size: rnd(1, 2.6),
        tw: rnd(0, Math.PI * 2),
      });
    }

    function drawCrowd(t: number) {
      if (t < 1300) return;
      const a = Math.min(1, (t - 1300) / 500);
      ctx.save();
      ctx.globalAlpha = a;
      const baseY = H + 8;
      const gap = Math.max(34, W / 26);
      ctx.fillStyle = "#04130b";
      for (let i = 0, x = -gap; x < W + gap; x += gap, i++) {
        const jump = (Math.sin(t / 175 + i * 1.3) * 0.5 + 0.5) * 9;
        const r = 13 + (i % 3) * 3;
        const cx = x + (i % 2 ? gap * 0.3 : 0);
        const y = baseY - 24 - jump;
        ctx.beginPath(); ctx.ellipse(cx, y + r * 1.5, r * 0.95, r * 1.7, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(cx, y - r * 0.1, r * 0.58, 0, Math.PI * 2); ctx.fill();
        // raised arms
        ctx.save(); ctx.strokeStyle = "#04130b"; ctx.lineWidth = r * 0.34; ctx.lineCap = "round";
        const arm = Math.sin(t / 150 + i) * 0.5;
        ctx.beginPath();
        ctx.moveTo(cx - r * 0.5, y + r * 0.5); ctx.lineTo(cx - r * 1.1, y - r * (0.8 + arm));
        ctx.moveTo(cx + r * 0.5, y + r * 0.5); ctx.lineTo(cx + r * 1.1, y - r * (0.8 - arm));
        ctx.stroke(); ctx.restore();
        // waving flag every ~5th fan
        if (i % 5 === 2) {
          const fh = r * 2.4, poleX = cx + r * 1.1, poleTop = y - r * (1.6);
          ctx.save();
          ctx.strokeStyle = "#0a1a12"; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(poleX, y + r); ctx.lineTo(poleX, poleTop - fh); ctx.stroke();
          const wav = Math.sin(t / 130 + i) * 6;
          ctx.globalAlpha = a * 0.92;
          ctx.fillStyle = (i % 10 === 2) ? "#FFDF00" : "#009C3B";
          ctx.beginPath();
          ctx.moveTo(poleX, poleTop - fh);
          ctx.quadraticCurveTo(poleX + 14 + wav, poleTop - fh + 6, poleX + 26, poleTop - fh + 2 + wav * 0.4);
          ctx.lineTo(poleX + 24, poleTop - fh + 16);
          ctx.quadraticCurveTo(poleX + 12 + wav, poleTop - fh + 18, poleX, poleTop - fh + 22);
          ctx.closePath(); ctx.fill();
          ctx.restore();
        }
      }
      ctx.restore();
    }

    const startTs = performance.now();
    let lastFw = 0;
    audioRef.current = createVictoryAudio();
    audioRef.current.start();

    function frame(now: number) {
      const t = now - startTs;
      ctx.clearRect(0, 0, W, H);

      // confetti from top: burst 0.7s, sustained, thinning near the end
      if (t > 680 && t < 7300) spawnConfetti(t < 1500 ? 9 : 5);
      else if (t >= 7300 && t < 7900 && Math.random() < 0.4) spawnConfetti(2);

      // fireworks 1.5 → 7.5s
      if (t > 1500 && t < 7500 && now - lastFw > rnd(260, 430)) {
        lastFw = now;
        spawnFirework(rnd(W * 0.1, W * 0.9), rnd(H * 0.12, H * 0.5));
        if (Math.random() < 0.5) spawnFirework(rnd(W * 0.05, W * 0.95), rnd(H * 0.1, H * 0.4));
      }
      // gold edge sparkles 1.5s+
      if (t > 1500 && Math.random() < 0.6) spawnGold();

      drawCrowd(t);

      // confetti
      for (let i = confetti.length - 1; i >= 0; i--) {
        const p = confetti[i];
        p.phase += 0.08;
        p.x += p.vx + Math.sin(p.phase) * p.sway;
        p.y += p.vy; p.rot += p.vr;
        if (p.y > H + 30) { confetti.splice(i, 1); continue; }
        ctx.save();
        ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = 0.95;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * (0.6 + 0.4 * Math.abs(Math.cos(p.phase))));
        ctx.restore();
      }

      // fireworks sparks
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i];
        s.x += s.vx; s.y += s.vy; s.vy += 0.045; s.vx *= 0.985; s.life++;
        if (s.life > s.max) { sparks.splice(i, 1); continue; }
        const a = 1 - s.life / s.max;
        ctx.globalAlpha = a;
        ctx.fillStyle = s.color;
        ctx.shadowColor = s.color; ctx.shadowBlur = 8;
        ctx.beginPath(); ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
      }

      // gold sparkles
      for (let i = gold.length - 1; i >= 0; i--) {
        const g = gold[i];
        g.x += g.vx; g.y += g.vy; g.vy += 0.004; g.life++; g.tw += 0.2;
        if (g.life > g.max || g.y < -10) { gold.splice(i, 1); continue; }
        const a = (1 - g.life / g.max) * (0.6 + 0.4 * Math.sin(g.tw));
        ctx.globalAlpha = Math.max(0, a);
        ctx.fillStyle = "#FFE57A";
        ctx.shadowColor = "#FFD700"; ctx.shadowBlur = 10;
        ctx.beginPath(); ctx.arc(g.x, g.y, g.size, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
      }
      ctx.globalAlpha = 1;

      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    const fadeT = setTimeout(() => setStage("fading"), 7600);
    const doneT = setTimeout(() => { onDoneRef.current?.(); }, 8200);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(fadeT); clearTimeout(doneT);
      window.removeEventListener("resize", resize);
      if (audioRef.current) audioRef.current.stop();
    };
  }, []);

  const finishNow = () => {
    setStage("fading");
    if (audioRef.current) audioRef.current.stop();
    setTimeout(() => { if (onDone) onDone(); }, 420);
  };
  const ensureAudio = () => { if (audioRef.current) audioRef.current.resume(); };

  return (
    <div className={`vc-overlay ${stage}`} onClick={ensureAudio} role="presentation">
      <canvas ref={canvasRef} className="vc-canvas"></canvas>
      <div className="vc-wave"></div>
      <div className="vc-lights"></div>
      <div className="vc-center">
        <div className="vc-glow"></div>
        <div className="vc-crest"><TrophyIcon /></div>
        <h1 className="vc-title">VITÓRIA!</h1>
        <p className="vc-viva">Viva o Brasil</p>
        <p className="vc-sub">Campeões do Mundo</p>
        <div
          className="vc-scoreline"
          aria-label={`${celebration.team_code} ${celebration.team_score}, ${celebration.opponent_code} ${celebration.opponent_score}`}
        >
          <span className="vc-scoreline__team">
            <Flag code={celebration.team_code} size={26} />
            {celebration.team_code}
          </span>
          <span className="vc-scoreline__score">
            <span>{celebration.team_score}</span>
            <span className="vc-scoreline__dash">–</span>
            <span>{celebration.opponent_score}</span>
          </span>
          <span className="vc-scoreline__team">
            {celebration.opponent_code}
            <Flag code={celebration.opponent_code} size={26} />
          </span>
        </div>
      </div>
      <div className="vc-legends">
        <img className="vc-legends-img" src="/legends-flag.jpg" alt="Brazil legends holding the national flag" />
      </div>
      <button className="vc-skip" onClick={finishNow}>Skip to results ›</button>
    </div>
  );
}
