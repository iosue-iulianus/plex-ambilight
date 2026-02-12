/**
 * Plex Ambilight - Content script controller.
 * Orchestrates the detector and renderer lifecycle.
 * Loaded last in the content script chain after constants, storage,
 * messaging, plex-detector, and renderer.
 */
(function () {
  'use strict';

  const PA = (globalThis.__PlexAmbilight = globalThis.__PlexAmbilight || {});
  const C = PA.Constants;

  function log(...args) {
    if (C.DEBUG) console.debug('[PlexAmbilight:Content]', ...args);
  }

  // --- State ---
  let detector = null;
  let renderer = null;
  let enabled = C.DEFAULTS.enabled;
  let currentSettings = Object.assign({}, C.DEFAULTS);

  /**
   * Called when the detector finds an active video element.
   * @param {HTMLVideoElement} video
   * @param {HTMLElement} container
   */
  function onVideoFound(video, container) {
    log('Video found, starting renderer');

    // Stop any existing renderer
    if (renderer) {
      renderer.stop();
      renderer = null;
    }

    if (!enabled) {
      log('Ambilight disabled, skipping renderer start');
      return;
    }

    renderer = PA.createRenderer(video, container);
    renderer.updateSettings(currentSettings);
    renderer.start();
  }

  /**
   * Called when the detector loses the video element.
   */
  function onVideoLost() {
    log('Video lost, stopping renderer');
    if (renderer) {
      renderer.stop();
      renderer = null;
    }
  }

  /**
   * Load settings from storage and apply.
   */
  async function loadSettings() {
    try {
      const settings = await PA.Storage.getSettings();
      enabled = settings.enabled;
      currentSettings = settings;

      if (renderer) {
        if (enabled) {
          renderer.updateSettings(currentSettings);
        } else {
          renderer.stop();
          renderer = null;
        }
      } else if (enabled && detector) {
        // Re-check for video if we just got enabled
        const video = detector.getVideo();
        const container = detector.getContainer();
        if (video && container) {
          onVideoFound(video, container);
        }
      }
    } catch (err) {
      log('Failed to load settings:', err);
    }
  }

  /**
   * Handle state change messages from background/popup.
   */
  PA.Messaging.onMessage(C.MSG_STATE_CHANGED, (data) => {
    if (data && data.enabled !== undefined) {
      enabled = data.enabled;
      log('State changed: enabled =', enabled);

      if (!enabled && renderer) {
        renderer.stop();
        renderer = null;
      } else if (enabled && !renderer && detector) {
        const video = detector.getVideo();
        const container = detector.getContainer();
        if (video && container) {
          onVideoFound(video, container);
        }
      }
    }
  });

  /**
   * Listen for storage changes (from popup sliders).
   */
  PA.Storage.onChange((changes) => {
    if (changes[C.STORAGE_KEY_ENABLED]) {
      enabled = changes[C.STORAGE_KEY_ENABLED].newValue;
      log('Enabled changed via storage:', enabled);

      if (!enabled && renderer) {
        renderer.stop();
        renderer = null;
      } else if (enabled && !renderer && detector) {
        const video = detector.getVideo();
        const container = detector.getContainer();
        if (video && container) {
          onVideoFound(video, container);
        }
      }
    }

    if (changes[C.STORAGE_KEY_SETTINGS]) {
      const newSettings = changes[C.STORAGE_KEY_SETTINGS].newValue;
      Object.assign(currentSettings, newSettings);
      if (renderer && enabled) {
        renderer.updateSettings(currentSettings);
      }
    }
  });

  /**
   * Initialize: load settings, start detector.
   */
  async function init() {
    log('Initializing Plex Ambilight');

    await loadSettings();

    detector = PA.createDetector({
      onVideoFound,
      onVideoLost,
    });

    detector.start();
    log('Detector started, waiting for video...');
  }

  // Start when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
