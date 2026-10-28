// Coordinates shared by the sitting replacement layers and the standing sprite shader.
export const SIT_FACE = { x: 124, y: 132, size: 44 };

export function faceDrawTransform(scale, head, pad = 56) {
  const radians = Number(head || 0);
  const dx = SIT_FACE.x - 118;
  const dy = SIT_FACE.y - 152;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    x: (pad + 118 + dx * cos - dy * sin) * scale,
    y: (pad + 152 + dx * sin + dy * cos) * scale,
    size: SIT_FACE.size * scale,
    angle: -radians,
  };
}
