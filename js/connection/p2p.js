// SOW II.B: Handles WebRTC connection using PeerJS

// Use the public PeerJS signaling server (SOW II.B.2)
const PEER_CONFIG = { 
    // debug: 2 // Uncomment for verbose PeerJS logging
    // No key needed for cloud server, host/port default to PeerServer cloud
    // STUN server config (SOW II.B.2, III.3.3)
    config: {
        'iceServers': [
            { urls: 'stun:stun.l.google.com:19302' },
            // Add more STUN servers if needed
        ]
    }
};

// Connection persistence configuration
const CONNECTION_CONFIG = {
    heartbeatInterval: 2000,    // Reduced from 3000ms to 2000ms for quicker detection
    missedHeartbeatsLimit: 2,   // Number of consecutive missed heartbeats before considering disconnection
    reconnectAttempts: 3,       // Number of reconnect attempts
    reconnectDelay: 2000        // Milliseconds between reconnect attempts
};

// Global variables
let peer = null;
let connections = {};
let hostConnection = null;
let isHostPeer = false;
let hostConnectionListener = null;
let callbackConfig = {
    onPeerConnected: () => {},
    onHostConnected: () => {},
    onHostDisconnected: () => {},
    onClientConnected: () => {},
    onClientDisconnected: () => {},
    onDataReceived: () => {},
    onColorRecycled: () => {},  // New callback for color recycling
};

// Add these variables near the top with other globals
let usedKeys = new Set();
let playerData = new Map(); // Store player data including their key

// Player color management
const PLAYER_COLORS = ['red', 'blue', 'green', 'yellow'];
let availableColors = [...PLAYER_COLORS]; // Copy of colors to assign
let colorQueue = []; // Queue of colors from disconnected players to reuse first
// Track which player has which color for recycling
let playerColorMap = new Map();

// Connection monitoring variables
let connectionMonitorInterval = null;
const CONNECTION_HEALTH_CHECK_INTERVAL = 3000; // Reduced from 5000ms to 3000ms
const CONNECTION_TIMEOUT = 6000; // Reduced from 10000ms to 6000ms
const CONNECTION_MISSED_PING_LIMIT = 2; // Number of consecutive missed pings before considering disconnected
const connectionLastActivity = {}; // Track last activity timestamp for each connection
const heartbeatIntervals = {}; // Track heartbeat intervals for each connection
const missedPingCounter = {}; // Track number of consecutive missed pings

// Initialize the Peer.js instance with callbacks
export function initializePeer(callbacks) {
    // Store the callbacks for later use
    if (callbacks) {
        callbackConfig = { ...callbackConfig, ...callbacks };
    }

    // Create a new Peer instance (server-broker connection)
    peer = new Peer(null, {
        debug: 2, // 0 = no logs, 3 = all logs
    });

    // Set up event handlers for the Peer connection
    peer.on('open', (id) => {
        console.log('Connected to signaling server with ID:', id);
        callbackConfig.onPeerConnected(id);
    });

    peer.on('connection', (conn) => {
        console.log('Incoming connection from:', conn.peer);
        handleIncomingConnection(conn);
    });

    peer.on('error', (err) => {
        console.error('Peer error:', err);
        // Specific error handling for disconnection
        if (err.type === 'peer-unavailable') {
            console.error('Peer unavailable. Connection attempt failed.');
        } else if (err.type === 'network' || err.type === 'server-error') {
            console.error('Network or server error. Connection might be unstable.');
        } else if (err.type === 'disconnected') {
            // Handle disconnection error by checking all connections
            checkAllConnections();
        }
    });

    peer.on('disconnected', () => {
        console.log('Disconnected from signaling server. Attempting to reconnect...');
        // Attempt to reconnect to signaling server
        peer.reconnect();
    });
    
    // Start connection monitoring
    startConnectionMonitoring();
    
    return peer;
}

