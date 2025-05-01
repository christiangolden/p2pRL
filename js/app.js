import { initLandingPage } from './ui/landing.js';
import { showGameView, updateGameView } from './ui/game-view.js';
import { initializePeer, setAsHost, connectToHost, sendData, broadcastData, getPeerId, getClientPeerIds, getHostPeerId } from './connection/p2p.js';
import { generateDungeon, isWalkable } from './game/dungeon.js';
import { initInput, disableInput, setupTouchControls } from './game/input.js';

// Game State (SOW II.D.1)
let gameState = {
    players: [] // Array of { id: string, x: number, y: number, color: string }
};
let dungeon = null;
let isHost = false;
let localPeerId = null;

// Player Colors (SOW II.C.2)
const PLAYER_COLORS = ['red', 'blue', 'green', 'yellow'];

document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM fully loaded and parsed');
    initLandingPage(handleCreateWorld, handleJoinWorld);
});

// --- Host Logic (II.B.3, II.D.3, II.D.4) ---
function handleCreateWorld() {
    console.log('Attempting to create world...');
    isHost = true;
    initializePeer({
        onPeerConnected: setupHost,
        onDataReceived: handleHostData,
        onClientConnected: handleClientConnect,
        onClientDisconnected: handleClientDisconnect
    });
}

function setupHost(peerId) {
    console.log(`Host peer ready with ID: ${peerId}`);
    localPeerId = peerId;
    setAsHost();

    // Display session key (II.A.2)
    const sessionInfoDiv = document.getElementById('session-info'); // Changed ID
    const sessionKeyElement = document.getElementById('session-key');
    if (sessionInfoDiv && sessionKeyElement) {
        sessionKeyElement.textContent = peerId;
        sessionInfoDiv.classList.remove('hidden'); // Use classList
        sessionInfoDiv.style.display = 'block'; // Ensure it's block display
    }

    // Generate dungeon (II.C.1)
    dungeon = generateDungeon();

    // Add host player to state
    addPlayer(localPeerId);

    // Show and render initial game view (II.A.2, II.A.4)
    showGameView();
    updateGameView(dungeon, gameState.players);

    // Initialize input (II.C.3)
    initInput(handleLocalMovementInput);
    // --- Add Logging --- 
    console.log('[App] Calling setupTouchControls from setupHost...');
    // --- End Logging --- 
    setupTouchControls(handleLocalMovementInput); 
}

function handleClientConnect(clientPeerId) {
    console.log(`Client connected: ${clientPeerId}`);
    if (gameState.players.length >= PLAYER_COLORS.length) {
        console.warn(`Max players reached. Connection from ${clientPeerId} ignored.`);
        // TODO: Optionally send a 'game full' message and close connection
        return;
    }
    // Add new player to state (II.C.2)
    addPlayer(clientPeerId);
    // Broadcast updated state to everyone (including the new client) (II.D.4)
    broadcastGameState();
}

function handleClientDisconnect(clientPeerId) {
    console.log(`Client disconnected: ${clientPeerId}`);
    removePlayer(clientPeerId);
    // Broadcast updated state (II.D.4)
    broadcastGameState();
}

function handleHostData(data, senderPeerId) {
    console.log(`Host received data from ${senderPeerId}:`, data);
    if (data.type === 'move') {
        // Process client movement input (II.D.3)
        processMovement(senderPeerId, data.direction);
    } else if (data.type === 'requestInitialState') {
        // Client is requesting the current state after connecting
        sendCurrentStateToClient(senderPeerId);
    }
}

// --- Client Logic (II.B.4, II.D.5) ---
function handleJoinWorld(sessionKey) {
    console.log(`Attempting to join world with key: ${sessionKey}`);
    isHost = false;
    initializePeer({
        onPeerConnected: (peerId) => {
            localPeerId = peerId;
            console.log(`Client peer ready with ID: ${peerId}. Connecting to host ${sessionKey}...`);
            connectToHost(sessionKey)
                .then(() => {
                    console.log('Connection attempt initiated.');
                    // Wait for onHostConnected callback
                })
                .catch(err => {
                    console.error('Failed to initiate connection:', err);
                    alert(`Failed to connect to host: ${err}. Please check the key and try again.`);
                    // TODO: Go back to landing page?
                    window.location.reload();
                });
        },
        onDataReceived: handleClientData,
        onHostConnected: setupClient // Called when connection to host is open
    });
}

function setupClient() {
    console.log('Successfully connected to host.');
    // Generate dungeon locally (II.C.1)
    dungeon = generateDungeon();
    // Show game view (II.A.3)
    showGameView();
    // Initialize input (II.C.3) - sends data to host
    initInput(handleLocalMovementInput);
    // --- Add Logging --- 
    console.log('[App] Calling setupTouchControls from setupClient...');
    // --- End Logging --- 
    setupTouchControls(handleLocalMovementInput); 
    // Client waits for the first gameStateUpdate from the host to render
    // Request initial state from host upon connection
    const hostPeerId = getHostPeerId();
    if (hostPeerId) {
        console.log("Requesting initial state from host...");
        sendData(hostPeerId, { type: 'requestInitialState' });
    }
}

