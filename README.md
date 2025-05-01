# P2P ASCII Roguelike Prototype

This is a functional prototype demonstrating a strictly client-side, peer-to-peer (P2P) multiplayer ASCII roguelike game using WebRTC (via PeerJS).

## Technical Specifications

- **Frontend:** HTML5, CSS3, ES6+ JavaScript (Vanilla)
- **Networking:** WebRTC (PeerJS v1.5.2)
- **Signaling:** Public PeerJS Server
- **NAT Traversal:** Public STUN Servers (e.g., Google STUN)

## Setup and Running Locally (SOW IV.4.3)

1.  **Prerequisites:**
    *   Node.js and npm (or yarn) installed.
    *   Two modern web browsers (e.g., Chrome, Firefox) on the same network for testing.

2.  **Install Dependencies:**
    Open a terminal in the project root directory (`p2p-roguelike`) and run:
    ```bash
    npm install
    ```

3.  **Start the Server:**
    Run the following command in the terminal:
    ```bash
    node server.js
    ```
    This will start a simple static file server, typically on `http://localhost:3000`.

4.  **Open the Application:**
    Open your web browser and navigate to the address provided by the server (e.g., `http://localhost:3000`).

## Basic Usage Walkthrough (SOW IV.4.3)

1.  **Host (Player 1):**
    *   Open the application URL in the first browser.
    *   Click the "Create World" button.
    *   The game view will appear, showing your player character ('@').
    *   A unique "Session Key" (your PeerJS ID) will be displayed below the buttons. Copy this key.

2.  **Client (Player 2):**
    *   Open the application URL in the second browser (can be on the same machine or another machine on the same network).
    *   Click the "Join World" button.
    *   An input field will appear.
    *   Paste the Session Key (copied from the host) into the input field.
    *   Click the "Submit Key" button.

3.  **Gameplay:**
    *   If the connection is successful, the second browser will also display the game view, showing both the host's and the client's player characters ('@') with different colors.
    *   Use the Arrow Keys (Up, Down, Left, Right) in either browser window to move your respective player character.
    *   Movement should be reflected (after a slight delay due to network latency and host validation) on both screens.
    *   Players cannot move into walls ('#') or onto cells occupied by other players.

## Known Limitations (SOW V.B)

*   Maximum 4 players (1 host + 3 clients).
*   No complex game mechanics (combat, items, NPCs, objectives).
*   Basic network error handling; disconnections might require a page refresh.
*   No TURN server support; connections might fail in complex network environments (e.g., symmetric NATs).
*   No client-side prediction; movement latency is visible.
*   No persistence; game state is lost on page refresh.
*   No security measures against cheating.
