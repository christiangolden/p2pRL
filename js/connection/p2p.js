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
    heartbeatInterval: 10000, // Milliseconds between heartbeats
    reconnectAttempts: 3,     // Number of reconnect attempts
    reconnectDelay: 2000      // Milliseconds between reconnect attempts
};

let peer = null;
let hostConnection = null; // For clients: connection to the host
const clientConnections = new Map(); // For host: connections to clients (peerId -> DataConnection)
let peerId = null;
let isHost = false;
let lastKnownHostId = null; // Store host ID for reconnection
let heartbeatTimerId = null;
let reconnectAttempts = 0;
let isReconnecting = false;
let wasConnected = false; // Track if we've ever been connected

// Track page visibility
let isPageVisible = true;
let offPageTime = 0; // Track how long the page has been invisible

let onPeerConnectedCallback = null; // Called when this peer successfully registers with the signaling server
let onHostConnectedCallback = null; // Client: Called when connection to host is established
let onClientConnectedCallback = null; // Host: Called when a client connects
let onClientDisconnectedCallback = null; // Host: Called when a client disconnects
let onDataReceivedCallback = null; // Called when data is received from any connection

/**
 * Initializes PeerJS and registers with the signaling server.
 * @param {function(string)} onPeerConnected - Callback when peer is open, receives peerId.
 * @param {function(object)} onDataReceived - Callback when data is received.
 * @param {function(string)} [onClientConnected] - Host only: Callback when a client connects, receives clientPeerId.
 * @param {function(string)} [onClientDisconnected] - Host only: Callback when a client disconnects, receives clientPeerId.
 * @param {function()} [onHostConnected] - Client only: Callback when connection to host is open.
 */
export function initializePeer(callbacks) {
    onPeerConnectedCallback = callbacks.onPeerConnected;
    onDataReceivedCallback = callbacks.onDataReceived;
    onClientConnectedCallback = callbacks.onClientConnected;
    onClientDisconnectedCallback = callbacks.onClientDisconnected;
    onHostConnectedCallback = callbacks.onHostConnected;

    // Create a Peer instance. If no ID is given, the server will assign one.
    peer = new Peer(undefined, PEER_CONFIG);

    peer.on('open', (id) => {
        console.log('My peer ID is: ' + id);
        peerId = id;
        if (onPeerConnectedCallback) {
            onPeerConnectedCallback(id);
        }
        
        // Start monitoring page visibility
        setupVisibilityHandling();
    });

    peer.on('connection', (conn) => {
        console.log(`Incoming connection from ${conn.peer}`);
        if (isHost) {
            setupConnectionHandlers(conn);
            clientConnections.set(conn.peer, conn);
            if (onClientConnectedCallback) {
                onClientConnectedCallback(conn.peer);
            }
        } else {
            console.warn('Incoming connection ignored (not host)');
            conn.close(); // Clients don't accept incoming connections directly in this model
        }
    });

    peer.on('disconnected', () => {
        console.log('Peer disconnected from signaling server. Attempting to reconnect...');
        // Try to reconnect to the signaling server
        setTimeout(() => {
            if (peer) {
                peer.reconnect();
            }
        }, 1000);
    });

    peer.on('close', () => {
        console.log('Peer connection closed.');
        peer = null;
        stopHeartbeat();
    });

    peer.on('error', (err) => {
        console.error('PeerJS error:', err);
        
        // Handle specific errors
        if (err.type === 'peer-unavailable' && !isHost && !isReconnecting) {
            console.log('Host appears to be unavailable. Will try to reconnect when page becomes active again.');
        } else if (err.type === 'network' || err.type === 'server-error') {
            console.log('Network or server error. Will attempt recovery when conditions improve.');
        } else {
            // Only show alert for critical errors
            if (err.type === 'browser-incompatible') {
                alert(`PeerJS Error: ${err.message} (Type: ${err.type})`);
            }
        }
    });
}

/**
 * Sets up page visibility handling to detect when app is in background
 */
function setupVisibilityHandling() {
    // Track visibility changes
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    // Track when user leaves the page and when they return
    window.addEventListener('blur', () => {
        isPageVisible = false;
        offPageTime = Date.now();
    });
    
    window.addEventListener('focus', () => {
        const timeAway = Date.now() - offPageTime;
        isPageVisible = true;
        
        // If we were away for more than 5 seconds, check connections
        if (timeAway > 5000) {
            console.log(`User returned after ${timeAway}ms. Checking connections...`);
            checkConnectionsAfterInactivity();
        }
    });
}

/**
 * Handle visibility change events
 */
