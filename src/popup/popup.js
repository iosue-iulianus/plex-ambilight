/**
 * Plex Ambilight - Popup script.
 * Controls the on/off toggle and settings sliders.
 */
(function () {
  'use strict';

  // Constants (duplicated from shared/constants.js since popup loads independently)
  const STORAGE_KEY_ENABLED = 'plex_ambilight_enabled';
  const STORAGE_KEY_SETTINGS = 'plex_ambilight_settings';
  const MSG_TOGGLE = 'toggle_ambilight';
  const MSG_GET_STATE = 'get_state';
  const DEFAULTS = {
    enabled: true,
    intensity: 0.7,
    spread: 120,
    blurRadius: 80,
  };

  // DOM elements
  const toggleBtn = document.getElementById('toggle-btn');
  const statusDot = document.getElementById('status-dot');
  const statusText = document.getElementById('status-text');
  const settingsSection = document.getElementById('settings-section');
  const intensityInput = document.getElementById('intensity');
  const intensityValue = document.getElementById('intensity-value');
  const spreadInput = document.getElementById('spread');
  const spreadValue = document.getElementById('spread-value');
  const blurInput = document.getElementById('blur');
  const blurValue = document.getElementById('blur-value');

  /** Update the UI to reflect the given enabled state. */
  function setToggleState(enabled) {
    toggleBtn.setAttribute('aria-checked', String(enabled));
    statusDot.className = 'status-dot ' + (enabled ? 'active' : 'disabled');
    statusText.textContent = enabled ? 'Active' : 'Disabled';
    settingsSection.classList.toggle('hidden', !enabled);
  }

  /** Update slider display values. */
  function updateSliderDisplays() {
    intensityValue.textContent = Math.round(intensityInput.value * 100) + '%';
    spreadValue.textContent = spreadInput.value + 'px';
    blurValue.textContent = blurInput.value + 'px';
  }

  /** Load settings from storage and apply to UI. */
  async function loadState() {
    try {
      const result = await chrome.storage.sync.get([
        STORAGE_KEY_ENABLED,
        STORAGE_KEY_SETTINGS,
      ]);

      const enabled =
        result[STORAGE_KEY_ENABLED] !== undefined
          ? result[STORAGE_KEY_ENABLED]
          : DEFAULTS.enabled;

      const settings = result[STORAGE_KEY_SETTINGS] || {};

      setToggleState(enabled);

      intensityInput.value = settings.intensity ?? DEFAULTS.intensity;
      spreadInput.value = settings.spread ?? DEFAULTS.spread;
      blurInput.value = settings.blurRadius ?? DEFAULTS.blurRadius;

      updateSliderDisplays();
    } catch (err) {
      statusText.textContent = 'Error loading settings';
      console.error('[PlexAmbilight] Popup load error:', err);
    }
  }

  /** Save slider settings to storage. */
  async function saveSliderSettings() {
    try {
      const result = await chrome.storage.sync.get(STORAGE_KEY_SETTINGS);
      const current = result[STORAGE_KEY_SETTINGS] || {};

      const updated = Object.assign({}, current, {
        intensity: parseFloat(intensityInput.value),
        spread: parseInt(spreadInput.value, 10),
        blurRadius: parseInt(blurInput.value, 10),
      });

      await chrome.storage.sync.set({ [STORAGE_KEY_SETTINGS]: updated });
    } catch (err) {
      console.error('[PlexAmbilight] Settings save error:', err);
    }
  }

  // --- Event listeners ---

  toggleBtn.addEventListener('click', async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: MSG_TOGGLE });
      if (response && response.enabled !== undefined) {
        setToggleState(response.enabled);
      }
    } catch (err) {
      console.error('[PlexAmbilight] Toggle error:', err);
    }
  });

  // Debounce slider saves
  let saveTimer = null;
  function onSliderInput() {
    updateSliderDisplays();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveSliderSettings, 300);
  }

  intensityInput.addEventListener('input', onSliderInput);
  spreadInput.addEventListener('input', onSliderInput);
  blurInput.addEventListener('input', onSliderInput);

  // Listen for external state changes
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;

    if (changes[STORAGE_KEY_ENABLED]) {
      setToggleState(changes[STORAGE_KEY_ENABLED].newValue);
    }
  });

  // Init
  loadState();
})();
