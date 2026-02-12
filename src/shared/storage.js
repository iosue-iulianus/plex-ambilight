/**
 * Plex Ambilight - Storage abstraction over chrome.storage.sync.
 * Provides get/set helpers with defaults from Constants.
 */
(function () {
  'use strict';

  const PA = (globalThis.__PlexAmbilight = globalThis.__PlexAmbilight || {});
  const C = PA.Constants;

  /**
   * @typedef {Object} AmbilightSettings
   * @property {boolean} enabled
   * @property {number} intensity
   * @property {number} spread
   * @property {number} blurRadius
   * @property {number} samplingFps
   * @property {number} edgeStripWidth
   * @property {number} segmentsPerEdge
   * @property {number} transitionDuration
   * @property {{width: number, height: number}} sampleResolution
   */

  const Storage = {};

  /**
   * Get the full settings object, merged with defaults.
   * @returns {Promise<AmbilightSettings>}
   */
  Storage.getSettings = async function () {
    const result = await chrome.storage.sync.get([
      C.STORAGE_KEY_ENABLED,
      C.STORAGE_KEY_SETTINGS,
    ]);

    const saved = result[C.STORAGE_KEY_SETTINGS] || {};
    const enabled =
      result[C.STORAGE_KEY_ENABLED] !== undefined
        ? result[C.STORAGE_KEY_ENABLED]
        : C.DEFAULTS.enabled;

    return Object.assign({}, C.DEFAULTS, saved, { enabled });
  };

  /**
   * Save partial settings (merged with existing).
   * @param {Partial<AmbilightSettings>} partial
   * @returns {Promise<void>}
   */
  Storage.saveSettings = async function (partial) {
    const current = await Storage.getSettings();
    const merged = Object.assign({}, current, partial);

    const data = {};

    // Store enabled flag separately for quick access
    if ('enabled' in partial) {
      data[C.STORAGE_KEY_ENABLED] = merged.enabled;
    }

    // Store the rest under settings key
    const { enabled, ...rest } = merged;
    data[C.STORAGE_KEY_SETTINGS] = rest;

    await chrome.storage.sync.set(data);
  };

  /**
   * Get just the enabled state.
   * @returns {Promise<boolean>}
   */
  Storage.getEnabled = async function () {
    const result = await chrome.storage.sync.get(C.STORAGE_KEY_ENABLED);
    return result[C.STORAGE_KEY_ENABLED] !== undefined
      ? result[C.STORAGE_KEY_ENABLED]
      : C.DEFAULTS.enabled;
  };

  /**
   * Set the enabled state.
   * @param {boolean} enabled
   * @returns {Promise<void>}
   */
  Storage.setEnabled = async function (enabled) {
    await chrome.storage.sync.set({ [C.STORAGE_KEY_ENABLED]: enabled });
  };

  /**
   * Listen for storage changes.
   * @param {(changes: object) => void} callback
   */
  Storage.onChange = function (callback) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'sync') {
        callback(changes);
      }
    });
  };

  PA.Storage = Storage;
})();
