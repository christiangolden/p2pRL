import { renderGame } from '../game/renderer.js';
import { generateDungeon } from '../game/dungeon.js';

const gameViewElement = document.getElementById('game-view');
const gameContainerElement = document.getElementById('game-container'); // Target for rendering

export function showGameView() {
    const landingPage = document.getElementById('landing-page');
    if (landingPage) {
        landingPage.classList.add('hidden'); 
    }
    if (gameViewElement) {
        gameViewElement.classList.remove('hidden'); // Use class manipulation for visibility
        
        // Initial render when view becomes visible
        const initialDungeon = generateDungeon();
        if (gameContainerElement) {
            renderGame(gameContainerElement, initialDungeon, []); // Render into game-container
        } else {
             console.error('Game container element not found!');
        }
    } else {
        console.error('Game view element not found!');
    }
}

// Function to update the game view content (will be called by app.js on state updates)
export function updateGameView(dungeon, players) {
    if (gameContainerElement) {
        renderGame(gameContainerElement, dungeon, players); // Render into game-container
    } else {
        console.error('Game container element not found during update!');
    }
}
