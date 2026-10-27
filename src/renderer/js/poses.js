// Lying pose sheets: full drawings, legs looped on fives. Contact is the pixel that sits
// on a ledge (hip/torso), so dangling legs can hang past it.

export const LIE_FPS = 5;
export const POSE_SIZE = { width: 721, height: 644 };

export const POSES = {
  lieA: {
    id: 'lieA',
    fps: LIE_FPS,
    width: POSE_SIZE.width,
    height: POSE_SIZE.height,
    // 0, 1, 0, 2
    files: ['lying_A.png', 'lying_A_1.png', 'lying_A.png', 'lying_A_2.png'],
    contact: { x: 310, y: 608 },
    head: { x: 209, y: 419 },
  },
  lieB: {
    id: 'lieB',
    fps: LIE_FPS,
    width: POSE_SIZE.width,
    height: POSE_SIZE.height,
    files: ['lying_B_0.png', 'lying_B_1.png', 'lying_B_2.png', 'lying_B_3.png'],
    contact: { x: 280, y: 600 },
    head: { x: 220, y: 459 },
  },
};

export const POSE_FILES = [...new Set(Object.values(POSES).flatMap((p) => p.files))];

export function poseFrame(name, now, startedAt = 0) {
  const spec = POSES[name];
  if (!spec) return 0;
  const n = spec.files.length;
  const f = Math.floor((now - startedAt) / (1000 / spec.fps));
  return ((f % n) + n) % n;
}

export function poseFile(name, now, startedAt = 0) {
  const spec = POSES[name];
  if (!spec) return null;
  return spec.files[poseFrame(name, now, startedAt)];
}

// The pose sheets are drawn at 2x the standing sprite's pixels (rig.json: "2x sprite px").
export const POSE_PX = 0.5;

export function poseScale(standScale) {
  return standScale * POSE_PX;
}

// How far along the box's top edge she goes: right of the folder tab, and never past the end.
function seatAlong(ledge, pose, scale) {
  const w = ledge.w;
  const spec = POSES[pose];
  if (!spec) return Math.round(Math.min(Math.max(w * 0.72, 40), Math.max(40, w - 40)));
  const s = poseScale(scale);
  const right = (spec.width - spec.contact.x) * s;
  const left = spec.contact.x * s * 0.35;
  return Math.round(Math.max(left, Math.min(w * 0.6, w - right - 4)));
}

// Where her contact point goes so that pixel sits on the box's top edge.
export function boxSeat(ledge, pose, { scale = 0.6, dx = null } = {}) {
  if (!ledge) return null;
  const along = dx == null ? seatAlong(ledge, pose, scale) : dx;
  const x = ledge.x + along;
  if (pose === 'stand') return { x, y: ledge.top + 2, dx: along, pose: 'stand' };
  const spec = POSES[pose];
  if (!spec) return { x, y: ledge.top + 1, dx: along, pose };
  return { x, y: ledge.top + 1, dx: along, pose, scale: poseScale(scale) };
}