// Get the next available color for a player
function getNextPlayerColor() {
    console.log(`Color assignment - Queue: [${colorQueue}], Available: [${availableColors}]`);
    
    // First use colors from the queue (colors from disconnected players)
    if (colorQueue.length > 0) {
        const color = colorQueue.shift(); // Get the first color in the queue (FIFO)
        console.log(`Assigned recycled color: ${color}`);
        return color;
    }
    
    // If queue is empty, use remaining available colors
    if (availableColors.length > 0) {
        const color = availableColors.shift();
        console.log(`Assigned new color: ${color}`);
        return color;
    }
    
    // If all colors are used, return a default color
    console.warn('All player colors are in use, using default color');
    return 'gray';
}

// Return a color to the queue when a player disconnects
function recyclePlayerColor(color) {
    if (color && PLAYER_COLORS.includes(color)) {
        console.log(`Recycling color: ${color}`);
        // Remove any duplicates of this color in the queue first
        colorQueue = colorQueue.filter(c => c !== color);
        // Add to the front of the queue so it's used first
        colorQueue.unshift(color); 
        console.log(`Color queue after recycling: [${colorQueue}]`);
        callbackConfig.onColorRecycled(color); // Trigger the callback for color recycling
    }
}

// Reset color system (useful when host disconnects/game resets)
function resetColorSystem() {
    availableColors = [...PLAYER_COLORS];
    colorQueue = [];
}

// Start the connection monitoring system
function startConnectionMonitoring() {
    // Clear any existing interval
    if (connectionMonitorInterval) {
        clearInterval(connectionMonitorInterval);
    }
    
    // Set up the monitoring interval
    connectionMonitorInterval = setInterval(() => {
        checkConnections();
    }, CONNECTION_HEALTH_CHECK_INTERVAL);
    
    console.log('Connection monitoring started');
}

// Check all connections immediately (used when error events occur)
function checkAllConnections() {
    console.log('Running immediate connection check for all peers');
    if (isHostPeer) {
        Object.keys(connections).forEach(clientId => {
            validateConnection(clientId);
        });
    } else if (hostConnection) {
        validateHostConnection();
    }
}

// Validate a specific client connection
function validateConnection(clientId) {
    if (!connections[clientId]) return;
    
    const conn = connections[clientId];
    if (!conn.open || !conn.peerConnection || conn.peerConnection.iceConnectionState === 'disconnected' ||
        conn.peerConnection.iceConnectionState === 'failed' || conn.peerConnection.iceConnectionState === 'closed') {
        console.log(`Connection to ${clientId} appears to be broken (state: ${conn.peerConnection ? conn.peerConnection.iceConnectionState : 'unknown'})`);
        handleDisconnection(clientId);
        return false;
    }
    return true;
}

// Validate host connection
function validateHostConnection() {
    if (!hostConnection) return false;
    
    if (!hostConnection.open || !hostConnection.peerConnection || 
        hostConnection.peerConnection.iceConnectionState === 'disconnected' || 
        hostConnection.peerConnection.iceConnectionState === 'failed' || 
        hostConnection.peerConnection.iceConnectionState === 'closed') {
        console.log(`Host connection appears to be broken (state: ${hostConnection.peerConnection ? hostConnection.peerConnection.iceConnectionState : 'unknown'})`);
        handleHostDisconnection();
        return false;
    }
    return true;
}

// Check all connections for activity/timeout
function checkConnections() {
    const now = Date.now();
    
    // Check client connections if we're the host
    if (isHostPeer) {
        Object.keys(connections).forEach(clientId => {
            const lastActivity = connectionLastActivity[clientId] || 0;
            const inactiveTime = now - lastActivity;
            
            if (inactiveTime > CONNECTION_TIMEOUT) {
                console.log(`Client ${clientId} appears to be inactive for ${inactiveTime}ms. Validating connection...`);
                if (!validateConnection(clientId)) {
                    return; // Connection was invalid and has been handled
                }
                
                // If connection is still valid, send a ping
                try {
                    sendPing(clientId);
                } catch (err) {
                    console.error(`Error sending ping to ${clientId}:`, err);
                    handleDisconnection(clientId);
                }
            }
        });
    } 
    // Check host connection if we're a client
    else if (hostConnection) {
        const lastActivity = connectionLastActivity['host'] || 0;
        const inactiveTime = now - lastActivity;
        
        if (inactiveTime > CONNECTION_TIMEOUT) {
            console.log(`Host appears to be inactive for ${inactiveTime}ms. Validating connection...`);
            if (!validateHostConnection()) {
                return; // Connection was invalid and has been handled
            }
            
            // If connection is still valid, send a ping
            try {
                sendPingToHost();
            } catch (err) {
                console.error('Error sending ping to host:', err);
                handleHostDisconnection();
            }
        }
    }
}