function handleVisibilityChange() {
    if (document.visibilityState === 'hidden') {
        isPageVisible = false;
        offPageTime = Date.now();
    } else {
        const timeAway = Date.now() - offPageTime;
        isPageVisible = true;
        
        // If we were away for more than 5 seconds, check connections
        if (timeAway > 5000) {
            console.log(`Page visible again after ${timeAway}ms. Checking connections...`);
            checkConnectionsAfterInactivity();
        }
    }
}

/**
 * Checks and potentially restores connections after page becomes active again
 */
function checkConnectionsAfterInactivity() {
    // For host - check all client connections
    if (isHost) {
        let hasClosedConnections = false;
        
        clientConnections.forEach((conn, clientId) => {
            if (!conn.open) {
                console.log(`Connection to client ${clientId} is closed after inactivity.`);
                hasClosedConnections = true;
            }
        });
        
        if (hasClosedConnections) {
            // Send ping to all connected clients
            sendHeartbeat();
        }
    } 
    // For client - check host connection
    else if (hostConnection && wasConnected) {
        if (!hostConnection.open) {
            console.log('Connection to host is closed after inactivity. Attempting to reconnect...');
            attemptReconnectToHost();
        } else {
            // Connection still appears open, send a ping to verify
            sendHeartbeat();
        }
    }
}

/**
 * Set up heartbeat to keep connections alive
 */
function startHeartbeat() {
    stopHeartbeat(); // Clear any existing timer
    
    heartbeatTimerId = setInterval(() => {
        if (isPageVisible) {
            sendHeartbeat();
        }
    }, CONNECTION_CONFIG.heartbeatInterval);
}

/**
 * Stop the heartbeat timer
 */
function stopHeartbeat() {
    if (heartbeatTimerId) {
        clearInterval(heartbeatTimerId);
        heartbeatTimerId = null;
    }
}

/**
 * Send a heartbeat message to verify connection is still active
 */
function sendHeartbeat() {
    const heartbeatMessage = { type: 'heartbeat', timestamp: Date.now() };
    
    if (isHost) {
        broadcastData(heartbeatMessage);
    } else if (hostConnection && hostConnection.open) {
        try {
            hostConnection.send(heartbeatMessage);
        } catch (e) {
            console.warn('Error sending heartbeat to host:', e);
            if (!isReconnecting) {
                attemptReconnectToHost();
            }
        }
    }
}

/**
 * Attempts to reconnect to the host
 */
function attemptReconnectToHost() {
    if (isReconnecting || !lastKnownHostId) return;
    
    isReconnecting = true;
    reconnectAttempts = 0;
    
    console.log(`Attempting to reconnect to host: ${lastKnownHostId}`);
    tryReconnect();
}

/**
 * Recursive function to attempt reconnection multiple times
 */
function tryReconnect() {
    if (reconnectAttempts >= CONNECTION_CONFIG.reconnectAttempts) {
        console.log('Maximum reconnection attempts reached.');
        isReconnecting = false;
        // Let the user know they need to reload
        if (wasConnected) {
            showReconnectionFailed();
        }
        return;
    }
    
    reconnectAttempts++;
    console.log(`Reconnection attempt ${reconnectAttempts}/${CONNECTION_CONFIG.reconnectAttempts}...`);
    
    // Close existing connection if it exists
    if (hostConnection) {
        hostConnection.close();
        hostConnection = null;
    }
    
    // Try to establish a new connection
    connectToHost(lastKnownHostId)
        .then(() => {
            console.log('Reconnection initiated...');
            // Wait for connection open event
        })
        .catch(err => {
            console.error('Reconnection attempt failed:', err);
            // Try again after delay
            setTimeout(() => {
                if (isReconnecting) {
                    tryReconnect();
                }
            }, CONNECTION_CONFIG.reconnectDelay);
        });
}

/**
 * Show a notification that reconnection failed
 */
function showReconnectionFailed() {
    console.log('Creating reconnection failed notification');
    const notification = document.createElement('div');
    notification.className = 'connection-notification';
    notification.innerHTML = `
        <p>Connection to game lost.</p>
        <button id="reload-btn">Reload</button>
    `;
    document.body.appendChild(notification);
    
    document.getElementById('reload-btn').addEventListener('click', () => {
        window.location.reload();
    });
}

/**
 * Sets up common handlers for a DataConnection.
 * @param {DataConnection} conn
 */
