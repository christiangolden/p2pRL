// SOW II.A.4, II.C.2, II.D.5: Renders the game state (dungeon + players)

/**
 * Renders the complete game state to the provided HTML element.
 * @param {HTMLElement} gameViewElement - The element to render into.
 * @param {string[][]} dungeon - The 2D array representing the dungeon map.
 * @param {Array<{id: string, x: number, y: number, color: string}>} players - Array of player objects.
 */
export function renderGame(gameViewElement, dungeon, players) {
    if (!gameViewElement || !dungeon) return;

    // Create a copy of the dungeon to draw players onto with styled elements
    const displayGrid = dungeon.map(row => 
        row.map(cell => {
            // Apply styling to wall and floor characters
            if (cell === '#') {
                return `<span class="wall-char">${cell}</span>`;
            } else if (cell === '.') {
                return `<span class="floor-char">${cell}</span>`;
            } else {
                return cell;
            }
        })
    );

    // Draw players onto the grid
    players.forEach(player => {
        if (player.y >= 0 && player.y < displayGrid.length &&
            player.x >= 0 && player.x < displayGrid[0].length) {
            // Use span with color class for player representation (SOW II.C.2)
            displayGrid[player.y][player.x] = `<span class="player-${player.color}">@</span>`;
        }
    });

    // Convert grid to HTML string
    const gridHtml = displayGrid.map(row => row.join('')).join('\n');

    // Update the game view element's content
    gameViewElement.innerHTML = gridHtml;
}