// Send a ping to a specific client
function sendPing(peerId) {
    if (!connections[peerId] || !connections[peerId].open) {
        console.warn(`Cannot send ping: Connection to ${peerId} is not open`);
        handleDisconnection(peerId);
        return;
    }
    
    // Initialize or increment missed ping counter
    if (!missedPingCounter[peerId]) {
        missedPingCounter[peerId] = 0;
    } else {
        missedPingCounter[peerId]++;
    }
    
    // If we've hit the missed ping limit, consider the peer disconnected
    if (missedPingCounter[peerId] >= CONNECTION_MISSED_PING_LIMIT) {
        console.warn(`Client ${peerId} has missed ${missedPingCounter[peerId]} consecutive pings. Considering disconnected.`);
        handleDisconnection(peerId);
        return;
    }
    
    try {
        connections[peerId].send({
            type: 'ping',
            timestamp: Date.now(),
            pingId: Math.random().toString(36).substring(2, 10) // Add a unique ID to each ping
        });
        console.log(`Ping sent to client ${peerId}`);
    } catch (err) {
        console.error(`Error sending ping to ${peerId}:`, err);
        handleDisconnection(peerId);
    }
}

// Send a ping to the host
function sendPingToHost() {
    if (!hostConnection || !hostConnection.open) {
        console.warn('Cannot send ping: Host connection is not open');
        handleHostDisconnection();
        return;
    }
    
    // Initialize or increment missed ping counter
    if (!missedPingCounter['host']) {
        missedPingCounter['host'] = 0;
    } else {
        missedPingCounter['host']++;
    }
    
    // If we've hit the missed ping limit, consider the host disconnected
    if (missedPingCounter['host'] >= CONNECTION_MISSED_PING_LIMIT) {
        console.warn(`Host has missed ${missedPingCounter['host']} consecutive pings. Considering disconnected.`);
        handleHostDisconnection();
        return;
    }
    
    try {
        hostConnection.send({
            type: 'ping',
            timestamp: Date.now(),
            pingId: Math.random().toString(36).substring(2, 10) // Add unique ID to each ping
        });
        console.log('Ping sent to host');
    } catch (err) {
        console.error('Error sending ping to host:', err);
        handleHostDisconnection();
    }
}

// Update the activity timestamp for a connection
function updateActivityTimestamp(peerId) {
    connectionLastActivity[peerId] = Date.now();
}

// Start sending regular heartbeats to a connection
function startHeartbeat(peerId) {
    // Clear any existing heartbeat interval for this peer
    if (heartbeatIntervals[peerId]) {
        clearInterval(heartbeatIntervals[peerId]);
    }
    
    // Set up a new heartbeat interval
    heartbeatIntervals[peerId] = setInterval(() => {
        if (isHostPeer && connections[peerId]) {
            sendPing(peerId);
        } else if (!isHostPeer && peerId === 'host' && hostConnection) {
            sendPingToHost();
        }
    }, CONNECTION_CONFIG.heartbeatInterval);
    
    console.log(`Started heartbeat for ${peerId}`);
}

