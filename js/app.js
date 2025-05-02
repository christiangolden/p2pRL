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
let localPlayerColor = null; // Track current player's color for chat
let hostPeerId = null; // Store the host peer ID for all players

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
    hostPeerId = peerId; // Host stores its own peer ID
    setAsHost();

    // Display session key (II.A.2)
    const sessionInfoDiv = document.getElementById('session-info');
    const sessionKeyElement = document.getElementById('session-key');
    const copyFeedback = document.getElementById('copy-feedback');
    
    if (sessionInfoDiv && sessionKeyElement) {
        sessionKeyElement.textContent = peerId;
        sessionInfoDiv.classList.remove('hidden');
        sessionInfoDiv.style.display = 'block'; // Ensure it's block display
        
        // Add clipboard copy functionality
        sessionKeyElement.addEventListener('click', () => copyToClipboard(peerId, copyFeedback));
        sessionKeyElement.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                copyToClipboard(peerId, copyFeedback);
            }
        });
    }

    // Set up Share Key button
    setupShareKeyButton(peerId);

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

    // Set up Chat box (for all players, but activated here for host)
    setupChatBox();
}

// Helper function to copy text to clipboard
function copyToClipboard(text, feedbackElement = null) {
    // Use the modern Clipboard API if available
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text)
            .then(() => {
                if (feedbackElement) {
                    showCopyFeedback(feedbackElement);
                }
            })
            .catch(err => console.error('Could not copy text: ', err));
    } else {
        // Fallback for older browsers
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';  // Avoid scrolling to bottom
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();

        try {
            const successful = document.execCommand('copy');
            if (successful && feedbackElement) {
                showCopyFeedback(feedbackElement);
            } else if (!successful) {
                console.error('Failed to copy');
            }
        } catch (err) {
            console.error('Error copying text: ', err);
        }

        document.body.removeChild(textArea);
    }
}

// Show the copy feedback message
function showCopyFeedback(feedbackElement) {
    if (feedbackElement) {
        feedbackElement.classList.remove('hidden');
        feedbackElement.style.display = 'block';
        feedbackElement.style.opacity = '1';
        
        // Reset animation
        feedbackElement.style.animation = 'none';
        feedbackElement.offsetHeight; // Trigger reflow
        feedbackElement.style.animation = 'fadeOut 1.5s forwards';
        feedbackElement.style.animationDelay = '1.5s';
        
        // Hide after animation completes
        setTimeout(() => {
            feedbackElement.classList.add('hidden');
        }, 3000);
    }
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
    } else if (data.type === 'chat') {
        // Process incoming chat message
        processChatMessage(data, senderPeerId);
    }
}

// --- Client Logic (II.B.4, II.D.5) ---
function handleJoinWorld(sessionKey) {
    console.log(`Attempting to join world with key: ${sessionKey}`);
    isHost = false;
    hostPeerId = sessionKey; // Store the host peer ID
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
    
    // Setup share key button for clients as well
    setupShareKeyButton(hostPeerId);
    
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
    // Use the global hostPeerId variable that was already set in handleJoinWorld
    if (hostPeerId) {
        console.log("Requesting initial state from host...");
        sendData(hostPeerId, { type: 'requestInitialState' });
    } else {
        console.error("Host peer ID not found. Cannot request initial state.");
    }

    // Set up Chat box for client
    setupChatBox();
}

function handleClientData(data, senderPeerId) {
    // console.log(`Client received data from ${senderPeerId}:`, data);
    if (data.type === 'gameStateUpdate') {
        // Make sure data.state exists before using it
        if (data.state) {
            // Update local state based on host broadcast (II.D.5)
            gameState = data.state;
            // Re-render the game view
            if (dungeon) { // Ensure dungeon is generated before rendering
                 updateGameView(dungeon, gameState.players);
            } else {
                console.warn('Received game state update before dungeon was generated.');
            }
        } else {
            console.error('Received gameStateUpdate without valid state data');
        }
    } else if (data.type === 'gameFullError') {
        // Handle the game full error by showing a message and redirecting back to landing
        console.error('Game is full:', data.message);
        
        // Create and show a notification to the user
        const notification = document.createElement('div');
        notification.className = 'connection-notification';
        
        const message = document.createElement('p');
        message.textContent = data.message + ' Would you like to create your own game instead?';
        
        const buttonContainer = document.createElement('div');
        
        const createButton = document.createElement('button');
        createButton.textContent = 'Create a Game';
        createButton.addEventListener('click', () => {
            document.body.removeChild(notification);
            // Reload the page and handle create world
            window.location.reload();
            // The user will need to click "Create World" again, but it's simpler than
            // trying to switch modes on the fly
        });
        
        const cancelButton = document.createElement('button');
        cancelButton.textContent = 'Cancel';
        cancelButton.addEventListener('click', () => {
            document.body.removeChild(notification);
            window.location.reload(); // Reload the page to reset the application state
        });
        
        cancelButton.style.marginLeft = '10px';
        cancelButton.style.backgroundColor = '#888';
        
        buttonContainer.appendChild(createButton);
        buttonContainer.appendChild(cancelButton);
        
        notification.appendChild(message);
        notification.appendChild(buttonContainer);
        
        document.body.appendChild(notification);
        
    } else if (data.type === 'chat') {
        // Process incoming chat message
        processChatMessage(data, data.sender); // Use the sender ID from the message
    } else if (data.type === 'assignKey') {
        // Handle the assignKey message from host
        console.log(`Received key assignment from host: ${data.key} with color ${data.color}`);
        // Store the assigned key and color for future reference if needed
        const assignedKey = data.key;
        const assignedColor = data.color;
        // You might want to display this information to the user or use it elsewhere
    } else {
        console.warn('Received unknown data type from host:', data);
    }
}

