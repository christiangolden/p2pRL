// SOW II.C.3: Captures keyboard input (Arrow Keys) and sends intent to host.

let movementCallback = null;

/**
 * Initializes the input handler.
 * @param {function(string)} onMovementInput - Callback function to be called when a movement key is pressed.
 *                                             The callback receives the direction ('up', 'down', 'left', 'right').
 */
export function initInput(onMovementInput) {
    movementCallback = onMovementInput;
    document.addEventListener('keydown', handleKeyDown);
    console.log('Input handler initialized.');
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

    // As per SOW II.C.3, send movement intent via callback
    // (This callback will eventually send the data to the host via WebRTC)
    console.log(`Input detected: ${direction}`);
    movementCallback(direction);
}

/**
 * Removes the keydown listener.
 */
export function disableInput() {
    document.removeEventListener('keydown', handleKeyDown);
    movementCallback = null;
    console.log('Input handler disabled.');
}