// Handle an incoming connection from a client
function handleIncomingConnection(conn) {
    const clientPeerId = conn.peer;
    
    // Check if this is a capacity check connection (lightweight check)
    if (conn.metadata && conn.metadata.capacityCheck) {
        conn.on('open', () => {
            console.log(`Received capacity check from ${clientPeerId}`);
            
            conn.on('data', (data) => {
                if (data.type === 'checkCapacity') {
                    // Check if we have space for more players
                    const playerCount = Object.keys(connections).length + 1; // +1 for host
                    const isFull = playerCount >= PLAYER_COLORS.length;
                    
                    // Send the response with current capacity info
                    conn.send({
                        type: 'capacityResponse',
                        isFull: isFull,
                        playerCount: playerCount
                    });
                }
            });
        });
        
        return; // Skip normal connection handling for capacity checks
    }
    
    // Check if the maximum player count has been reached
    if (isHostPeer && Object.keys(connections).length >= PLAYER_COLORS.length - 1) {
        console.warn(`Maximum players (${PLAYER_COLORS.length}) reached. Rejecting connection from ${clientPeerId}`);
        
        // Accept the connection so we can send the rejection message
        conn.on('open', () => {
            // Send a rejection message to the client
            conn.send({
                type: 'gameFullError',
                message: 'This game already has the maximum number of players.'
            });
            
            // Close the connection after sending the message
            setTimeout(() => {
                try {
                    conn.close();
                } catch (err) {
                    console.error(`Error closing connection to ${clientPeerId}:`, err);
                }
            }, 1000);
        });
        
        return;
    }
    
    // Generate a new key for this client
    const clientKey = generateUniqueKey();
    
    // Assign the next available color for this client
    const playerColor = getNextPlayerColor();
    
    playerData.set(clientKey, { 
        peerId: clientPeerId, 
        isHost: false,
        color: playerColor 
    });
    
    // Track which player has which color
    playerColorMap.set(clientPeerId, playerColor);
    
    conn.on('open', () => {
        console.log(`Connection with client ${clientPeerId} is now open.`);
        connections[clientPeerId] = conn;
        updateActivityTimestamp(clientPeerId);
        
        // Start sending heartbeats to this client
        startHeartbeat(clientPeerId);
        
        // Send the client their assigned key and color
        conn.send({ 
            type: 'assignKey', 
            key: clientKey,
            color: playerColor 
        });
        
        callbackConfig.onClientConnected(clientPeerId);
    });

    conn.on('data', (data) => {
        // Update activity timestamp on data received
        updateActivityTimestamp(clientPeerId);
        
        // Handle ping messages specially
        if (data.type === 'ping') {
            // Respond to ping with a pong that includes the original ping ID
            conn.send({ 
                type: 'pong', 
                timestamp: data.timestamp,
                pingId: data.pingId // Echo back the ping ID for correlation
            });
            return;
        } else if (data.type === 'pong') {
            // Reset missed ping counter when we receive a pong
            missedPingCounter[clientPeerId] = 0;
            console.log(`Received pong from client ${clientPeerId}, connection confirmed active`);
            return;
        }
        
        // Pass other data to the callback
        console.log(`Data received from client ${clientPeerId}:`, data);
        callbackConfig.onDataReceived(data, clientPeerId);
    });

    conn.on('close', () => {
        console.log(`Connection with client ${clientPeerId} closed.`);
        handleDisconnection(clientPeerId);
    });

    conn.on('error', (err) => {
        console.error(`Error in connection with client ${clientPeerId}:`, err);
        handleDisconnection(clientPeerId);
    });
}

// Set up the peer as a host
export function setAsHost() {
    isHostPeer = true;
    const hostKey = generateUniqueKey();
    
    // Reset the color system when setting up as host
    resetColorSystem();
    
    // Host always gets the first color (typically red)
    const hostColor = getNextPlayerColor();
    
    playerData.set(hostKey, { 
        peerId: peer.id, 
        isHost: true,
        color: hostColor
    });
    
    console.log('This peer is now set as the host. Key:', hostKey);
    return hostKey;
}