function handleClientData(data, senderPeerId) {
    // console.log(`Client received data from ${senderPeerId}:`, data);
    if (data.type === 'gameStateUpdate') {
        // Update local state based on host broadcast (II.D.5)
        gameState = data.state;
        // Re-render the game view
        if (dungeon) { // Ensure dungeon is generated before rendering
             updateGameView(dungeon, gameState.players);
        } else {
            console.warn('Received game state update before dungeon was generated.');
        }
    } else {
        console.warn('Received unknown data type from host:', data);
    }
}

// --- Shared Logic ---

function addPlayer(peerId) {
    if (gameState.players.some(p => p.id === peerId)) {
        console.warn(`Player ${peerId} already exists.`);
        return;
    }
    if (gameState.players.length >= PLAYER_COLORS.length) {
        console.warn(`Cannot add player ${peerId}, maximum players reached.`);
        return;
    }

    const color = PLAYER_COLORS[gameState.players.length];
    // Simple initial position - near top-left, offset by player count
    const initialPos = { x: 1 + gameState.players.length, y: 1 };

    gameState.players.push({
        id: peerId,
        x: initialPos.x,
        y: initialPos.y,
        color: color
    });
    console.log(`Player ${peerId} added with color ${color} at (${initialPos.x}, ${initialPos.y})`);
}

function removePlayer(peerId) {
    const index = gameState.players.findIndex(p => p.id === peerId);
    if (index !== -1) {
        gameState.players.splice(index, 1);
        console.log(`Player ${peerId} removed.`);
        // Re-assign colors? For simplicity, no. Colors are now potentially non-contiguous.
    } else {
        console.warn(`Player ${peerId} not found for removal.`);
    }
}

function handleLocalMovementInput(direction) {
    if (!localPeerId) return;

    if (isHost) {
        // Host processes its own input directly (II.D.3)
        processMovement(localPeerId, direction);
    } else {
        // Client sends input to host (II.D.2)
        const hostPeerId = getHostPeerId();
        if (hostPeerId) {
            console.log(`Client sending move '${direction}' to host ${hostPeerId}`);
            sendData(hostPeerId, { type: 'move', direction: direction });
        } else {
            console.error('Client cannot send input: Host Peer ID not known.');
        }
    }
}

function processMovement(playerId, direction) {
    const player = gameState.players.find(p => p.id === playerId);
    if (!player) {
        console.warn(`[processMovement] Cannot process movement for unknown player ${playerId}`);
        return;
    }

    let targetX = player.x;
    let targetY = player.y;

    switch (direction) {
        case 'up':    targetY--; break;
        case 'down':  targetY++; break;
        case 'left':  targetX--; break;
        case 'right': targetX++; break;
    }

    // --- Add Logging --- 
    console.log(`[processMovement] Player ${playerId} attempting move ${direction} to (${targetX}, ${targetY}). Current: (${player.x}, ${player.y})`);

    const walkable = isWalkable(dungeon, targetX, targetY);
    const occupied = isOccupied(targetX, targetY);
    console.log(`[processMovement] Validation: walkable=${walkable}, occupied=${occupied}`);
    // --- End Logging --- 

    // Validate move (II.D.3)
    if (walkable && !occupied) {
        player.x = targetX;
        player.y = targetY;
        // --- Add Logging --- 
        console.log(`[processMovement] Player ${playerId} VALID move to (${targetX}, ${targetY}). Broadcasting state.`);
        // --- End Logging --- 
        // Host broadcasts the new state after any valid move
        broadcastGameState();
    } else {
        // --- Add Logging --- 
        console.log(`[processMovement] Player ${playerId} INVALID move to (${targetX}, ${targetY})`);
        // --- End Logging --- 
        // Invalid move, do nothing (SOW II.D.3)
    }
}

// Check if a cell is occupied by another player
function isOccupied(x, y) {
    return gameState.players.some(p => p.x === x && p.y === y);
}

// Host broadcasts the current game state to all clients (II.D.4)
function broadcastGameState() {
    if (!isHost) return;

    const stateMessage = {
        type: 'gameStateUpdate',
        state: gameState
    };
    // console.log('Host broadcasting state:', stateMessage); // Can be noisy
    broadcastData(stateMessage);

    // Host also needs to update its own view
    updateGameView(dungeon, gameState.players);
}

// Host sends the current game state to a specific client (e.g., upon connection)
function sendCurrentStateToClient(clientPeerId) {
    if (!isHost) return;

    const stateMessage = {
        type: 'gameStateUpdate',
        state: gameState
    };
    console.log(`Host sending initial state to ${clientPeerId}:`, stateMessage);
    sendData(clientPeerId, stateMessage);
}
