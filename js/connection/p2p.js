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

let peer = null;
let hostConnection = null; // For clients: connection to the host
const clientConnections = new Map(); // For host: connections to clients (peerId -> DataConnection)
let peerId = null;
let isHost = false;

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
        // PeerJS will automatically attempt to reconnect
    });

    peer.on('close', () => {
        console.log('Peer connection closed.');
        peer = null;
        // TODO: Handle cleanup
    });

    peer.on('error', (err) => {
        console.error('PeerJS error:', err);
        // TODO: Handle specific errors (e.g., network, server, configuration)
        alert(`PeerJS Error: ${err.message} (Type: ${err.type})`);
    });
}

/**
 * Sets up common handlers for a DataConnection.
 * @param {DataConnection} conn
 */
function setupConnectionHandlers(conn) {
    conn.on('data', (data) => {
        console.log(`Data received from ${conn.peer}:`, data);
        if (onDataReceivedCallback) {
            // Pass the sender's peerId along with the data
            onDataReceivedCallback(data, conn.peer);
        }
    });

    conn.on('open', () => {
        console.log(`Data connection opened with ${conn.peer}`);
        // If this is the client connecting to the host, trigger the callback
        if (!isHost && conn.peer === hostConnection?.peer) {
             if (onHostConnectedCallback) {
                onHostConnectedCallback();
            }
        }
    });

    conn.on('close', () => {
        console.log(`Data connection closed with ${conn.peer}`);
        handleDisconnection(conn.peer);
    });

    conn.on('error', (err) => {
        console.error(`Data connection error with ${conn.peer}:`, err);
        handleDisconnection(conn.peer); // Treat errors as disconnections for simplicity
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
            // TODO: Implement UI feedback or reconnection logic if needed
            alert('Disconnected from the host.');
            // Potentially reload or go back to landing page
            window.location.reload(); 
        }
    }
}

/**
 * Sets this peer instance to act as the host.
 */
export function setAsHost() {
    isHost = true;
    console.log('This peer is now the host.');
    // Host logic is mainly handled by the 'connection' event listener in initializePeer
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
    if (hostConnection) {
        console.warn('Already connected or connecting to a host.');
        return Promise.resolve(); // Or reject, depending on desired behavior
    }

    console.log(`Attempting to connect to host: ${hostPeerId}`);
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