function setupConnectionHandlers(conn) {
    conn.on('data', (data) => {
        // Handle special message types
        if (data.type === 'heartbeat') {
            // Respond to heartbeats with a pong
            conn.send({ type: 'pong', timestamp: data.timestamp });
            return;
        } else if (data.type === 'pong') {
            // Pong received, connection confirmed active
            return;
        }
        
        // Regular data handling
        if (onDataReceivedCallback) {
            onDataReceivedCallback(data, conn.peer);
        }
    });

    conn.on('open', () => {
        console.log(`Data connection opened with ${conn.peer}`);
        
        // If this is the client connecting to the host
        if (!isHost && conn.peer === hostConnection?.peer) {
            wasConnected = true;
            lastKnownHostId = conn.peer;
            isReconnecting = false;
            reconnectAttempts = 0;
            
            if (onHostConnectedCallback) {
                onHostConnectedCallback();
            }
            
            // Start the heartbeat after successful connection
            startHeartbeat();
        }
    });

    conn.on('close', () => {
        console.log(`Data connection closed with ${conn.peer}`);
        
        // Only handle as a disconnection if page is visible
        // Otherwise might be temporary due to page being in background
        if (isPageVisible) {
            handleDisconnection(conn.peer);
        }
    });

    conn.on('error', (err) => {
        console.error(`Data connection error with ${conn.peer}:`, err);
        
        // Only handle as a disconnection if page is visible
        if (isPageVisible) {
            handleDisconnection(conn.peer);
        }
    });
}

function handleDisconnection(disconnectedPeerId) {
    if (isHost) {
        if (clientConnections.has(disconnectedPeerId)) {
            clientConnections.delete(disconnectedPeerId);
            console.log(`Client ${disconnectedPeerId} removed.`);
            if (onClientDisconnectedCallback) {
                onClientDisconnectedCallback(disconnectedPeerId);
            }
        }
    } else {
        // Client disconnected from host
        if (hostConnection && hostConnection.peer === disconnectedPeerId) {
            console.log('Disconnected from host.');
            hostConnection = null;
            
            // Only try to reconnect if page is visible and we were connected before
            if (isPageVisible && wasConnected) {
                console.log('Attempting to reconnect to host...');
                attemptReconnectToHost();
            }
        }
    }
}

/**
 * Sets this peer instance to act as the host.
 */
export function setAsHost() {
    isHost = true;
    console.log('This peer is now the host.');
    // Start the heartbeat after becoming the host
    startHeartbeat();
}

/**
 * Attempts to connect to a host peer.
 * @param {string} hostPeerId - The PeerJS ID of the host to connect to.
 * @returns {Promise<void>} Resolves when connection attempt is initiated, rejects on immediate error.
 */
export function connectToHost(hostPeerId) {
    if (!peer) {
        console.error('PeerJS not initialized.');
        return Promise.reject('PeerJS not initialized.');
    }
    if (isHost) {
        console.error('Host cannot connect to another host.');
        return Promise.reject('Host cannot connect to another host.');
    }
    if (hostConnection && hostConnection.open) {
        console.warn('Already connected to a host.');
        return Promise.resolve();
    }

    console.log(`Attempting to connect to host: ${hostPeerId}`);
    lastKnownHostId = hostPeerId; // Store for potential reconnection
    
    isHost = false;
    hostConnection = peer.connect(hostPeerId, {
        reliable: true // Use reliable data channel (SOW II.B.5)
    });

    if (!hostConnection) {
        console.error('Failed to initiate connection.');
        return Promise.reject('Failed to initiate connection.');
    }

    setupConnectionHandlers(hostConnection);
    return Promise.resolve();
}

/**
 * Sends data to a specific peer.
 * @param {string} targetPeerId - The ID of the peer to send data to.
 * @param {any} data - The data to send (must be serializable).
 */
export function sendData(targetPeerId, data) {
    let conn = null;
    if (isHost) {
        conn = clientConnections.get(targetPeerId);
    } else if (hostConnection && hostConnection.peer === targetPeerId) {
        conn = hostConnection;
    }

    if (conn && conn.open) {
        conn.send(data);
        // console.log(`Data sent to ${targetPeerId}:`, data); // Can be noisy
    } else {
        console.warn(`Cannot send data: No open connection to ${targetPeerId}`);
    }
}

/**
 * Broadcasts data to all connected clients (Host only).
 * @param {any} data - The data to send.
 */
export function broadcastData(data) {
    if (!isHost) {
        console.warn('Only host can broadcast.');
        return;
    }
    // console.log('Broadcasting data to all clients:', data); // Can be noisy
    clientConnections.forEach((conn) => {
        if (conn.open) {
            conn.send(data);
        }
    });
}

/**
 * Gets the current PeerJS ID.
 * @returns {string | null}
 */
export function getPeerId() {
    return peerId;
}

/**
 * Gets the list of connected client PeerJS IDs (Host only).
 * @returns {string[]}
 */
export function getClientPeerIds() {
    if (!isHost) return [];
    return Array.from(clientConnections.keys());
}

/**
 * Gets the host PeerJS ID (Client only).
 * @returns {string | null}
 */
export function getHostPeerId() {
    if (isHost || !hostConnection) return null;
    return hostConnection.peer;
}
