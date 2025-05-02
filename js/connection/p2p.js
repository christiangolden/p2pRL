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
    heartbeatInterval: 2000,          // Heartbeat frequency
    missedHeartbeatsLimit: 10,        // Increased significantly to be more tolerant
    reconnectAttempts: 5,             
    reconnectDelay: 2000,             
    visibilityTimeout: 3600000,       // Extended to 1 hour when tab is hidden (prevent mobile app switching disconnects)
    mobileKeepAliveInterval: 5000     // How often to try to maintain connection when app is switched away
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
    onClientFinalDisconnect: () => {}, // New callback for final disconnection after timeout
    onDataReceived: () => {},
    onColorRecycled: () => {},  // New callback for color recycling
    onGetPlayerPosition: () => {}, // New callback to get player position
    onReconnectWithPosition: () => {} // New callback to restore position on reconnect
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
const CONNECTION_TIMEOUT = 10000; // Increased from 6000ms to 10000ms to be more tolerant for mobile
const CONNECTION_MISSED_PING_LIMIT = 4; // Increased from 2 to 4
const connectionLastActivity = {}; // Track last activity timestamp for each connection
const heartbeatIntervals = {}; // Track heartbeat intervals for each connection
const missedPingCounter = {}; // Track number of consecutive missed pings

// New variables for handling visibility state
let isDocumentHidden = false;
let lastPlayerPositions = new Map(); // To store player positions before disconnect

// Track mobile disconnections and positions
let mobileDisconnections = new Map(); // Map of clientId -> {position, color, timestamp}

// New variables for mobile app switching
let isMobileDevice = false;
let mobileSuspendedConnections = new Map(); // Track connections that are in app-switching state
let documentHiddenTimestamp = 0;            // When the document became hidden

// At initialization, detect if we're on a mobile device
const detectMobileDevice = () => {
    const userAgent = navigator.userAgent || navigator.vendor || window.opera;
    return /android|iphone|ipad|ipod|mobile|tablet/i.test(userAgent);
};

