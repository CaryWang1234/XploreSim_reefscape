// Canvas renderer for the REEFSCAPE field. Pure drawing: it reads a frame from the engine and the
// static geometry from model.js, and never mutates anything, so the same frame always looks the same.

import { layout, branchSlots, coralMarks, reefAlgae } from './model.js';
import { FIELD, GEO, ROBOT_LIMITS, PIECES, NET_LANES, NET_CAPACITY } from './rules.js';

const INK = {
  carpet: '#10192a',
  carpetAlt: '#0d1523',
  guardrail: '#33455e',
  zone: 'rgba(142,160,187,0.34)',
  blue: '#2f7de1',
  red: '#e0413f',
  blueSoft: 'rgba(47,125,225,0.16)',
  redSoft: 'rgba(224,65,63,0.16)',
  // §5.7.1: a CORAL is a length of white PVC pipe, 4 in in diameter by 11 in long. §5.7.2: an ALGAE is
  // an inflated ring 16 in across — four times the CORAL's diameter, which is the proportion the earlier
  // amber dots and same-sized markers hid.
  coral: '#f1eee4',
  coralEdge: 'rgba(21,29,41,0.75)',
  algae: '#4ec08a',
  busy: '#6ad0ff',
  truss: '#2b3646',
  text: '#e6edf7',
  dim: '#8ea0bb',
};

const REEF_R = GEO.reef.hexAcrossFlatsIn / 2 / Math.cos(Math.PI / 6); // hexagon vertex radius
const SLOT = branchSlots({ x: 0, y: 0, apothem: GEO.reef.hexAcrossFlatsIn / 2 });
const LEVEL_RADIUS = { L2: 1.0, L3: 1.12, L4: 1.24 };

export function fieldGeometry() {
  return layout();
}

export function drawField(ctx, frame, opt = {}) {
  const geo = opt.geo || fieldGeometry();
  const pad = 26;
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const s = Math.min((W - pad * 2) / FIELD.longIn, (H - pad * 2) / FIELD.wideIn);
  const ox = (W - FIELD.longIn * s) / 2;
  const oy = (H - FIELD.wideIn * s) / 2;
  const X = (v) => ox + v * s;
  const Y = (v) => oy + v * s;
  const S = (v) => v * s;

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = INK.carpetAlt;
  ctx.fillRect(0, 0, W, H);

  // carpet + guardrail
  ctx.fillStyle = INK.carpet;
  ctx.fillRect(X(0), Y(0), S(FIELD.longIn), S(FIELD.wideIn));
  ctx.strokeStyle = INK.guardrail;
  ctx.lineWidth = Math.max(2, S(3));
  ctx.strokeRect(X(0), Y(0), S(FIELD.longIn), S(FIELD.wideIn));

  // starting lines
  for (const side of ['blue', 'red']) {
    const lx = X(geo[side].startingLineX);
    ctx.strokeStyle = side === 'blue' ? INK.blueSoft : INK.redSoft;
    ctx.lineWidth = Math.max(1.5, S(2));
    ctx.setLineDash([S(8), S(6)]);
    ctx.beginPath();
    ctx.moveTo(lx, Y(0));
    ctx.lineTo(lx, Y(FIELD.wideIn));
    ctx.stroke();
    ctx.setLineDash([]);
    if (opt.labels) text(ctx, 'STARTING LINE', lx, Y(6), INK.dim, S(7), 'left');
  }

  drawBarge(ctx, geo, frame, X, Y, S, opt);
  drawNets(ctx, geo, frame, X, Y, S, opt);
  for (const side of ['blue', 'red']) drawReef(ctx, geo, frame, side, X, Y, S, opt);
  drawStations(ctx, geo, frame, X, Y, S, opt);
  drawProcessors(ctx, geo, frame, X, Y, S, opt);

  // Loose pieces on the carpet. A CORAL is an 11 in pipe lying the way it fell (§5.7.1); an ALGAE is a
  // 16 in ring (§5.7.2), so it gets the ring and not the bar. Drawing every floor entry as a bar made a
  // dropped ALGAE indistinguishable from a dropped CORAL, which is the size difference the page is built
  // around.
  if (frame) {
    // §6.3.4.2 B stages one ALGAE on TOP of the CORAL at each CORAL MARK, so the ring has to be laid over
    // the pipe. Drawing it with the REEF's own ALGAE put it underneath and hid it.
    for (const side of ['blue', 'red']) {
      const o = frame.reef?.[side];
      const marks = coralMarks(geo, side);
      const mask = o?.algaeMarksM;
      const left = o?.algaeMarks ?? 0;
      for (let i = 0; i < marks.length; i++) {
        if (mask === undefined ? i < left : ((mask >> i) & 1) === 1) drawAlgae(ctx, X, Y, S, marks[i].x, marks[i].y, 0.6);
      }
    }
  }

  // robots above the field furniture, loose pieces above the robots: `dropHere` puts a shaken-loose CORAL at
  // the car's own feet, and 25 of the 35 falls on this seed left it inside the 30 in plate it fell from. Drawn
  // under the car it was simply not on screen, which is what made the FIELD read as never having dropped
  // anything. A piece on top of a plate reads as a piece seen through the car, which is what a field diagram
  // is for; a ROBOT's own held CORAL is drawn by drawRobot at the gripper, so the two cannot be confused.
  for (const rb of frame ? frame.robots : []) drawRobot(ctx, rb, X, Y, S, opt);
  if (frame) {
    for (const c of frame.floor) {
      if (c.kind === 'algae') drawAlgae(ctx, X, Y, S, c.x, c.y, 1);
      else drawCoral(ctx, X, Y, S, c.x, c.y, c.rot || 0, 1);
    }
  }
}

