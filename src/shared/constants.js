/**
 * Plex Ambilight - Shared constants, defaults, and configuration keys.
 * Loaded first by all content scripts.
 */
(function () {
  'use strict';

  const PlexAmbilight = (globalThis.__PlexAmbilight =
    globalThis.__PlexAmbilight || {});

  PlexAmbilight.Constants = {
    // Storage keys
    STORAGE_KEY_ENABLED: 'plex_ambilight_enabled',
    STORAGE_KEY_SETTINGS: 'plex_ambilight_settings',

    // Message types
    MSG_TOGGLE: 'toggle_ambilight',
    MSG_GET_STATE: 'get_state',
    MSG_STATE_CHANGED: 'state_changed',

    // Default settings
    DEFAULTS: {
      enabled: true,
      intensity: 0.7,
      spread: 120,
      blurRadius: 80,
      samplingFps: 30,
      edgeStripWidth: 0.12,
      segmentsPerEdge: 8,
      transitionDuration: 150,
      sampleResolution: { width: 64, height: 36 },
    },

    // Plex detection
    PLEX_VIDEO_SELECTOR: 'video',
    PLEX_PLAYER_CONTAINER_SELECTORS: [
      '[class*="VideoPlayer"]',
      '[class*="video-player"]',
      '[data-testid="videoPlayer"]',
    ],

    // Renderer
    GLOW_CONTAINER_ID: 'plex-ambilight-container',
    GLOW_SIDES: ['top', 'right', 'bottom', 'left'],

    // Player controls injection
    PLEX_CONTROLS_SELECTORS: [
      '[class*="PlayerControls"]',
      '[class*="playerControls"]',
      '[class*="controlsContainer"]',
      '[class*="ControlsContainer"]',
    ],
    PLEX_CONTROLS_RIGHT_SELECTORS: [
      '[class*="rightControls"]',
      '[class*="RightControls"]',
      '[class*="controlsRight"]',
      '[class*="ControlsRight"]',
    ],
    // The vertical ellipsis / "more" button — insert our icon next to it
    PLEX_MORE_BUTTON_SELECTORS: [
      'button[class*="MoreButton"]',
      'button[class*="moreButton"]',
      '[data-testid="moreButton"]',
      '[data-testid="MoreButton"]',
      '[aria-label="More"]',
      '[aria-label="more"]',
    ],
    PLAYER_CONTROLS_ID: 'plex-ambilight-player-controls',
    PLAYER_CONTROLS_REINJECT_DELAY: 300,

    // Performance
    MIN_VIDEO_READY_STATE: 2,
    DETECTION_POLL_INTERVAL: 2000,

    // Debug
    DEBUG: false,
  };
})();
