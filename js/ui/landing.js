export function initLandingPage(createWorldCallback, joinWorldCallback) {
    const createWorldButton = document.getElementById('create-world-btn');
    const joinWorldButton = document.getElementById('join-world-btn');
    const joinSection = document.getElementById('join-form'); // Changed ID
    const sessionKeyInput = document.getElementById('session-key-input');
    const submitJoinButton = document.getElementById('connect-btn'); // Changed ID
    const landingPage = document.getElementById('landing-page');

    // Create validation text element
    const validationText = document.createElement('div');
    validationText.className = 'key-validation-text key-validation-invalid';
    validationText.textContent = 'Not a valid session key';

    // Create capacity indicator text element
    const capacityText = document.createElement('div');
    capacityText.className = 'key-validation-text key-validation-invalid';
    capacityText.textContent = 'Room may be at max capacity';
    capacityText.style.marginTop = '2px'; // Small space between the two messages

    // Insert validation and capacity text after the connect button
    if (joinSection) {
        joinSection.appendChild(validationText);
        joinSection.appendChild(capacityText);
    }

    // Keep track of validation state and capacity state
    let isKeyValid = false;
    let roomHasSpace = false;
    
    // Initially disable the connect button
    submitJoinButton.disabled = true;
    submitJoinButton.classList.add('button-disabled');
    submitJoinButton.classList.remove('button-ready');
    
    // Clear the session key input field on page load
    sessionKeyInput.value = '';

    // Hide validation messages initially when input is empty
    validationText.style.display = sessionKeyInput.value.trim() ? 'block' : 'none';
    capacityText.style.display = sessionKeyInput.value.trim() ? 'block' : 'none';

    if (!createWorldButton || !joinWorldButton || !joinSection || !sessionKeyInput || !submitJoinButton || !landingPage) {
        console.error('Landing page elements not found!');
        return;
    }

    createWorldButton.addEventListener('click', () => {
        landingPage.style.display = 'none'; // Hide landing page
        createWorldCallback();
    });

    joinWorldButton.addEventListener('click', () => {
        // Clear input field and reset validation when showing the join form
        sessionKeyInput.value = '';
        
        joinSection.classList.remove('hidden'); // Use classList to show/hide
        joinSection.style.display = 'block'; // Ensure it's block display
        
        // Reset validation state when showing the join form
        isKeyValid = false;
        roomHasSpace = false;
        submitJoinButton.disabled = true;
        validationText.textContent = 'Not a valid session key';
        validationText.className = 'key-validation-text key-validation-invalid';
        capacityText.textContent = 'Room may be at max capacity';
        capacityText.className = 'key-validation-text key-validation-invalid';
    });

    // Add input event listener to validate key as user types
    sessionKeyInput.addEventListener('input', () => {
        const key = sessionKeyInput.value.trim();
        
        // Show validation messages only when there's input
        validationText.style.display = key ? 'block' : 'none';
        capacityText.style.display = key ? 'block' : 'none';
        
        validateSessionKey(key);
        if (key.length >= 6) {
            // Only check capacity if key seems valid
            checkRoomCapacity(key);
        } else {
            // Reset capacity status when key is invalid
            updateCapacityStatus(false);
        }
        
        // Update button state
        updateConnectButtonState();
    });

    submitJoinButton.addEventListener('click', () => {
        const sessionKey = sessionKeyInput.value.trim();
        if (sessionKey && isKeyValid && roomHasSpace) {
            landingPage.style.display = 'none'; // Hide landing page
            joinWorldCallback(sessionKey);
        } else {
            alert('Please enter a valid session key for a game with available space.');
        }
    });

    // Function to update the Connect button state based on validations
    function updateConnectButtonState() {
        // Only enable button if there's input and it's valid and room has space
        const hasInput = sessionKeyInput.value.trim().length > 0;
        submitJoinButton.disabled = !(hasInput && isKeyValid && roomHasSpace);
        
        // Add a visual hint through button styling
        if (hasInput && isKeyValid && roomHasSpace) {
            submitJoinButton.classList.add('button-ready');
            submitJoinButton.classList.remove('button-disabled');
        } else {
            submitJoinButton.classList.remove('button-ready');
            submitJoinButton.classList.add('button-disabled');
        }
    }

    // Function to validate the session key
    function validateSessionKey(key) {
        // Simple validation: consider a key valid if it's 6+ characters
        // This is a simple client-side validation for UX only
        isKeyValid = key.length >= 6;
        
        if (isKeyValid) {
            validationText.textContent = 'Valid session key entered';
            validationText.classList.remove('key-validation-invalid');
            validationText.classList.add('key-validation-valid');
        } else {
            validationText.textContent = 'Not a valid session key';
            validationText.classList.remove('key-validation-valid');
            validationText.classList.add('key-validation-invalid');
        }
        
        // Update button state whenever validation changes
        updateConnectButtonState();
    }

    // Function to check if room has capacity
    function checkRoomCapacity(key) {
        // We need to do a lightweight connection to check if the room exists and has capacity
        // This creates a temporary peer to check room status without actually joining
        
        // Create a temporary Peer instance
        import('../connection/p2p.js').then(p2pModule => {
            // Use the temporary peer to check if the room exists and has capacity
            const tempPeer = new Peer(null, {
                debug: 0, // No logs
                config: {
                    'iceServers': [
                        { urls: 'stun:stun.l.google.com:19302' }
                    ]
                }
            });
            
            tempPeer.on('open', () => {
                // Once the peer is open, try to connect to the host
                const conn = tempPeer.connect(key, {
                    reliable: true,
                    metadata: { capacityCheck: true }
                });
                
                // Set a timeout for the connection attempt
                const timeoutId = setTimeout(() => {
                    updateCapacityStatus(false, 'Connection timed out, room may not exist');
                    if (conn) conn.close();
                    tempPeer.destroy();
                }, 5000);
                
                conn.on('open', () => {
                    // Connection successful, wait for data
                    conn.send({ type: 'checkCapacity' });
                });
                
                conn.on('data', (data) => {
                    clearTimeout(timeoutId);
                    
                    if (data.type === 'capacityResponse') {
                        const hasSpace = !data.isFull;
                        updateCapacityStatus(hasSpace, 
                            hasSpace ? `Room has ${data.playerCount}/4 players` : 'Room is at max capacity (4/4 players)');
                    }
                    
                    // Close the connection and destroy the peer
                    conn.close();
                    tempPeer.destroy();
                });
                
                conn.on('error', () => {
                    clearTimeout(timeoutId);
                    updateCapacityStatus(false, 'Could not connect to room');
                    tempPeer.destroy();
                });
            });
            
            tempPeer.on('error', () => {
                updateCapacityStatus(false, 'Error checking room capacity');
            });
        }).catch(err => {
            console.error('Error importing p2p module:', err);
            updateCapacityStatus(false, 'Error checking room capacity');
        });
    }
    
    // Function to update the capacity status text
    function updateCapacityStatus(hasSpace, message = null) {
        roomHasSpace = hasSpace;
        
        if (message) {
            capacityText.textContent = message;
        } else {
            capacityText.textContent = hasSpace ? 'Room has space available' : 'Room may be at max capacity';
        }
        
        if (isKeyValid && hasSpace) {
            capacityText.classList.remove('key-validation-invalid');
            capacityText.classList.add('key-validation-valid');
        } else {
            capacityText.classList.remove('key-validation-valid');
            capacityText.classList.add('key-validation-invalid');
        }
        
        // Update button state whenever capacity status changes
        updateConnectButtonState();
    }
}
