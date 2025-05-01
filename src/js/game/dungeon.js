// SOW II.C.1: Static, deterministic dungeon generation

const DUNGEON_WIDTH = 40;
const DUNGEON_HEIGHT = 25;
const WALL = '#';
const FLOOR = '.';

/**
 * Generates a static, deterministic dungeon grid.
 * @returns {string[][]} A 2D array representing the dungeon map.
 */
export function generateDungeon() {
    const dungeon = [];
    for (let y = 0; y < DUNGEON_HEIGHT; y++) {
        const row = [];
        for (let x = 0; x < DUNGEON_WIDTH; x++) {
            if (y === 0 || y === DUNGEON_HEIGHT - 1 || x === 0 || x === DUNGEON_WIDTH - 1) {
                row.push(WALL);
            } else {
                row.push(FLOOR);
            }
        }
        dungeon.push(row);
    }
    return dungeon;
}

// Function to check if a coordinate is walkable (not a wall)
export function isWalkable(dungeon, x, y) {
    if (x < 0 || x >= DUNGEON_WIDTH || y < 0 || y >= DUNGEON_HEIGHT) {
        return false; // Out of bounds
    }
    return dungeon[y][x] === FLOOR;
}
