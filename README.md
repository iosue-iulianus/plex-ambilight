# Plex Ambilight

A browser extension that adds ambient lighting effects around the video player in Plex Web. Colors are sampled from the edges of the currently playing video and projected as a soft glow into the surrounding dark areas of the page, similar to Philips Ambilight TVs.

Built for self-hosted Plex servers with local media libraries.

## How it works

The extension detects when a `<video>` element is active on Plex Web, then:

1. Samples video frames onto a tiny offscreen canvas (64x36) using `requestVideoFrameCallback`
2. Extracts color strips from the top, bottom, left, and right edges of each frame
3. Paints those strips onto 4 canvas elements positioned around the video
4. Applies CSS `filter: blur()` to create the ambient glow effect
5. A `clip-path` mask prevents the glow from bleeding over the video content itself

The glow fills the entire viewport area surrounding the video, automatically adapting to different aspect ratios (4:3, 16:9, ultrawide, etc.). Exponential color smoothing between frames prevents flickering.

## Installation

> **Note:** This extension is currently awaiting approval on the Chrome Web Store and Firefox Add-ons. Once approved, you'll be able to install it directly from the stores. Until then, use the manual installation methods below.

### Chrome (Manual installation)
1. Clone or download this repository
2. Open `chrome://extensions/` in Chrome
3. Enable **Developer mode** (toggle in the top right)
4. Click **Load unpacked** and select the `plex-ambilight` directory
5. Navigate to [app.plex.tv](https://app.plex.tv) and play something

### Firefox (Manual installation)
1. Clone or download this repository
2. Open `about:debugging#/runtime/this-firefox` in Firefox
3. Click **Load Temporary Add-on...**
4. Select any file in the `plex-ambilight` directory (e.g., `manifest.json`)
5. Navigate to [app.plex.tv](https://app.plex.tv) and play something

**Note:** Temporary add-ons in Firefox are removed when the browser closes. For persistent installation before store approval, you'll need to sign and install it via AMO self-distribution.

## Settings

Click the extension icon in the toolbar to access settings. All settings apply in real-time.

### Intensity (10% - 100%, default: 70%)

Controls the overall visibility of the glow effect via CSS opacity.

- **Low (10-30%):** Subtle ambient glow that doesn't distract from the content. Good for bright, colorful shows where the glow can be overpowering at full strength.
- **Medium (40-70%):** Balanced default. Noticeable effect without washing out the surrounding UI.
- **High (80-100%):** Vivid, immersive glow. Best in a dark room with a dark browser theme.

The glow automatically dims to 30% of the set intensity when the video is paused.

### Spread (40px - 250px, default: 120px)

Controls how far from the video edge the glow maintains full color saturation before it begins fading out. The glow always extends to the viewport edges, but `spread` determines where the fadeout starts.

- **Low (40-80px):** Glow fades quickly, creating a tight halo close to the video. More subtle, less GPU load.
- **Medium (100-150px):** The glow reaches comfortably into the surrounding area before fading. Good default for most setups.
- **High (180-250px):** Color stays vivid far from the video, filling large dark areas (useful for 4:3 content with wide pillarbox bars, or smaller video windows).

### Blur (20px - 160px, default: 80px)

Controls the CSS blur filter radius applied to each glow canvas. Determines how soft and diffused the glow appears.

- **Low (20-40px):** Sharper color bands are visible in the glow, more closely mirroring what's on screen. Can look more "digital."
- **Medium (60-100px):** Smooth, natural-looking gradient. Individual color regions blend together.
- **High (120-160px):** Very diffused, almost uniform glow. Colors from different parts of the edge blend into each other. Higher GPU cost.

## Compatibility

- **Chrome** (Manifest V3) - primary target
- **Plex Web** at `app.plex.tv` - auto-detected
- Self-hosted Plex server content only (local media, no DRM restrictions)
- Handles SPA navigation, fullscreen, aspect ratio changes, and player state transitions

## Project structure

```
plex-ambilight/
├── manifest.json
├── src/
│   ├── content/
│   │   ├── content.js          # Orchestrator: wires detector + renderer
│   │   ├── renderer.js         # Canvas-based ambilight engine
│   │   ├── plex-detector.js    # Video element + player container detection
│   │   └── styles.css          # Glow container styles
│   ├── background/
│   │   └── background.js       # Service worker, state management
│   ├── popup/
│   │   ├── popup.html          # Settings UI
│   │   ├── popup.js            # Settings logic
│   │   └── popup.css           # Popup styles
│   └── shared/
│       ├── constants.js        # Defaults, config keys, selectors
│       ├── messaging.js        # Chrome messaging helpers
│       └── storage.js          # Storage abstraction
└── icons/
    ├── icon-16.png
    ├── icon-48.png
    └── icon-128.png
```

## Architecture notes

- Content scripts use an IIFE pattern with a `globalThis.__PlexAmbilight` namespace (no ES modules in content scripts)
- Video detection uses `MutationObserver` + polling to handle Plex's React SPA lifecycle
- The glow container uses `position: fixed` on `document.body` to avoid interfering with Plex's layout
- A `clip-path: polygon(evenodd, ...)` creates a frame-shaped mask that excludes the video content area
- Rendering pauses automatically when the tab is hidden (`document.visibilityState`)

## Acknowledgements

The rendering approach (edge color sampling, micro-canvas projection with CSS blur) is adapted from [youtube-ambilight](https://github.com/WesselKroos/youtube-ambilight) by Wessel Kroos. That project implements the same effect for YouTube — this extension re-implements the core technique for Plex Web's completely different DOM structure and SPA lifecycle.

## License

MIT
