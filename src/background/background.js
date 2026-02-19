/**
 * Plex Ambilight - Background service worker.
 * Manages extension state, message routing, and badge icon updates.
 */

// MV3 service worker (declared as module in manifest.json).
// Cannot share the IIFE globals with content scripts, so constants are inlined.
const STORAGE_KEY_ENABLED = 'plex_ambilight_enabled';
const STORAGE_KEY_CUSTOM_DOMAINS = 'plex_ambilight_custom_domains';
const MSG_TOGGLE = 'toggle_ambilight';
const MSG_GET_STATE = 'get_state';
const MSG_STATE_CHANGED = 'state_changed';
const MSG_GET_DOMAINS = 'get_custom_domains';
const MSG_ADD_DOMAIN = 'add_custom_domain';
const MSG_REMOVE_DOMAIN = 'remove_custom_domain';
const DEFAULT_ENABLED = true;
const DEFAULT_DOMAIN = 'app.plex.tv';
const DYNAMIC_SCRIPT_ID = 'plex-ambilight-custom-domains';

const CONTENT_SCRIPTS_JS = [
  'src/shared/constants.js',
  'src/shared/storage.js',
  'src/shared/messaging.js',
  'src/content/plex-detector.js',
  'src/content/renderer.js',
  'src/content/player-controls.js',
  'src/content/content.js',
];
const CONTENT_SCRIPTS_CSS = ['src/content/styles.css'];

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

// --- Custom domain helpers ---

/**
 * Get the list of custom domains from storage.
 * @returns {Promise<string[]>}
 */
async function getCustomDomains() {
  const result = await chrome.storage.sync.get(STORAGE_KEY_CUSTOM_DOMAINS);
  return result[STORAGE_KEY_CUSTOM_DOMAINS] || [];
}

/**
 * Save the list of custom domains to storage.
 * @param {string[]} domains
 */
async function saveCustomDomains(domains) {
  await chrome.storage.sync.set({ [STORAGE_KEY_CUSTOM_DOMAINS]: domains });
}

/**
 * Build URL match patterns for a domain (e.g. "plex.example.com" → "*://plex.example.com/*").
 * @param {string} domain
 * @returns {string}
 */
function domainToPattern(domain) {
  return `*://${domain}/*`;
}

/**
 * Register (or re-register) a single dynamic content script covering all custom domains.
 * Called whenever the custom domain list changes.
 */
async function updateDynamicContentScripts() {
  const domains = await getCustomDomains();

  // Always unregister first to avoid "already exists" errors
  try {
    await chrome.scripting.unregisterContentScripts({ ids: [DYNAMIC_SCRIPT_ID] });
  } catch {
    // Script may not exist yet — that's fine
  }

  if (domains.length === 0) return;

  const matches = domains.map(domainToPattern);

  try {
    await chrome.scripting.registerContentScripts([
      {
        id: DYNAMIC_SCRIPT_ID,
        matches,
        js: CONTENT_SCRIPTS_JS,
        css: CONTENT_SCRIPTS_CSS,
        runAt: 'document_idle',
      },
    ]);
  } catch (err) {
    console.error('[PlexAmbilight] Failed to register dynamic content scripts:', err);
  }
}

/**
 * Add a custom domain. Assumes host permission was already granted by the popup.
 * @param {string} domain
 * @returns {Promise<{domains: string[]}>}
 */
async function addCustomDomain(domain) {
  // Normalize: strip protocol, trailing slashes, paths
  domain = domain
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .toLowerCase()
    .trim();

  if (!domain || domain === DEFAULT_DOMAIN) {
    return { domains: await getCustomDomains() };
  }

  const domains = await getCustomDomains();
  if (domains.includes(domain)) {
    return { domains };
  }

  domains.push(domain);
  await saveCustomDomains(domains);
  await updateDynamicContentScripts();
  return { domains };
}

/**
 * Remove a custom domain. Returns the updated list.
 * @param {string} domain
 * @returns {Promise<string[]>}
 */
async function removeCustomDomain(domain) {
  const domains = await getCustomDomains();
  const idx = domains.indexOf(domain);
  if (idx !== -1) {
    domains.splice(idx, 1);
    await saveCustomDomains(domains);
    await updateDynamicContentScripts();
  }
  return domains;
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

  if (message.type === MSG_GET_DOMAINS) {
    getCustomDomains().then((domains) => {
      sendResponse({ domains });
    });
    return true; // async
  }

  if (message.type === MSG_ADD_DOMAIN) {
    addCustomDomain(message.domain).then((result) => {
      sendResponse(result);
    });
    return true; // async
  }

  if (message.type === MSG_REMOVE_DOMAIN) {
    removeCustomDomain(message.domain).then((domains) => {
      sendResponse({ domains });
    });
    return true; // async
  }

  return false;
});

/**
 * Broadcast state change to all tabs matching Plex URLs (default + custom domains).
 * @param {boolean} enabled
 */
async function broadcastStateChange(enabled) {
  try {
    const domains = await getCustomDomains();
    const allDomains = [DEFAULT_DOMAIN, ...domains];
    const urlPatterns = allDomains.map(domainToPattern);

    const tabs = await chrome.tabs.query({ url: urlPatterns });
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
  await updateDynamicContentScripts();
});

chrome.runtime.onStartup.addListener(async () => {
  const enabled = await getEnabled();
  await updateBadge(enabled);
  await updateDynamicContentScripts();
});
