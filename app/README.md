# Spiderbot Studio

Interactive 3D quadruped configurator built with React, Three.js and Vinext.

## Run locally (Windows, macOS or Linux)

1. Install Node.js 22.13 or newer (Node.js 24 LTS is suitable).
2. Extract this ZIP.
3. Open a terminal in the extracted `spiderbot-studio` folder.
4. Install dependencies:

   npx pnpm@11.25.0 install --frozen-lockfile

5. Start the app:

   npx pnpm@11.25.0 dev

6. Open http://localhost:5173 in your browser (or the address printed in the terminal).

Internet access is needed for the initial dependency installation. Dependencies
and generated build files are intentionally not included in this source ZIP.
No API key, account or cloud deployment is needed to run the app locally.

## Controls

- Drag the scene to orbit; scroll to zoom; right-drag to pan.
- Use Perspective, Top, Front and Side for preset views.
- Geometry adjusts body dimensions, leg lengths and attachment offsets.
- Joint angles adjusts yaw, elbow and knee angles.
- All legs edits every leg; FL, FR, RL and RR edit individual legs.
- The final segment is constrained to remain longer than the first two.
- Reset model restores the default geometry and camera.

The vertical axis is Y. Lengths are in millimeters and angles in degrees.
Yaw rotates around the vertical axis. Elbow and knee angles are relative to
the previous segment and bend in the leg's vertical plane.
This is a geometry/kinematics viewer; it does not simulate collisions,
ground contact, balance or motor torque.

## Project files

- app/page.tsx: 3D model, articulation, sidebar controls and camera.
- app/globals.css: application styling and responsive layout.
- app/layout.tsx: page metadata.
- public/favicon.svg: application icon.
- components/ui/: reusable UI components.
- pnpm-lock.yaml: pinned dependency resolution.

Three.js uses WebGL when available, with an SVG-based 3D fallback when
WebGL is unavailable. The fallback can show simpler shading and overlap
artifacts; WebGL provides the full rendering quality.

## Build

   npx pnpm@11.25.0 build

The included build setup targets the original Cloudflare/Vinext environment.
For local interactive use, use the development command above.

The hosted site's identity, credentials, Git history and local runtime caches
are excluded. The hosting configuration is reset for standalone use.
