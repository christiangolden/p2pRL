// SOW II.C.3: Captures keyboard input (Arrow Keys) and touch input, sends intent to host.

let movementCallback = null;

/**
 * Initializes the input handler.
 * @param {function(string)} onMovementInput - Callback function to be called when a movement key/button is activated.
 *                                             The callback receives the direction ('up', 'down', 'left', 'right').
 */
export function initInput(onMovementInput) {
    movementCallback = onMovementInput;
    document.addEventListener('keydown', handleKeyDown);
    setupTouchControls();
    console.log('Input handler initialized (Keyboard & Touch).');
}

function handleKeyDown(event) {
    if (!movementCallback) return;

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

function setupTouchControls() {
    const touchMappings = {
        'touch-up': 'up',
        'touch-down': 'down',
        'touch-left': 'left',
        'touch-right': 'right'
    };

    for (const [buttonId, direction] of Object.entries(touchMappings)) {
        const button = document.getElementById(buttonId);
        if (button) {
            // Use 'touchstart' for responsiveness on mobile, prevent default to avoid potential double-tap zoom etc.
            button.addEventListener('touchstart', (event) => {
                event.preventDefault(); 
                triggerMovement(direction);
            });
            // Add 'click' as a fallback for desktop testing/non-touch devices
            button.addEventListener('click', (event) => {
                event.preventDefault(); 
                triggerMovement(direction);
            });
        } else {
            console.warn(`Touch control button with ID ${buttonId} not found.`);
        }
    }
}

function triggerMovement(direction) {
    if (!movementCallback) return;
    // As per SOW II.C.3, send movement intent via callback
    console.log(`Input detected: ${direction}`);
    movementCallback(direction);
}

/**
 * Removes the keydown listener and touch listeners.
 */
export function disableInput() {
    document.removeEventListener('keydown', handleKeyDown);
    // TODO: Properly remove touch listeners if needed, though they are tied to buttons that become hidden.
    movementCallback = null;
    console.log('Input handler disabled.');
}
