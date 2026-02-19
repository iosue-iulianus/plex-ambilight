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
  const MSG_GET_DOMAINS = 'get_custom_domains';
  const MSG_ADD_DOMAIN = 'add_custom_domain';
  const MSG_REMOVE_DOMAIN = 'remove_custom_domain';
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
  const domainsList = document.getElementById('custom-domains-list');
  const domainInput = document.getElementById('domain-input');
  const domainAddBtn = document.getElementById('domain-add-btn');
  const domainError = document.getElementById('domain-error');

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

  // --- Custom domains ---

  /** Render the custom domains list. */
  function renderDomains(domains) {
    domainsList.innerHTML = '';
    for (const domain of domains) {
      const item = document.createElement('div');
      item.className = 'domain-item';

      const name = document.createElement('span');
      name.className = 'domain-name';
      name.textContent = domain;

      const removeBtn = document.createElement('button');
      removeBtn.className = 'domain-remove-btn';
      removeBtn.title = 'Remove domain';
      removeBtn.textContent = '\u00d7';
      removeBtn.addEventListener('click', () => removeDomain(domain));

      item.appendChild(name);
      item.appendChild(removeBtn);
      domainsList.appendChild(item);
    }
  }

  /** Show a temporary error message. */
  function showDomainError(msg) {
    domainError.textContent = msg;
    domainError.classList.remove('hidden');
    setTimeout(() => domainError.classList.add('hidden'), 3000);
  }

  /** Load and render custom domains from background. */
  async function loadDomains() {
    try {
      const response = await chrome.runtime.sendMessage({ type: MSG_GET_DOMAINS });
      if (response && response.domains) {
        renderDomains(response.domains);
      }
    } catch (err) {
      console.error('[PlexAmbilight] Load domains error:', err);
    }
  }

  /**
   * Normalize a domain string: strip protocol, paths, whitespace.
   * @param {string} raw
   * @returns {string}
   */
  function normalizeDomain(raw) {
    return raw
      .replace(/^https?:\/\//, '')
      .replace(/\/.*$/, '')
      .toLowerCase()
      .trim();
  }

  /** Add a new custom domain. */
  async function addDomain() {
    const raw = domainInput.value.trim();
    if (!raw) return;

    const domain = normalizeDomain(raw);
    if (!domain) return;

    // Request host permission from the popup (requires user gesture)
    const pattern = `*://${domain}/*`;
    try {
      const granted = await chrome.permissions.request({ origins: [pattern] });
      if (!granted) {
        showDomainError('Permission denied for this domain.');
        return;
      }
    } catch (err) {
      showDomainError('Invalid domain format.');
      console.error('[PlexAmbilight] Permission request error:', err);
      return;
    }

    // Tell background to save the domain and register content scripts
    try {
      const response = await chrome.runtime.sendMessage({
        type: MSG_ADD_DOMAIN,
        domain: domain,
      });

      if (response && response.domains) {
        renderDomains(response.domains);
        domainInput.value = '';
        domainError.classList.add('hidden');
      }
    } catch (err) {
      showDomainError('Failed to add domain.');
      console.error('[PlexAmbilight] Add domain error:', err);
    }
  }

  /** Remove a custom domain. */
  async function removeDomain(domain) {
    try {
      const response = await chrome.runtime.sendMessage({
        type: MSG_REMOVE_DOMAIN,
        domain,
      });
      if (response && response.domains) {
        renderDomains(response.domains);
      }
    } catch (err) {
      console.error('[PlexAmbilight] Remove domain error:', err);
    }
  }

  domainAddBtn.addEventListener('click', addDomain);
  domainInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addDomain();
  });

  // Listen for external state changes
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;

    if (changes[STORAGE_KEY_ENABLED]) {
      setToggleState(changes[STORAGE_KEY_ENABLED].newValue);
    }
  });

  // Init
  loadState();
  loadDomains();
})();