// Connect to a host peer
export function connectToHost(hostPeerId) {
    return new Promise((resolve, reject) => {
        if (!peer) {
            reject(new Error('Peer not initialized.'));
            return;
        }

        console.log(`Attempting to connect to host ${hostPeerId}...`);
        const conn = peer.connect(hostPeerId);
        
        if (!conn) {
            reject(new Error('Connection attempt failed.'));
            return;
        }

        conn.on('open', () => {
            console.log(`Connected to host ${hostPeerId}.`);
            hostConnection = conn;
            updateActivityTimestamp('host');
            
            // Start sending heartbeats to the host
            startHeartbeat('host');
            
            callbackConfig.onHostConnected();
            resolve();
        });

        conn.on('data', (data) => {
            // Update activity timestamp on data received
            updateActivityTimestamp('host');
            
            // Handle ping/pong messages
            if (data.type === 'ping') {
                // Respond to ping with a pong that includes the original ping ID
                conn.send({ 
                    type: 'pong', 
                    timestamp: data.timestamp,
                    pingId: data.pingId // Echo back the ping ID for correlation 
                });
                return;
            } else if (data.type === 'pong') {
                // Reset missed ping counter when we receive a pong
                missedPingCounter['host'] = 0;
                console.log('Received pong from host, connection confirmed active');
                return;
            }
            
            // Pass other data to the callback
            console.log('Data received from host:', data);
            callbackConfig.onDataReceived(data, hostPeerId);
        });

        conn.on('close', () => {
            console.log('Connection to host closed.');
            handleHostDisconnection();
        });

        conn.on('error', (err) => {
            console.error('Error in connection to host:', err);
            if (!hostConnection) {
                // If we haven't established a connection yet, reject the promise
                reject(err);
            } else {
                // Otherwise handle as a disconnection
                handleHostDisconnection();
            }
        });

        // Set a timeout for the connection attempt
        setTimeout(() => {
            if (!hostConnection) {
                reject(new Error('Connection timeout. Host not responding.'));
            }
        }, 10000); // 10 seconds timeout
    });
}

// Send data to a specific peer
export function sendData(peerId, data) {
    if (isHostPeer) {
        // Host sending to a client
        if (!connections[peerId]) {
            console.warn(`Cannot send data: No connection to peer ${peerId}`);
            return false;
        }
        
        if (!connections[peerId].open) {
            console.warn(`Cannot send data: Connection to peer ${peerId} is not open`);
            handleDisconnection(peerId);
            return false;
        }
        
        try {
            connections[peerId].send(data);
            updateActivityTimestamp(peerId);
            return true;
        } catch (err) {
            console.error(`Error sending data to ${peerId}:`, err);
            handleDisconnection(peerId);
            return false;
        }
    } else {
        // Client sending to the host
        if (!hostConnection || !hostConnection.open) {
            console.warn('Cannot send data: No open connection to host');
            handleHostDisconnection();
            return false;
        }
        
        try {
            hostConnection.send(data);
            updateActivityTimestamp('host');
            return true;
        } catch (err) {
            console.error('Error sending data to host:', err);
            handleHostDisconnection();
            return false;
        }
    }
}

// Broadcast data to all connected peers (host only)
export function broadcastData(data) {
    if (!isHostPeer) {
        console.warn('Cannot broadcast: This peer is not a host.');
        return false;
    }

    let success = true;
    Object.keys(connections).forEach(clientId => {
        if (!sendData(clientId, data)) {
            success = false;
        }
    });
    
    return success;
}

// Handle disconnection of a client peer
function handleDisconnection(clientId) {
    if (!connections[clientId]) return;
    
    console.log(`Handling disconnection for client ${clientId}`);
    
    // Clear any heartbeat interval
    if (heartbeatIntervals[clientId]) {
        clearInterval(heartbeatIntervals[clientId]);
        delete heartbeatIntervals[clientId];
    }
    
    // Remove from active connections
    delete connections[clientId];
    delete connectionLastActivity[clientId];
    
    // If we're the host, clean up player data and free up their key and recycle their color
    if (isHostPeer) {
        let playerKey = null;
        let playerColor = playerColorMap.get(clientId); // Get color directly from the map
        
        // Find the player entry by peerId
        for (const [key, data] of playerData.entries()) {
            if (data.peerId === clientId) {
                playerKey = key;
                break;
            }
        }
            
        if (playerKey) {
            console.log(`Player with key ${playerKey} and color ${playerColor} disconnected`);
            usedKeys.delete(playerKey);
            playerData.delete(playerKey);
            
            // Remove from the color map and recycle the color
            if (playerColor) {
                playerColorMap.delete(clientId);
                recyclePlayerColor(playerColor);
                // Log color status after recycling
                console.log(`After recycling, color queue: [${colorQueue}], Available colors: [${availableColors}]`);
            }
            
            // Broadcast updated game state to remaining players
            broadcastGameState();
        }
    }
    
    callbackConfig.onClientDisconnected(clientId);
}