// Initialize the Peer.js instance with callbacks
export function initializePeer(callbacks) {
    // Store the callbacks for later use
    if (callbacks) {
        callbackConfig = { ...callbackConfig, ...callbacks };
    }

    // Detect if we're on a mobile device
    isMobileDevice = detectMobileDevice();
    console.log(`Device detected as ${isMobileDevice ? 'mobile' : 'desktop'}`);

    // Create a new Peer instance (server-broker connection)
    peer = new Peer(null, {
        debug: 2, // 0 = no logs, 3 = all logs
        config: {
            'iceServers': [
                { urls: 'stun:stun.l.google.com:19302' }
            ]
        }
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
    if (!connections[clientId]) return false;
    
    const conn = connections[clientId];
    // Check if connection appears broken
    const connectionIsBroken = !conn.open || 
                              !conn.peerConnection || 
                              (conn.peerConnection.iceConnectionState === 'disconnected' ||
                              conn.peerConnection.iceConnectionState === 'failed' || 
                              conn.peerConnection.iceConnectionState === 'closed');
    
    if (connectionIsBroken) {
        console.log(`Connection to ${clientId} appears to be broken (state: ${conn.peerConnection ? conn.peerConnection.iceConnectionState : 'unknown'})`);
        
        // Before doing anything, store player position
        if (!lastPlayerPositions.has(clientId)) {
            storePlayerPosition(clientId);
        }
        
        // For mobile devices, and especially when document is hidden (app switching)
        // we want to be extremely tolerant and not disconnect
        if (isDocumentHidden || isMobileDevice) {
            console.log(`Document hidden or mobile device - suspending connection to ${clientId} rather than disconnecting`);
            
            // Just suspend the connection rather than disconnecting
            suspendConnection(clientId, conn);
            
            // Return false but don't disconnect yet
            return false;
        }
        
        // For non-mobile or when we're sure it's a genuine disconnect
        // follow normal disconnection procedure
        handleDisconnection(clientId);
        return false;
    }
    
    return true;
}

// Validate host connection
function validateHostConnection() {
    if (!hostConnection) return false;
    
    // Check if connection appears broken
    const connectionIsBroken = !hostConnection.open || 
                              !hostConnection.peerConnection || 
                              (hostConnection.peerConnection.iceConnectionState === 'disconnected' ||
                              hostConnection.peerConnection.iceConnectionState === 'failed' || 
                              hostConnection.peerConnection.iceConnectionState === 'closed');
    
    if (connectionIsBroken) {
        console.log(`Host connection appears to be broken (state: ${hostConnection.peerConnection ? hostConnection.peerConnection.iceConnectionState : 'unknown'})`);
        
        // For mobile devices, and especially when document is hidden (app switching)
        // we want to be extremely tolerant and not disconnect
        if (isDocumentHidden || isMobileDevice) {
            console.log('Document hidden or mobile device - suspending host connection rather than disconnecting');
            
            // Just suspend the connection rather than disconnecting
            suspendConnection('host', hostConnection);
            
            // Return false but don't disconnect yet
            return false;
        }
        
        // For non-mobile or when we're sure it's a genuine disconnect
        // follow normal disconnection procedure
        handleHostDisconnection();
        return false;
    }
    
    return true;
}

// Check all connections for activity/timeout
function checkConnections() {
    const now = Date.now();
    
    // Determine appropriate timeout based on visibility state
    // For mobile devices or hidden documents (app switching), use extremely long timeout
    const currentTimeout = (isDocumentHidden || isMobileDevice) ? 
                         CONNECTION_CONFIG.visibilityTimeout : 
                         CONNECTION_TIMEOUT;
    
    // Check client connections if we're the host
    if (isHostPeer) {
        Object.keys(connections).forEach(clientId => {
            const lastActivity = connectionLastActivity[clientId] || 0;
            const inactiveTime = now - lastActivity;
            
            // During app switching on mobile, be very permissive with timeouts
            if (isDocumentHidden && isMobileDevice) {
                // Be extremely tolerant during app switching - essentially prevent disconnections
                return;
            }
            
            if (inactiveTime > currentTimeout) {
                console.log(`Client ${clientId} appears to be inactive for ${inactiveTime}ms. Validating connection...`);
                if (!validateConnection(clientId)) {
                    return; // Connection was invalid and has been handled
                }
                
                // If connection is still valid, send a ping
                try {
                    sendPing(clientId);
                } catch (err) {
                    console.error(`Error sending ping to ${clientId}:`, err);
                    if (!isDocumentHidden && !isMobileDevice) {
                        handleDisconnection(clientId);
                    } else {
                        // For mobile app switching, just suspend instead of disconnecting
                        suspendConnection(clientId, connections[clientId]);
                    }
                }
            }
        });
    } 
    // Check host connection if we're a client
    else if (hostConnection) {
        const lastActivity = connectionLastActivity['host'] || 0;
        const inactiveTime = now - lastActivity;
        
        // During app switching on mobile, be very permissive with timeouts
        if (isDocumentHidden && isMobileDevice) {
            // Be extremely tolerant during app switching - essentially prevent disconnections
            return;
        }
        
        if (inactiveTime > currentTimeout) {
            console.log(`Host appears to be inactive for ${inactiveTime}ms. Validating connection...`);
            if (!validateHostConnection()) {
                return; // Connection was invalid and has been handled
            }
            
            // If connection is still valid, send a ping
            try {
                sendPingToHost();
            } catch (err) {
                console.error('Error sending ping to host:', err);
                if (!isDocumentHidden && !isMobileDevice) {
                    handleHostDisconnection();
                } else {
                    // For mobile app switching, just suspend instead of disconnecting
                    suspendConnection('host', hostConnection);
                }
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
    
    // Check if this client is reconnecting after mobile app switch
    if (isHostPeer && lastPlayerPositions.has(clientPeerId)) {
        console.log(`Detected reconnection from mobile client: ${clientPeerId}`);
        
        // Get their stored position
        const savedData = lastPlayerPositions.get(clientPeerId);
        if (savedData && Date.now() - savedData.timestamp < CONNECTION_CONFIG.visibilityTimeout) {
            console.log(`Player ${clientPeerId} is reconnecting with saved position: (${savedData.position.x}, ${savedData.position.y})`);
            
            // Restore their connection
            conn.on('open', () => {
                console.log(`Reconnected mobile client ${clientPeerId}`);
                connections[clientPeerId] = conn;
                updateActivityTimestamp(clientPeerId);
                startHeartbeat(clientPeerId);
                
                // Critical: Restore their player data and color in the player maps
                if (savedData.key) {
                    // Restore player data
                    playerData.set(savedData.key, {
                        peerId: clientPeerId,
                        isHost: false,
                        color: savedData.color
                    });
                    
                    // Restore color mapping
                    playerColorMap.set(clientPeerId, savedData.color);
                    
                    console.log(`Restored player data for ${clientPeerId} with key ${savedData.key} and color ${savedData.color}`);
                    
                    // Send the client their restored key and color
                    conn.send({ 
                        type: 'assignKey', 
                        key: savedData.key,
                        color: savedData.color,
                        isReconnect: true
                    });
                }
                
                // Trigger the position restoration callback
                if (callbackConfig.onReconnectWithPosition) {
                    console.log(`Calling position restoration for ${clientPeerId} at position:`, savedData.position);
                    callbackConfig.onReconnectWithPosition(clientPeerId, savedData.position);
                } else {
                    console.warn(`No position restoration callback available for ${clientPeerId}`);
                }
                
                // Remove from saved positions as it's been handled
                lastPlayerPositions.delete(clientPeerId);
                
                // DO NOT call onClientConnected - we're already connected, just resuming
                // Instead send a special message to tell app.js this is a reconnection
                callbackConfig.onClientDisconnected(clientPeerId, {
                    isReconnection: true,
                    position: savedData.position,
                    color: savedData.color
                });
            });
            
            // Set up normal event handlers for this connection
            setupConnectionEventHandlers(conn, clientPeerId);
            return;
        }
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

    // Set up event handlers for this new connection
    setupConnectionEventHandlers(conn, clientPeerId);
}

// Extract connection event handler setup to avoid code duplication
function setupConnectionEventHandlers(conn, clientPeerId) {
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
        } else if (data.type === 'mobileReconnect') {
            // Client is telling us it's reconnecting after app switch
            console.log(`Received mobile reconnect message from ${clientPeerId}`);
            // The main reconnection logic is already handled in handleIncomingConnection
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
    
    // If we're the host, preserve the player's data for potential mobile reconnection
    if (isHostPeer) {
        let playerKey = null;
        let playerColor = playerColorMap.get(clientId); // Get color directly from the map
        let playerPosition = null;
        
        // Find the player entry by peerId
        for (const [key, data] of playerData.entries()) {
            if (data.peerId === clientId) {
                playerKey = key;
                break;
            }
        }
        
        if (playerKey) {
            console.log(`Player with key ${playerKey} and color ${playerColor} disconnected`);
            
            // Get the player's last known position
            if (callbackConfig.onGetPlayerPosition) {
                playerPosition = callbackConfig.onGetPlayerPosition(clientId);
            }
            
            // Store all relevant player data for potential reconnection
            if (playerPosition) {
                lastPlayerPositions.set(clientId, {
                    key: playerKey,
                    position: playerPosition,
                    color: playerColor,
                    timestamp: Date.now()
                });
                
                console.log(`Stored player data for potential reconnect: Position (${playerPosition.x}, ${playerPosition.y}), Color: ${playerColor}`);
                
                // For mobile users, we don't notify clients of disconnection immediately
                // to prevent removing the player from the game state during app switching
                if (isDocumentHidden || isMobileDevice) {
                    console.log(`Mobile or hidden document detected - keeping player ${clientId} in game state for ${CONNECTION_CONFIG.visibilityTimeout/1000} seconds`);
                    
                    // Schedule cleanup after a reasonable timeout (60 seconds)
                    setTimeout(() => {
                        // If they haven't reconnected by now, clean up
                        if (lastPlayerPositions.has(clientId)) {
                            console.log(`No reconnection from ${clientId} after timeout. Cleaning up resources.`);
                            // Instead of cleaning up directly, tell the game to remove the player
                            callbackConfig.onClientFinalDisconnect(clientId);
                            lastPlayerPositions.delete(clientId);
                        }
                    }, CONNECTION_CONFIG.visibilityTimeout); // Use the long timeout for mobile
                    
                    // DON'T trigger the client disconnected callback yet - wait for the timeout
                    return;
                } else {
                    // For regular disconnection, clean up immediately
                    cleanupDisconnectedPlayer(clientId, playerKey, playerColor);
                }
            } else {
                // No position available, clean up immediately
                cleanupDisconnectedPlayer(clientId, playerKey, playerColor);
            }
        }
    }
    
    // Trigger the callback for regular disconnections
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

// Add a function to set visibility state
export function setVisibilityState(isHidden) {
    const previousState = isDocumentHidden;
    isDocumentHidden = isHidden;
    console.log(`Visibility state changed: isHidden=${isHidden}`);
    
    // If the document just became hidden, record the timestamp
    if (isHidden && !previousState) {
        documentHiddenTimestamp = Date.now();
        console.log('Document hidden timestamp set:', documentHiddenTimestamp);
    }
    
    // Adjust connection management based on visibility state
    if (isHidden) {
        // When app is in background, prevent disconnection completely
        console.log('Tab/app hidden: Preventing any disconnections due to app switching');
        
        // For mobile devices, set up special handling to keep connections alive
        if (isMobileDevice) {
            startMobileKeepAlive();
        }
    } else {
        // App is visible again
        console.log('Tab/app visible again after being hidden for:', (Date.now() - documentHiddenTimestamp) / 1000, 'seconds');
        
        // Reset missed ping counters when visibility returns
        Object.keys(missedPingCounter).forEach(id => {
            missedPingCounter[id] = 0;
        });
        
        // Stop the mobile keep-alive system if it was started
        stopMobileKeepAlive();
        
        // Resume any connections that were suspended during app switching
        resumeSuspendedConnections();
        
        // Perform an immediate connection check to ensure everything is still connected
        setTimeout(() => {
            checkAllConnections();
        }, 500);
    }
}

// Mobile app switching special handling
let mobileKeepAliveInterval = null;

// Start sending keep-alive signals to maintain connection during app switching
function startMobileKeepAlive() {
    if (mobileKeepAliveInterval) {
        clearInterval(mobileKeepAliveInterval);
    }
    
    console.log('Starting mobile keep-alive system to preserve connections during app switching');
    
    mobileKeepAliveInterval = setInterval(() => {
        // If we're a host, ping all clients
        if (isHostPeer) {
            Object.keys(connections).forEach(clientId => {
                try {
                    if (connections[clientId] && connections[clientId].open) {
                        connections[clientId].send({
                            type: 'keepAlive',
                            source: 'mobileKeepAlive',
                            timestamp: Date.now()
                        });
                        updateActivityTimestamp(clientId);
                    }
                } catch (err) {
                    console.log(`Keep-alive ping failed for ${clientId}, but ignoring during app switching`);
                    // Don't disconnect - the connection might resume when app is back
                }
            });
        } 
        // If we're a client, ping the host
        else if (hostConnection) {
            try {
                if (hostConnection.open) {
                    hostConnection.send({
                        type: 'keepAlive',
                        source: 'mobileKeepAlive',
                        timestamp: Date.now()
                    });
                    updateActivityTimestamp('host');
                }
            } catch (err) {
                console.log('Keep-alive ping to host failed, but ignoring during app switching');
                // Don't disconnect - connection might resume when app is back
            }
        }
    }, CONNECTION_CONFIG.mobileKeepAliveInterval);
}

// Stop mobile keep-alive interval
function stopMobileKeepAlive() {
    if (mobileKeepAliveInterval) {
        clearInterval(mobileKeepAliveInterval);
        mobileKeepAliveInterval = null;
        console.log('Mobile keep-alive system stopped');
    }
}

// Instead of disconnecting, suspend connection when tab is hidden
function suspendConnection(peerId, conn) {
    if (mobileSuspendedConnections.has(peerId)) return; // Already suspended
    
    console.log(`Suspending connection to ${peerId} during app switching rather than disconnecting`);
    
    // Store info about this connection for later revival
    mobileSuspendedConnections.set(peerId, {
        connection: conn,
        timestamp: Date.now(),
        lastActivity: connectionLastActivity[peerId] || Date.now()
    });
    
    // Don't remove from connections object
    // This allows the connection to potentially recover naturally
}

// Try to resume connections when app becomes visible again
function resumeSuspendedConnections() {
    if (mobileSuspendedConnections.size === 0) return;
    
    console.log(`Attempting to resume ${mobileSuspendedConnections.size} suspended connections`);
    
    // For each suspended connection, check if it's naturally recovered
    // or if we need to attempt reconnection
    mobileSuspendedConnections.forEach((data, peerId) => {
        console.log(`Checking suspended connection to ${peerId}`);
        
        // If the connection exists and is open, it was never truly lost
        const hasActiveConnection = (isHostPeer && connections[peerId] && connections[peerId].open) ||
                                   (!isHostPeer && peerId === 'host' && hostConnection && hostConnection.open);
        
        if (hasActiveConnection) {
            console.log(`Connection to ${peerId} is already active, no need to resume`);
            mobileSuspendedConnections.delete(peerId);
        } else {
            console.log(`Connection to ${peerId} needs resuming`);
            
            // For client, try to reconnect to host
            if (!isHostPeer && peerId === 'host') {
                // Update UI to show reconnecting status
                if (callbackConfig.onReconnecting) {
                    callbackConfig.onReconnecting('host');
                }
                
                // Attempt reconnection
                connectToHost(data.connection.peer)
                    .then(() => {
                        console.log('Successfully reconnected to host after app switching');
                        mobileSuspendedConnections.delete('host');
                        
                        // Request a fresh game state
                        if (hostConnection) {
                            hostConnection.send({ 
                                type: 'requestInitialState',
                                appSwitchResume: true
                            });
                        }
                    })
                    .catch(err => {
                        console.error('Failed to reconnect to host after app switching:', err);
                        // Try one more time after a short delay
                        setTimeout(() => {
                            connectToHost(data.connection.peer)
                                .then(() => {
                                    console.log('Successfully reconnected to host on second attempt');
                                    mobileSuspendedConnections.delete('host');
                                })
                                .catch(err => {
                                    console.error('Failed to reconnect to host on second attempt:', err);
                                    // Finally give up
                                    handleHostDisconnection();
                                });
                        }, 2000);
                    });
            }
        }
    });
}

// Helper function to store player position before disconnection
function storePlayerPosition(clientId) {
    // Check if we're the host
    if (!isHostPeer) return;
    
    // Find the player data in the application state
    // We need to get this from the playerData map
    for (const [key, data] of playerData.entries()) {
        if (data.peerId === clientId) {
            // Get the player's position from the app state via the callback
            if (callbackConfig.onGetPlayerPosition) {
                const position = callbackConfig.onGetPlayerPosition(clientId);
                if (position) {
                    lastPlayerPositions.set(clientId, {
                        key: key,
                        position: position,
                        color: data.color,
                        timestamp: Date.now()
                    });
                    console.log(`Stored position for ${clientId}: (${position.x}, ${position.y})`);
                }
            }
            break;
        }
    }
}

// Helper function to clean up player resources after disconnection
function cleanupDisconnectedPlayer(clientId, playerKey, playerColor) {
    if (playerKey) {
        usedKeys.delete(playerKey);
        playerData.delete(playerKey);
    }
    
    if (playerColor) {
        playerColorMap.delete(clientId);
        recyclePlayerColor(playerColor);
    }
    
    lastPlayerPositions.delete(clientId);
    
    // Broadcast updated game state to remaining players
    broadcastGameState();
}
