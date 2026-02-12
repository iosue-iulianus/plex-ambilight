/**
 * Plex Ambilight - Background service worker.
 * Manages extension state, message routing, and badge icon updates.
 */

// MV3 service worker (declared as module in manifest.json).
// Cannot share the IIFE globals with content scripts, so constants are inlined.
const STORAGE_KEY_ENABLED = 'plex_ambilight_enabled';
const MSG_TOGGLE = 'toggle_ambilight';
const MSG_GET_STATE = 'get_state';
const MSG_STATE_CHANGED = 'state_changed';
const DEFAULT_ENABLED = true;

/**
 * Update the extension badge to reflect on/off state.
 * @param {boolean} enabled
 */
async function updateBadge(enabled) {
  const text = enabled ? '' : 'OFF';
  const color = enabled ? [255, 180, 40, 255] : [128, 128, 128, 255];

  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color });
}

/**
 * Get the current enabled state from storage.
 * @returns {Promise<boolean>}
 */
async function getEnabled() {
  const result = await chrome.storage.sync.get(STORAGE_KEY_ENABLED);
  return result[STORAGE_KEY_ENABLED] !== undefined
    ? result[STORAGE_KEY_ENABLED]
    : DEFAULT_ENABLED;
}

/**
 * Toggle the enabled state and persist it.
 * @returns {Promise<boolean>} The new enabled state.
 */
async function toggleEnabled() {
  const current = await getEnabled();
  const next = !current;
  await chrome.storage.sync.set({ [STORAGE_KEY_ENABLED]: next });
  await updateBadge(next);
  return next;
}

// --- Message handlers ---

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === MSG_TOGGLE) {
    toggleEnabled().then((enabled) => {
      // Notify all Plex tabs about the state change
      broadcastStateChange(enabled);
      sendResponse({ enabled });
    });
    return true; // async
  }

  if (message.type === MSG_GET_STATE) {
    getEnabled().then((enabled) => {
      sendResponse({ enabled });
    });
    return true; // async
  }

  return false;
});

/**
 * Broadcast state change to all tabs matching Plex URLs.
 * @param {boolean} enabled
 */
async function broadcastStateChange(enabled) {
  try {
    const tabs = await chrome.tabs.query({ url: '*://app.plex.tv/*' });
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, {
        type: MSG_STATE_CHANGED,
        data: { enabled },
      }).catch(() => {
        // Tab may not have content script loaded yet
      });
    }
  } catch {
    // Query may fail if no tabs match
  }
}

// --- Storage change listener for badge sync ---

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes[STORAGE_KEY_ENABLED]) {
    updateBadge(changes[STORAGE_KEY_ENABLED].newValue);
  }
});

// --- Init on install/startup ---

chrome.runtime.onInstalled.addListener(async () => {
  const enabled = await getEnabled();
  await updateBadge(enabled);
});

chrome.runtime.onStartup.addListener(async () => {
  const enabled = await getEnabled();
  await updateBadge(enabled);
});