// --- Shared Logic ---

// Setup the Share Key button for all players
function setupShareKeyButton(sessionKey) {
    const shareKeyContainer = document.getElementById('share-key-container');
    const shareKeyBtn = document.getElementById('share-key-btn');
    
    if (shareKeyContainer && shareKeyBtn) {
        // Show the button for all players (not just host)
        shareKeyContainer.classList.remove('hidden');
        
        // Add click handler to copy session key
        shareKeyBtn.addEventListener('click', () => {
            // Check if maximum players has been reached before sharing
            if (gameState.players.length >= PLAYER_COLORS.length) {
                showGameNotification('Maximum players reached, cannot share key.');
                return;
            }
            
            copyToClipboard(sessionKey);
            // Show in-game notification
            showGameNotification('Session key copied to clipboard!');
        });
    }
}

function addPlayer(peerId) {
    if (gameState.players.some(p => p.id === peerId)) {
        console.warn(`Player ${peerId} already exists.`);
        return;
    }
    if (gameState.players.length >= PLAYER_COLORS.length) {
        console.warn(`Cannot add player ${peerId}, maximum players reached.`);
        return;
    }

    // Find the first available color from the PLAYER_COLORS array
    // that's not currently being used by any player
    let availableColor = null;
    
    // Check each color to see if it's available
    for (const color of PLAYER_COLORS) {
        // If no player is currently using this color, it's available
        if (!gameState.players.some(p => p.color === color)) {
            availableColor = color;
            break; // Found an available color, stop searching
        }
    }
    
    // If no color is available (shouldn't happen with our player limit check), use the next one
    if (!availableColor) {
        availableColor = PLAYER_COLORS[gameState.players.length];
    }

    // Find a random unoccupied location within the dungeon
    let initialPos = findUnoccupiedLocation();
    
    gameState.players.push({
        id: peerId,
        x: initialPos.x,
        y: initialPos.y,
        color: availableColor
    });
    
    console.log(`Player ${peerId} added with color ${availableColor} at (${initialPos.x}, ${initialPos.y})`);
    
    // For host-to-client communication, send the client their assigned key and color
    if (isHost && peerId !== localPeerId) {
        console.log(`Host sending key assignment to client ${peerId} with color ${availableColor}`);
        sendData(peerId, { 
            type: 'assignKey', 
            key: peerId,
            color: availableColor 
        });
    }
}

// Find a random unoccupied location in the dungeon
function findUnoccupiedLocation() {
    // Create a list of all walkable and unoccupied positions
    const validPositions = [];
    
    // Scan the entire dungeon and collect all valid positions
    for (let y = 1; y < dungeon.length - 1; y++) {
        for (let x = 1; x < dungeon[0].length - 1; x++) {
            if (isWalkable(dungeon, x, y) && !isOccupied(x, y)) {
                validPositions.push({ x, y });
            }
        }
    }
    
    // If we found valid positions, pick one randomly
    if (validPositions.length > 0) {
        const randomIndex = Math.floor(Math.random() * validPositions.length);
        return validPositions[randomIndex];
    }
    
    // Fallback - this should never happen unless the dungeon is completely full
    console.warn("Could not find any unoccupied location in the dungeon!");
    return { x: 1, y: 1 };
}

