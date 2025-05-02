import { renderGame } from '../game/renderer.js';
import { generateDungeon } from '../game/dungeon.js';

const gameViewElement = document.getElementById('game-view');
const gameContainerElement = document.getElementById('game-container'); // Target for rendering

// Add player tracking
let activePlayers = new Map();

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

// Update the render function to only show active players
function render(gameState) {
    if (!gameState || !gameState.players) return;
    
    // Clear previous player positions
    clearPlayers();
    
    // Update active players and render them
    activePlayers.clear();
    gameState.players.forEach(player => {
        activePlayers.set(player.id, player);
        renderPlayer(player);
    });
}

// Add function to clear players
function clearPlayers() {
    // Remove all @ symbols from the game grid
    const cells = document.querySelectorAll('.cell');
    cells.forEach(cell => {
        if (cell.textContent === '@') {
            cell.textContent = '.';
            cell.className = 'cell floor';
        }
    });
}

// Update the initialization to handle disconnections
export function initializeGameView(config) {
    // ...existing code...
    
    // Add disconnect handlers
    config.onClientDisconnected = (clientId) => {
        // Remove the disconnected player from our active players
        activePlayers.delete(clientId);
        // Re-render the game view
        render({ players: Array.from(activePlayers.values()) });
    };
    
    config.onHostDisconnected = () => {
        // Clear all players as the game session has ended
        activePlayers.clear();
        clearPlayers();
        // Optionally redirect to landing page or show disconnection message
        document.getElementById('disconnectMessage')?.classList.remove('hidden');
    };
}