// A CORAL is a length of 4 in diameter pipe, 11 in long (§5.7.1), so it is drawn as a bar with the way
// it fell. `scale` shrinks it for the 36 of them on one REEF, where a full-size bar would read as a
// solid ring; anything held by a ROBOT is drawn at its real proportion against the 30 in car.
function drawCoral(ctx, X, Y, S, x, y, rotDeg, scale = 1) {
  const len = Math.max(5, S(PIECES.coral.lengthIn * scale));
  const th = Math.max(2, S(PIECES.coral.diameterIn * scale));
  ctx.save();
  ctx.translate(X(x), Y(y));
  ctx.rotate(((rotDeg || 0) * Math.PI) / 180);
  ctx.beginPath();
  ctx.roundRect(-len / 2, -th / 2, len, th, th / 2);
  ctx.fillStyle = INK.coral;
  ctx.fill();
  ctx.strokeStyle = INK.coralEdge;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

// An ALGAE is an inflated ring about 16 in across (§5.7.2) — four times the CORAL's diameter, which is
// why it is stroked thick with the carpet left showing through the middle instead of filled.
function drawAlgae(ctx, X, Y, S, x, y, scale = 1) {
  const r = Math.max(3, S((PIECES.algae.diameterIn[0] / 2) * scale));
  ctx.beginPath();
  ctx.arc(X(x), Y(y), r, 0, Math.PI * 2);
  ctx.strokeStyle = INK.algae;
  ctx.lineWidth = Math.max(1.6, S(4.4 * scale));
  ctx.stroke();
}

function hexPath(ctx, cx, cy, r) {
  ctx.beginPath();
  for (let k = 0; k < 6; k++) {
    const a = (Math.PI / 3) * k + Math.PI / 6; // vertices at 30,90,...: flats face the ±x alliance walls
    const px = cx + r * Math.cos(a);
    const py = cy + r * Math.sin(a);
    if (k === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function text(ctx, str, x, y, color, size, align = 'center') {
  ctx.fillStyle = color;
  ctx.font = `600 ${Math.max(7, size)}px ui-monospace, Menlo, Consolas, monospace`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(str, x, y);
}

function drawReef(ctx, geo, frame, side, X, Y, S, opt) {
  const r = geo[side].reef;
  const cx = X(r.x);
  const cy = Y(r.y);
  const color = side === 'blue' ? INK.blue : INK.red;

  // REEF ZONE (§5): the volume a ROBOT may not be contacted inside (G427)
  ctx.strokeStyle = INK.zone;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([S(6), S(5)]);
  hexPath(ctx, cx, cy, S(r.apothem / Math.cos(Math.PI / 6)));
  ctx.stroke();
  ctx.setLineDash([]);

  // the hexagon body
  hexPath(ctx, cx, cy, S(REEF_R));
  ctx.fillStyle = '#1b2637';
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1.5, S(2));
  ctx.stroke();

  // 12 branches per level, drawn at their real positions; the three levels are pulled apart radially
  // so a ring reads as L2 (inside) → L4 (outside) rather than as one overlapping pile. A scored CORAL is
  // a pipe sticking out along its branch, not a dot.
  //
  // Which branch is which comes from the frame's per-level bitmask, so a CORAL booked on the face at 150° is
  // drawn on the face at 150°. Reading the counts and filling the first N slots in list order — what this did
  // before — put every fleet's CORAL on the same faces regardless of where it actually placed them, and a
  // REEF with 12 on L2 looked like 12 on the three faces the list happens to start with. A frame with no mask
  // (a replay exported before the field carried the indices) falls back to that count fill.
  const occ = frame ? frame.reef[side] : null;
  const on = (lv, i) => {
    if (!occ) return false;
    const m = occ[`${lv}m`];
    return m === undefined ? i < occ[lv] : ((m >> i) & 1) === 1;
  };
  const levels = ['L2', 'L3', 'L4'];
  for (let li = 0; li < 3; li++) {
    const lv = levels[li];
    const f = LEVEL_RADIUS[lv];
    for (let i = 0; i < SLOT.length; i++) {
      const wx = r.x + SLOT[i].x * f;
      const wy = r.y + SLOT[i].y * f;
      const taken = on(lv, i);
      if (taken) {
        drawCoral(ctx, X, Y, S, wx, wy, (Math.atan2(SLOT[i].y, SLOT[i].x) * 180) / Math.PI, 0.46);
        if (li === 2) {
          ctx.strokeStyle = 'rgba(241,238,228,0.45)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(X(wx), Y(wy), Math.max(4, S(6)), 0, Math.PI * 2);
          ctx.stroke();
        }
      } else {
        ctx.beginPath();
        ctx.arc(X(wx), Y(wy), Math.max(1.8, S(2.2)), 0, Math.PI * 2);
        ctx.fillStyle = '#22303f';
        ctx.fill();
      }
    }
  }

  // trough (L1) is a ring hugging the base, counted not placed
  if (occ && occ.trough > 0) {
    ctx.strokeStyle = INK.coral;
    ctx.lineWidth = Math.max(2, S(4));
    ctx.beginPath();
    ctx.arc(cx, cy, S(REEF_R * 0.62), 0, Math.PI * 2 * Math.min(1, occ.trough / GEO.reef.branchesPerLevel));
    ctx.stroke();
  }

  // ALGAE left on this side (§6.3.4.2 A): one ring straddling the two BRANCHES of each of the six FACES.
  // 16 in rings on pipes 13 in apart, so a ring always overlaps both of them, the way it does on the real REEF.
  // The 1 on top of each CORAL MARK
  // (§6.3.4.2 B) is drawn after the loose pieces, because it rides over them.
  //
  // The frame's bitmask says WHICH rings are still there. Filling the first N of the list drew a REEF whose
  // rings had been taken off one face as a REEF missing rings from whichever faces the list starts with, which
  // is the same lie the BRANCHES above used to tell.
  const rings = reefAlgae(geo, side);
  const reefMask = occ ? occ.algaeReefM : undefined;
  const reefLeft = occ ? occ.algaeReef ?? Math.min(rings.length, occ.algae) : 0;
  for (let i = 0; i < rings.length; i++) {
    const left = reefMask === undefined ? i < reefLeft : ((reefMask >> i) & 1) === 1;
    if (left) drawAlgae(ctx, X, Y, S, rings[i].x, rings[i].y, 0.62);
  }
  // The CORAL MARKS themselves (§6.3.4.1 A): a mark is a carpet position an 11 in CORAL lies across.
  for (const m of coralMarks(geo, side)) {
    ctx.strokeStyle = 'rgba(241,238,228,0.35)';
    ctx.lineWidth = 1;
    ctx.setLineDash([S(3), S(3)]);
    ctx.strokeRect(X(m.x) - S(8), Y(m.y) - S(5), S(16), S(10));
    ctx.setLineDash([]);
  }

  if (opt.labels) {
    text(ctx, side === 'blue' ? 'BLUE REEF' : 'RED REEF', cx, cy - S(REEF_R + 16), INK.dim, S(8));
    text(ctx, `L1 ${occ ? occ.trough : 0}/24`, cx, cy, INK.text, S(9));
  }
}

function drawBarge(ctx, geo, frame, X, Y, S, opt) {
  const midX = geo.midX;
  const half = GEO.barge.depthIn / 2;
  // §5.4: 29 ft 2 in long × 3 ft 8 in deep; the long axis runs across the field width and the legs
  // stand outside the guardrail, which is why the plate is drawn past the carpet on both ends.
  ctx.fillStyle = INK.truss;
  ctx.fillRect(X(midX - half), Y(-18), S(half * 2), S(FIELD.wideIn + 36));
  ctx.strokeStyle = '#3d4c60';
  ctx.lineWidth = 1;
  for (let y = -12; y < FIELD.wideIn + 12; y += 14) {
    ctx.beginPath();
    ctx.moveTo(X(midX - half), Y(y));
    ctx.lineTo(X(midX + half), Y(y + 14));
    ctx.stroke();
  }
  for (const side of ['blue', 'red']) {
    const color = side === 'blue' ? INK.blue : INK.red;
    geo[side].cages.forEach((c, i) => {
      const deep = frame && frame.cages ? frame.cages[side][i] : false;
      const used = frame && frame.cageUsed ? frame.cageUsed[side][i] : 0;
      const w = S(GEO.cage.widthIn);
      // §5.4.1: a CAGE is 7 in square outside and 2 ft tall, so top-down it is a 7 in box. At field scale
      // that is a few pixels, so a soft halo of the alliance colour marks where the pipe actually hangs.
      ctx.fillStyle = deep ? (side === 'blue' ? INK.blueSoft : INK.redSoft) : 'rgba(74,85,104,0.28)';
      ctx.beginPath();
      ctx.arc(X(c.x), Y(c.y), Math.max(7, S(15)), 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = deep ? color : '#4a5568';
      ctx.fillRect(X(c.x) - w / 2, Y(c.y) - w / 2, w, w);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.2;
      ctx.strokeRect(X(c.x) - w / 2, Y(c.y) - w / 2, w, w);
      // one notch per ROBOT committed to that pipe, so a stack is visible rather than inferred
      for (let k = 0; k < used; k++) {
        const toward = side === 'blue' ? 1 : -1;
        ctx.fillStyle = INK.text;
        ctx.fillRect(X(c.x) + toward * (w / 2 + S(7)) - S(2), Y(c.y) - ((used - 1) * S(9)) / 2 + k * S(9) - S(2), S(4), S(4));
      }
    });
    // BARGE ZONE (§5): 3 ft 10 in deep × 12 ft 2½ in long around the alliance's own climbing area
    const bz = geo[side].bargeZone;
    ctx.strokeStyle = side === 'blue' ? INK.blueSoft : INK.redSoft;
    ctx.setLineDash([S(5), S(4)]);
    ctx.strokeRect(X(bz.x - bz.halfX), Y(bz.y - bz.halfY), S(bz.halfX * 2), S(bz.halfY * 2));
    ctx.setLineDash([]);
  }
  if (opt.labels) text(ctx, 'BARGE', X(midX), Y(FIELD.wideIn / 2), INK.dim, S(8));
}

// §5.4.2: one NET per ALLIANCE, 4 ft x 12 ft of knit mesh hanging off the top of the BARGE with its
// lowest point 6 ft 4 in up. §6.1 scores an ALGAE in it, and in this build two things put them there: the
// HUMAN PLAYER's throws, and a ROBOT with an elevator (`netScoreSec`, 0 on every shipped machine). The
// mesh is drawn as an overlay panel rather than as a field volume, but the pieces inside it are drawn too:
// a counting label alone read as an empty net, which is the opposite of what the score column says.
function drawNets(ctx, geo, frame, X, Y, S, opt) {
  for (const side of ['blue', 'red']) {
    const n = geo[side].net;
    const x0 = X(n.x - n.w / 2);
    const y0 = Y(n.y - n.d / 2);
    const w = S(n.w);
    const h = S(n.d);
    ctx.fillStyle = side === 'blue' ? INK.blueSoft : INK.redSoft;
    ctx.fillRect(x0, y0, w, h);
    ctx.strokeStyle = '#3d4c60';
    ctx.lineWidth = 1;
    for (let a = 0; a < h; a += S(9)) {
      ctx.beginPath();
      ctx.moveTo(x0, y0 + a);
      ctx.lineTo(x0 + w, y0 + a);
      ctx.stroke();
    }
    for (let b = 0; b < w; b += S(9)) {
      ctx.beginPath();
      ctx.moveTo(x0 + b, y0);
      ctx.lineTo(x0 + b, y0 + h);
      ctx.stroke();
    }
    ctx.strokeStyle = side === 'blue' ? INK.blue : INK.red;
    ctx.lineWidth = Math.max(1.5, S(2));
    ctx.strokeRect(x0, y0, w, h);
    const scored = frame && frame.net ? frame.net[side] : 0;
    // The 12 ft face splits along its length into three 4 ft patches, one per ROBOT (engine.js `netDeposit`),
    // and each patch takes three 16 in rings across its 4 ft width (rules.js `NET_LANE_CAPACITY`). An imported
    // MATCH recorded before lanes existed has no per-lane column, so its rings are spread round-robin rather
    // than drawn as an empty NET.
    const lanes = frame && frame.netLanes ? frame.netLanes[side] : null;
    const counts = lanes ? lanes.slice() : [0, 0, 0];
    if (!lanes) for (let i = 0; i < scored; i++) counts[i % NET_LANES] += 1;
    const cap = frame && frame.netCap ? frame.netCap : NET_CAPACITY;
    for (let c = 0; c < NET_LANES; c++) {
      const cy = n.y - n.d / 2 + (c + 0.5) * (n.d / NET_LANES);
      const bandH = n.d / NET_LANES;
      for (let k = 0; k < counts[c]; k++) {
        // three across the 4 ft width, then a second row inside the same patch if a widened capacity asks for it
        drawAlgae(
          ctx, X, Y, S,
          n.x - n.w / 2 + (n.w * ((k % 3) + 0.5)) / 3,
          cy + (Math.floor(k / 3) - 0.25) * bandH * 0.34,
          0.34,
        );
      }
    }
    text(ctx, `NET ${scored}/${cap}`, x0 + w / 2, y0 + S(7), INK.text, S(11));
    if (opt.labels) text(ctx, side === 'blue' ? 'BLUE NET' : 'RED NET', x0 + w / 2, y0 - S(10), INK.dim, S(7));
  }
}

function drawStations(ctx, geo, frame, X, Y, S, opt) {
  for (const side of ['blue', 'red']) {
    const color = side === 'blue' ? INK.blue : INK.red;
    geo[side].coralStations.forEach((st, i) => {
      const q = frame && frame.stations ? frame.stations[side][i] : null;
      ctx.fillStyle = '#1b2637';
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      const w = S(GEO.coralStation.openingWidthIn);
      const h = S(16);
      const x0 = side === 'blue' ? X(0) - S(2) : X(FIELD.longIn) - w + S(2);
      ctx.fillRect(x0, Y(st.y) - h / 2, w, h);
      ctx.strokeRect(x0, Y(st.y) - h / 2, w, h);
      if (q !== null) text(ctx, String(q), x0 + w / 2, Y(st.y), INK.text, S(9));
    });
  }
}

function drawProcessors(ctx, geo, frame, X, Y, S, opt) {
  for (const side of ['blue', 'red']) {
    const p = geo[side].processor;
    const color = side === 'blue' ? INK.blue : INK.red;
    const w = S(GEO.processor.openingWidthIn);
    const h = S(GEO.processor.openingHeightIn + 8);
    const x0 = X(p.x) - w / 2;
    const y0 = side === 'blue' ? Y(0) - h / 2 : Y(FIELD.wideIn) - h / 2;
    ctx.fillStyle = '#1b2637';
    ctx.fillRect(x0, y0, w, h);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x0, y0, w, h);
    const n = frame && frame.processor ? frame.processor[side] : 0;
    text(ctx, `PROC ${n}`, x0 + w / 2, y0 + h / 2, INK.text, S(8));
    // What the HUMAN PLAYER is sitting on: G435 allows 3 ALGAE in the holders on top of the PROCESSOR
    // and 1 at the end of the exit ramp, and that is the whole supply for the NET.
    const q = frame && frame.hpQueue ? frame.hpQueue[side] : 0;
    for (let i = 0; i < Math.min(4, q); i++) drawAlgae(ctx, X, Y, S, p.x - (GEO.processor.openingWidthIn / 2) + 8 + i * 10, side === 'blue' ? -13 : FIELD.wideIn + 13, 0.34);
    text(ctx, `AREA ${q}/4`, x0 + w / 2, side === 'blue' ? y0 + h + S(8) : y0 - S(8), INK.dim, S(7));
  }
}

function drawRobot(ctx, rb, X, Y, S, opt) {
  const color = rb.side === 'blue' ? INK.blue : INK.red;
  const size = S(ROBOT_LIMITS.footprintIn);
  const cx = X(rb.x);
  const cy = Y(rb.y);
  if (opt.targets && rb.target) {
    ctx.strokeStyle = rb.busy ? color : 'rgba(142,160,187,0.5)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(X(rb.target[0]), Y(rb.target[1]));
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(((rb.heading || 0) * Math.PI) / 180);
  const r = Math.max(2, size * 0.22);
  ctx.beginPath();
  ctx.roundRect(-size / 2, -size / 2, size, size, r);
  ctx.fillStyle = rb.disabled ? '#4a5568' : color;
  ctx.globalAlpha = rb.climb ? 0.75 : 1;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = rb.busy ? INK.busy : 'rgba(230,237,247,0.55)';
  ctx.lineWidth = rb.busy ? 2 : 1;
  ctx.stroke();
  // The front BUMPERS, in a light tint of the ALLIANCE colour: a ROBOT is not a disc, and since heading
  // became real state the replay has to show which way the car is pointed.
  ctx.fillStyle = rb.side === 'blue' ? '#7fb3ee' : '#f08f8d';
  ctx.fillRect(size / 2 - S(4), -size / 2, S(4), size);
  // What it is holding, at real proportion against the 30 in car: an 11 in CORAL pipe laid along the
  // front-right, and a 16 in ALGAE ring on the front-left. G409 allows exactly one of each.
  if (rb.coral) {
    ctx.beginPath();
    ctx.roundRect(size * 0.16, -S(5.5), S(PIECES.coral.lengthIn), S(PIECES.coral.diameterIn), S(2));
    ctx.fillStyle = INK.coral;
    ctx.fill();
    ctx.strokeStyle = INK.coralEdge;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  if (rb.algae) {
    ctx.beginPath();
    ctx.arc(-size * 0.2, size * 0.18, Math.max(3, S(PIECES.algae.diameterIn[0] / 2) * 0.8), 0, Math.PI * 2);
    ctx.strokeStyle = INK.algae;
    ctx.lineWidth = Math.max(1.6, S(4.4) * 0.8);
    ctx.stroke();
  }
  ctx.restore();

  if (opt.numbers) text(ctx, String(rb.slot + 1), cx, cy, INK.text, size * 0.5);
}

// The mark positions are exported so the DOM legend can draw the same dots the canvas does.
export { INK, SLOT, coralMarks };