// Handle disconnection from the host
function handleHostDisconnection() {
    if (!hostConnection) return;
    
    console.log('Handling host disconnection');
    
    // Clear host heartbeat interval
    if (heartbeatIntervals['host']) {
        clearInterval(heartbeatIntervals['host']);
        delete heartbeatIntervals['host'];
    }
    
    hostConnection = null;
    delete connectionLastActivity['host'];
    
    // Clear all player data as the session is ending
    playerData.clear();
    usedKeys.clear();
    
    // Reset the color queue system
    resetColorSystem();
    
    callbackConfig.onHostDisconnected();
}

// Get the local peer ID
export function getPeerId() {
    return peer ? peer.id : null;
}

// Get the array of connected client peer IDs (host only)
export function getClientPeerIds() {
    if (!isHostPeer) {
        console.warn('Cannot get client IDs: This peer is not a host.');
        return [];
    }
    
    return Object.keys(connections);
}

// Get the host peer ID (client only)
export function getHostPeerId() {
    if (isHostPeer) {
        console.warn('This peer is not connected to any host because it is a host.');
        return null;
    }
    
    return hostConnection ? hostConnection.peer : null;
}

// Check if a particular peer is still connected (for both host and clients)
export function isPeerConnected(peerId) {
    if (isHostPeer) {
        return connections[peerId] && connections[peerId].open;
    } else {
        return hostConnection && hostConnection.open && hostConnection.peer === peerId;
    }
}

// Get the number of connected clients (host only)
export function getConnectedClientCount() {
    if (!isHostPeer) {
        return 0;
    }
    
    return Object.keys(connections).length;
}

// Clean up resources when closing the application
export function cleanupPeer() {
    // Stop connection monitoring
    if (connectionMonitorInterval) {
        clearInterval(connectionMonitorInterval);
        connectionMonitorInterval = null;
    }
    
    // Clear all heartbeat intervals
    Object.keys(heartbeatIntervals).forEach(peerId => {
        clearInterval(heartbeatIntervals[peerId]);
    });
    heartbeatIntervals = {};
    
    // Close all client connections
    Object.keys(connections).forEach(clientId => {
        try {
            connections[clientId].close();
        } catch (err) {
            console.error(`Error closing connection to ${clientId}:`, err);
        }
    });
    
    // Close host connection
    if (hostConnection) {
        try {
            hostConnection.close();
        } catch (err) {
            console.error('Error closing host connection:', err);
        }
    }
    
    // Close the peer connection
    if (peer) {
        try {
            peer.destroy();
        } catch (err) {
            console.error('Error destroying peer:', err);
        }
    }
    
    // Reset all variables
    peer = null;
    connections = {};
    hostConnection = null;
    isHostPeer = false;
    connectionLastActivity = {};
    
    console.log('Peer resources cleaned up');
}

// Add key generation and management
function generateUniqueKey() {
    const keyLength = 6;
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let key;
    
    do {
        key = '';
        for (let i = 0; i < keyLength; i++) {
            key += chars.charAt(Math.floor(Math.random() * chars.length));
        }
    } while (usedKeys.has(key));
    
    usedKeys.add(key);
    return key;
}

// Add broadcastGameState function
function broadcastGameState() {
    if (!isHostPeer) return;
    
    const gameState = {
        type: 'gameStateUpdate',
        players: Array.from(playerData.entries()).map(([key, data]) => ({
            id: data.peerId,
            key: key,
            color: data.color, // Include the player's color
            // Include any other player state data here
        }))
    };
    
    // Broadcast to all connected clients
    Object.values(connections).forEach(conn => {
        if (conn.open) {
            conn.send(gameState);
        }
    });
}
