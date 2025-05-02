// SOW II.C.3: Captures keyboard input (Arrow Keys) and touch input, sends intent to host.

let _movementCallback = null; // Store the callback internally

/**
 * Initializes the keyboard input handler.
 * @param {function(string)} onMovementInput - Callback function for movement.
 */
export function initInput(onMovementInput) {
    _movementCallback = onMovementInput;
    document.addEventListener('keydown', handleKeyDown);
    // Touch controls are set up separately when the game view is shown
    console.log('Keyboard input handler initialized.');
}

function handleKeyDown(event) {
    if (!_movementCallback) return;
    
    // Ignore repeated keydown events from key being held down
    if (event.repeat) {
        return;
    }

    let direction = null;
    switch (event.key) {
        case 'ArrowUp':
            direction = 'up';
            break;
        case 'ArrowDown':
            direction = 'down';
            break;
        case 'ArrowLeft':
            direction = 'left';
            break;
        case 'ArrowRight':
            direction = 'right';
            break;
        default:
            return; // Ignore other keys
    }

    // Prevent default browser action for arrow keys (scrolling)
    event.preventDefault();

    triggerMovement(direction);
}

/**
 * Sets up the touch control listeners. Should be called when the controls are visible.
 * @param {function(string)} onMovementInput - The callback function to trigger on touch.
 */
export function setupTouchControls(onMovementInput) {
    // --- Add Logging --- 
    console.log('[Input] setupTouchControls called.');
    // --- End Logging --- 

    // Ensure callback is updated if initInput was called first
    if (onMovementInput) {
        _movementCallback = onMovementInput;
    }
    if (!_movementCallback) {
        console.error("[Input] Movement callback not set before setting up touch controls.");
        return;
    }

    const touchMappings = {
        'touch-up': 'up',
        'touch-down': 'down',
        'touch-left': 'left',
        'touch-right': 'right'
    };

    let controlsInitialized = false; // Flag to prevent double initialization

    for (const [buttonId, direction] of Object.entries(touchMappings)) {
        // --- Add Logging --- 
        console.log(`[Input] Processing button ID: ${buttonId}`);
        // --- End Logging --- 
        const button = document.getElementById(buttonId);
        
        // --- Add Logging --- 
        if (button) {
            console.log(`[Input] Found button element for ID: ${buttonId}`, button);
        } else {
            console.warn(`[Input] Button element NOT FOUND for ID: ${buttonId}`);
            continue; // Skip if button not found
        }
        // --- End Logging --- 

        // Check if listeners are already attached (simple check)
        // --- Add Logging --- 
        console.log(`[Input] Checking dataset.touchInitialized for ${buttonId}:`, button.dataset.touchInitialized);
        // --- End Logging --- 
        if (!button.dataset.touchInitialized) {
            // --- Add Logging --- 
            console.log(`[Input] Attaching listeners for ${buttonId}...`);
            // --- End Logging --- 
            const touchHandler = (event) => {
                console.log(`[Input] Event triggered on button ${buttonId}:`, event.type);
                event.preventDefault();
                triggerMovement(direction);
            };
            button.addEventListener('touchstart', touchHandler, { passive: false });
            button.addEventListener('click', touchHandler);
            button.dataset.touchInitialized = 'true'; // Mark as initialized
            controlsInitialized = true;
            // --- Add Logging --- 
            console.log(`[Input] Listeners attached for ${buttonId}.`);
            // --- End Logging --- 
        } else {
             // --- Add Logging --- 
            console.log(`[Input] Listeners already initialized for ${buttonId}, skipping.`);
             // --- End Logging --- 
        }
    }
    if (controlsInitialized) {
        console.log('[Input] Touch controls setup loop completed (at least one initialized).');
    } else {
        console.log('[Input] Touch controls setup loop completed (no new initializations).');
    }
}

function triggerMovement(direction) {
    if (!_movementCallback) return;
    // As per SOW II.C.3, send movement intent via callback
    console.log(`Input detected: ${direction}`);
    _movementCallback(direction);
}

/**
 * Removes the keydown listener.
 */
export function disableInput() {
    document.removeEventListener('keydown', handleKeyDown);
    // Touch listeners are harder to remove cleanly without storing references,
    // but they are on elements that get hidden, which is usually sufficient.
    _movementCallback = null;
    console.log('Keyboard input handler disabled.');
}