// Check if a location is already occupied by another player
function isOccupied(x, y) {
    return gameState.players.some(player => player.x === x && player.y === y);
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

// Show a temporary notification in the game view
function showGameNotification(message) {
    // Create notification element if it doesn't exist
    let notificationElement = document.getElementById('game-notification');
    if (!notificationElement) {
        notificationElement = document.createElement('div');
        notificationElement.id = 'game-notification';
        document.body.appendChild(notificationElement);
    }
    
    // Set the message and show the notification
    notificationElement.textContent = message;
    notificationElement.className = 'game-notification show';
    
    // Hide after 3 seconds
    setTimeout(() => {
        notificationElement.className = 'game-notification';
    }, 3000);
}

// Set up the chat functionality
function setupChatBox() {
    const chatContainer = document.getElementById('chat-container');
    const chatInput = document.getElementById('chat-input');
    const chatSendBtn = document.getElementById('chat-send-btn');
    
    if (chatContainer && chatInput && chatSendBtn) {
        // Show chat container
        chatContainer.classList.remove('hidden');
        
        // Send button click handler
        chatSendBtn.addEventListener('click', () => sendChatMessage());
        
        // Enter key handler
        chatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                sendChatMessage();
            }
        });
        
        // Add system message that chat is ready
        addChatMessage('System', 'Chat is now active. Be nice!', 'system');
    }
}

// Send a chat message to all peers
function sendChatMessage() {
    const chatInput = document.getElementById('chat-input');
    if (!chatInput || !chatInput.value.trim()) return;
    
    const message = chatInput.value.trim();
    chatInput.value = '';
    
    // Find player's color based on peerId
    const currentPlayer = gameState.players.find(p => p.id === localPeerId);
    localPlayerColor = currentPlayer ? currentPlayer.color : 'unknown';
    
    // Add message to local chat (as 'self' type)
    addChatMessage('You', message, 'self');
    
    // Create message data object
    const chatData = {
        type: 'chat',
        sender: localPeerId,
        senderColor: localPlayerColor,
        message: message,
        isInitialBroadcast: true // Flag to track initial broadcast
    };
    
    // Send message based on role
    if (isHost) {
        // Host broadcasts to all clients
        broadcastData(chatData);
    } else {
        // Client sends to host
        const hostPeerId = getHostPeerId();
        if (hostPeerId) {
            sendData(hostPeerId, chatData);
        }
    }
}

// Add a chat message to the UI - updated for traditional chat style (newest at bottom)
function addChatMessage(sender, message, messageType = '', playerColor = null) {
    const chatMessages = document.getElementById('chat-messages');
    if (!chatMessages) return;
    
    const messageElement = document.createElement('div');
    
    // Apply appropriate classes based on message type and player color
    if (messageType === 'system') {
        messageElement.className = 'chat-message system';
    } else if (messageType === 'self') {
        // For own messages, always use own player color
        const currentPlayer = gameState.players.find(p => p.id === localPeerId);
        const myColor = currentPlayer ? currentPlayer.color : null;
        messageElement.className = `chat-message self player-${myColor}`;
    } else {
        // For messages from others, use their specific player color
        messageElement.className = `chat-message player-${playerColor}`;
    }
    
    // Format based on message type
    if (messageType === 'system') {
        // For system messages, simple text in the center
        messageElement.textContent = message;
    } else {
        // For your own and other messages
        messageElement.textContent = message;
    }
    
    // Add to bottom (append to container)
    chatMessages.appendChild(messageElement);
    
    // Auto-scroll to the newest message
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Process a chat message received via the network
function processChatMessage(data, senderPeerId) {
    console.log('Processing chat message:', data);
    
    // Find the sender player's information to get their color
    const senderPlayer = gameState.players.find(p => p.id === senderPeerId);
    const senderColor = senderPlayer ? senderPlayer.color : null;
    
    // If this is our own message coming back from the host, don't add it again
    if (senderPeerId === localPeerId && !data.isFromHost) {
        return;
    }
    
    // Add the message to the UI if it's not from ourselves
    if (senderPeerId !== localPeerId || data.isFromHost) {
        addChatMessage(senderPeerId, data.message, 'other', senderColor);
    }
    
    // Only the host should rebroadcast messages to everyone else
    if (isHost) {
        // Host received a message from a client, broadcast to all other clients
        const messageToRelay = {
            type: 'chat',
            sender: senderPeerId,
            message: data.message,
            senderColor: senderColor,
            isFromHost: true // Mark as coming from host to avoid duplicate display
        };
        
        // Get all client peer IDs to broadcast to
        const clientPeerIds = getClientPeerIds();
        
        // Broadcast to all clients except the sender
        clientPeerIds.forEach(clientId => {
            if (clientId !== senderPeerId) {
                sendData(clientId, messageToRelay);
            }
        });
    }
}
