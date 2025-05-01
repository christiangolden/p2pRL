import { renderGame } from '../game/renderer.js';
import { generateDungeon } from '../game/dungeon.js';

const gameViewElement = document.getElementById('game-view');

export function showGameView() {
    const landingPage = document.getElementById('landing-page');
    if (landingPage) {
        landingPage.style.display = 'none';
    }
    if (gameViewElement) {
        gameViewElement.style.display = 'block';
        // Initial render when view becomes visible
        // TODO: Replace null with actual initial player data later
        const initialDungeon = generateDungeon();
        renderGame(gameViewElement, initialDungeon, []); // Render empty dungeon initially
    } else {
        console.error('Game view element not found!');
    }
}

// Function to update the game view content (will be called by app.js on state updates)
export function updateGameView(dungeon, players) {
    if (gameViewElement) {
        renderGame(gameViewElement, dungeon, players);
    } else {
        console.error('Game view element not found during update!');
    }
}
