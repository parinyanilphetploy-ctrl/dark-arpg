import { mulberry32 } from "./rng";

/** World size of one grid cell, metres. */
export const CELL = 2;
const GRID = 48;
const MIN_ROOM = 4;
const MAX_ROOM = 9;
const ROOM_GAP = 2;
const EXTRA_LOOPS = 2;

/** Room rectangle in grid cells. */
export interface Room {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DungeonLayout {
  w: number;
  h: number;
  /** 1 = walkable floor, 0 = solid. Index: y * w + x. */
  grid: Uint8Array;
  rooms: Room[];
  start: Room;
  exit: Room;
}

export const roomCenter = (r: Room) => ({ x: r.x + Math.floor(r.w / 2), y: r.y + Math.floor(r.h / 2) });

/**
 * Rooms-and-corridors dungeon: random non-overlapping rooms, each joined by an
 * L-shaped 2-wide corridor to its nearest earlier room (so everything is
 * connected), plus a few extra links for loops. Exit = room farthest from start.
 */
export function generateDungeon(seed: number, floor: number): DungeonLayout {
  const rng = mulberry32(seed);
  const int = (min: number, max: number) => min + Math.floor(rng() * (max - min + 1));
  const w = GRID;
  const h = GRID;
  const grid = new Uint8Array(w * h);
  const carve = (x: number, y: number) => {
    if (x > 0 && y > 0 && x < w - 1 && y < h - 1) grid[y * w + x] = 1;
  };

  const rooms: Room[] = [];
  const target = Math.min(14, 8 + floor);
  for (let attempt = 0; attempt < 400 && rooms.length < target; attempt++) {
    const r = { w: int(MIN_ROOM, MAX_ROOM), h: int(MIN_ROOM, MAX_ROOM), x: 0, y: 0 };
    r.x = int(2, w - r.w - 3);
    r.y = int(2, h - r.h - 3);
    const overlaps = rooms.some(
      (o) =>
        r.x < o.x + o.w + ROOM_GAP && r.x + r.w + ROOM_GAP > o.x && r.y < o.y + o.h + ROOM_GAP && r.y + r.h + ROOM_GAP > o.y,
    );
    if (!overlaps) rooms.push(r);
  }
  for (const r of rooms) {
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) carve(x, y);
  }

  const corridor = (a: Room, b: Room) => {
    const ca = roomCenter(a);
    const cb = roomCenter(b);
    const horizontal = (y: number, x0: number, x1: number) => {
      for (let x = Math.min(x0, x1); x <= Math.max(x0, x1) + 1; x++) {
        carve(x, y);
        carve(x, y + 1);
      }
    };
    const vertical = (x: number, y0: number, y1: number) => {
      for (let y = Math.min(y0, y1); y <= Math.max(y0, y1) + 1; y++) {
        carve(x, y);
        carve(x + 1, y);
      }
    };
    if (rng() < 0.5) {
      horizontal(ca.y, ca.x, cb.x);
      vertical(cb.x, ca.y, cb.y);
    } else {
      vertical(ca.x, ca.y, cb.y);
      horizontal(cb.y, ca.x, cb.x);
    }
  };

  const dist2 = (a: Room, b: Room) => {
    const ca = roomCenter(a);
    const cb = roomCenter(b);
    return (ca.x - cb.x) ** 2 + (ca.y - cb.y) ** 2;
  };
  for (let i = 1; i < rooms.length; i++) {
    let nearest = 0;
    for (let j = 1; j < i; j++) if (dist2(rooms[i], rooms[j]) < dist2(rooms[i], rooms[nearest])) nearest = j;
    corridor(rooms[i], rooms[nearest]);
  }
  for (let i = 0; i < EXTRA_LOOPS && rooms.length > 3; i++) {
    corridor(rooms[int(0, rooms.length - 1)], rooms[int(0, rooms.length - 1)]);
  }

  const start = rooms[0];
  let exit = rooms[rooms.length - 1];
  for (const r of rooms) if (dist2(start, r) > dist2(start, exit)) exit = r;

  return { w, h, grid, rooms, start, exit };
}

export function isFloor(layout: DungeonLayout, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < layout.w && y < layout.h && layout.grid[y * layout.w + x] === 1;
}

/** Centre of grid cell (x, y) in world space (y grid axis = world z). */
export function cellToWorld(layout: DungeonLayout, x: number, y: number) {
  return { x: (x + 0.5 - layout.w / 2) * CELL, z: (y + 0.5 - layout.h / 2) * CELL };
}
