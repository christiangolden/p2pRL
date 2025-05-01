export function initLandingPage(createWorldCallback, joinWorldCallback) {
    const createWorldButton = document.getElementById('create-world-btn');
    const joinWorldButton = document.getElementById('join-world-btn');
    const joinSection = document.getElementById('join-form'); // Changed ID
    const sessionKeyInput = document.getElementById('session-key-input');
    const submitJoinButton = document.getElementById('connect-btn'); // Changed ID
    const landingPage = document.getElementById('landing-page');

    if (!createWorldButton || !joinWorldButton || !joinSection || !sessionKeyInput || !submitJoinButton || !landingPage) {
        console.error('Landing page elements not found!');
        return;
    }

    createWorldButton.addEventListener('click', () => {
        landingPage.style.display = 'none'; // Hide landing page
        createWorldCallback();
    });

    joinWorldButton.addEventListener('click', () => {
        joinSection.classList.remove('hidden'); // Use classList to show/hide
        joinSection.style.display = 'block'; // Ensure it's block display
    });

    submitJoinButton.addEventListener('click', () => {
        const sessionKey = sessionKeyInput.value.trim();
        if (sessionKey) {
            landingPage.style.display = 'none'; // Hide landing page
            joinWorldCallback(sessionKey);
        } else {
            alert('Please enter a session key.');
        }
    });
}
