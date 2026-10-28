const COLORS = {
  cyberpunk: ['#ff176d', '#ff4f9a', '#9d5cff', '#35f5b0'],
  capri: ['#ff315f', '#ff8baf', '#9d5cff', '#35f5b0'],
};

export function createDrone(canvas, { reducedMotion = false } = {}) {
  const ctx = canvas.getContext('2d');
  let lastFrame = -1;
  let pointer = { x: 0, y: 0 };
  let colors = COLORS.cyberpunk;

  const draw = (time = 0, mouse = pointer) => {
    if (!ctx) return;
    pointer = mouse || pointer;
    const frame = reducedMotion ? 0 : Math.floor(time / (1000 / 24));
    if (frame === lastFrame) return;
    lastFrame = frame;
    const t = frame * 0.018;
    const size = canvas.width;
    const cx = size / 2 + Math.sin(t * 0.7) * 8;
    const cy = size / 2 + Math.cos(t * 0.8) * 7;
    ctx.clearRect(0, 0, size, size);
    for (let i = 0; i < 9; i++) {
      const angle = t * (i % 2 ? 1 : -1) + i * 0.7;
      const radius = size * 0.23 + (i % 3) * size * 0.03;
      ctx.save();
      ctx.translate(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius);
      ctx.rotate(angle + 0.7);
      ctx.fillStyle = colors[i % colors.length];
      ctx.beginPath();
      ctx.moveTo(-8, -34);
      ctx.lineTo(13, 0);
      ctx.lineTo(-5, 25);
      ctx.lineTo(-18, 3);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    const dx = (pointer.x - cx) * 0.11;
    const dy = (pointer.y - cy) * 0.11;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(Math.atan2(dy, dx) * 0.12);
    ctx.fillStyle = '#06150f';
    ctx.strokeStyle = colors[3];
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.ellipse(0, 0, size * 0.12, size * 0.078, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    if (reducedMotion || Math.sin(t * 1.35) > -0.08) {
      ctx.fillStyle = '#d3ffff';
      ctx.beginPath();
      ctx.ellipse(dx * 0.45, dy * 0.45, size * 0.033, size * 0.046, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  };

  return {
    canvas,
    draw,
    update: draw,
    show() {
      canvas.hidden = false;
      canvas.classList?.remove('is-glitch-out');
      canvas.classList?.add('is-glitch-in');
    },
    hide() {
      canvas.classList?.remove('is-glitch-in');
      canvas.classList?.add('is-glitch-out');
      setTimeout(() => { canvas.hidden = true; }, 180);
    },
    setTheme(theme) { colors = COLORS[theme] || COLORS.cyberpunk; lastFrame = -1; },
    hit(x, y) {
      const rect = canvas.getBoundingClientRect();
      const dx = x - (rect.left + rect.width / 2);
      const dy = y - (rect.top + rect.height / 2);
      return dx * dx + dy * dy < (rect.width * 0.16) ** 2;
    },
  };
}
