// Lightweight canvas confetti: bursts for round wins, continuous rain for the winner screen.

const COLORS = ['#e5007d', '#ff6b1a', '#ffd23f', '#00b4a6', '#8ac926', '#7b2cbf', '#ffffff', '#2fa8ff'];

export function createConfetti(canvas) {
  const c = canvas.getContext('2d');
  let parts = [];
  let raf = null;
  let raining = false;
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  const make = (x, y, vx, vy) => ({
    x,
    y,
    vx,
    vy,
    w: 10 + Math.random() * 12,
    h: 6 + Math.random() * 8,
    r: Math.random() * Math.PI * 2,
    vr: (Math.random() - 0.5) * 0.3,
    color: COLORS[(Math.random() * COLORS.length) | 0],
    round: Math.random() < 0.25,
    life: Math.random() * 100,
  });

  function burst(n = 180, { x = 0.5, y = 0.4 } = {}) {
    if (reduced) n = Math.min(n, 40);
    const W = canvas.width;
    const H = canvas.height;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 8 + Math.random() * 18;
      parts.push(make(x * W, y * H, Math.cos(a) * sp, Math.sin(a) * sp - 10));
    }
    loop();
  }

  function rain(on) {
    raining = on;
    if (on) loop();
  }

  function clear() {
    raining = false;
    parts = [];
    c.clearRect(0, 0, canvas.width, canvas.height);
  }

  function loop() {
    if (!raf) raf = requestAnimationFrame(step);
  }

  function step() {
    raf = null;
    const W = canvas.width;
    const H = canvas.height;
    c.clearRect(0, 0, W, H);
    if (raining && parts.length < (reduced ? 60 : 380)) {
      for (let k = 0; k < (reduced ? 1 : 5); k++) parts.push(make(Math.random() * W, -20, (Math.random() - 0.5) * 4, 2 + Math.random() * 4));
    }
    for (const p of parts) {
      p.life += 1;
      p.vx *= 0.985;
      p.vy = p.vy * 0.985 + 0.38;
      p.x += p.vx + Math.sin(p.life * 0.08) * 1.2;
      p.y += p.vy;
      p.r += p.vr;
      c.save();
      c.translate(p.x, p.y);
      c.rotate(p.r);
      c.fillStyle = p.color;
      if (p.round) {
        c.beginPath();
        c.arc(0, 0, p.h / 1.6, 0, Math.PI * 2);
        c.fill();
      } else {
        c.scale(1, Math.abs(Math.cos(p.life * 0.1)) + 0.2);
        c.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      }
      c.restore();
    }
    parts = parts.filter((p) => p.y < H + 40);
    if (parts.length || raining) raf = requestAnimationFrame(step);
  }

  return { burst, rain, clear };
}
