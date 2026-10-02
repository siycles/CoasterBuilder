# Switchback

A browser-based 3D rollercoaster builder and first-person ride simulator. It is a static site and can be hosted on GitHub Pages without a build step.

## Run locally

Serve this folder with any static file server and open its URL in a modern browser with WebGL support. An internet connection is needed for Three.js, Google Fonts, and PeerJS room networking, which load from CDNs.

## Deploy to GitHub Pages

1. Push this repository to GitHub.
2. In **Settings → Pages**, choose **Deploy from a branch**.
3. Select the branch and `/ (root)` folder, then save.

The published site URL appears in the Pages settings when deployment completes.

## Play

- Click the terrain or **Add control point** to place keyframes. Each neighboring pair forms one smooth cubic Bézier segment, so lowering an endpoint cannot create a vertical overshoot above either endpoint.
- Select a point and use the green vertical / blue depth gizmo to move it. Switch to **Rotate** for the point orientation, or enter world X/Y/Z and yaw/pitch/roll in the inspector. Each endpoint's rotation sets its own curve handle and shapes that joint.
- Place points on the visible 1 m grid with snapping enabled. Bring the final point within 5 m of the first to reveal **Connect to start** and close the spline into a circuit.
- Drag empty space to orbit and use the wheel to zoom. Use **WASD** or the arrow keys to move around the world; **Q/E** move vertically. Select a point in the list to focus its gizmo.
- Choose **Complete ride** to create a room code, then share it with friends. Guests can join the live host world and ride when the host starts the simulation.

## Multiplayer notes

Rooms use PeerJS data channels and its public cloud signaling service. Track data and ride-start messages travel peer-to-peer; there is no database or persistent room storage. The host must keep the page open and online, and rooms end when the host disconnects. GitHub Pages hosts only the front end; it does not provide a multiplayer backend. For durable rooms or guaranteed availability, deploy a signaling/data backend and persistence service separately.
