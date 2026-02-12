/**
 * Plex Ambilight - In-player settings controls.
 *
 * Injects a lightbulb icon button into the Plex player control bar.
 * Clicking it opens a Shadow DOM-encapsulated settings panel with
 * the same toggle + sliders as the popup. Settings stay synced via
 * chrome.storage. A MutationObserver re-injects the button when
 * Plex re-renders its controls (SPA navigation, fullscreen toggle, etc.).
 */
(function () {
  'use strict';

  const PA = (globalThis.__PlexAmbilight = globalThis.__PlexAmbilight || {});
  const C = PA.Constants;

  function log(...args) {
    if (C.DEBUG) console.debug('[PlexAmbilight:PlayerControls]', ...args);
  }

  // SVG lightbulb icon (24x24, matches Plex icon sizing)
  const ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M9 18h6"/>' +
    '<path d="M10 22h4"/>' +
    '<path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5C8.35 12.26 8.82 13.02 9 14"/>' +
    '</svg>';

  // --- Shadow DOM styles for the panel ---
  const PANEL_STYLES = `
    :host {
      display: inline-flex;
      align-items: center;
      position: relative;
      pointer-events: auto;
    }

    .pa-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 36px;
      height: 36px;
      background: none;
      border: none;
      cursor: pointer;
      color: hsla(0, 0%, 100%, 0.7);
      border-radius: 4px;
      transition: color 0.15s, background 0.15s;
      padding: 0;
    }
    .pa-btn:hover {
      color: #fff;
      background: hsla(0, 0%, 100%, 0.1);
    }
    .pa-btn.active {
      color: #e5a00d;
    }

    .pa-panel {
      display: none;
      position: absolute;
      bottom: calc(100% + 8px);
      left: -8px;
      width: 220px;
      background: rgba(30, 30, 34, 0.95);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 10px;
      padding: 14px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
      z-index: 999;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 13px;
      color: #e0e0e0;
    }
    .pa-panel.open {
      display: block;
    }

    .pa-panel-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 12px;
    }
    .pa-panel-title {
      font-size: 13px;
      font-weight: 600;
      color: #f0f0f0;
    }

    /* Toggle */
    .pa-toggle {
      position: relative;
      width: 36px;
      height: 20px;
      background: #444;
      border: none;
      border-radius: 10px;
      cursor: pointer;
      transition: background 0.2s;
      padding: 0;
      flex-shrink: 0;
    }
    .pa-toggle[aria-checked="true"] {
      background: #e5a00d;
    }
    .pa-toggle-knob {
      position: absolute;
      top: 2px;
      left: 2px;
      width: 16px;
      height: 16px;
      background: #fff;
      border-radius: 50%;
      transition: transform 0.2s;
      pointer-events: none;
    }
    .pa-toggle[aria-checked="true"] .pa-toggle-knob {
      transform: translateX(16px);
    }

    /* Settings rows */
    .pa-settings {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding-top: 10px;
      border-top: 1px solid rgba(255, 255, 255, 0.08);
    }
    .pa-settings.hidden {
      display: none;
    }
    .pa-setting {
      display: grid;
      grid-template-columns: 52px 1fr 36px;
      align-items: center;
      gap: 6px;
    }
    .pa-setting label {
      font-size: 11px;
      color: #aaa;
    }
    .pa-setting-value {
      font-size: 10px;
      color: #888;
      text-align: right;
      font-variant-numeric: tabular-nums;
    }

    /* Range input */
    input[type="range"] {
      -webkit-appearance: none;
      appearance: none;
      width: 100%;
      height: 3px;
      background: #333;
      border-radius: 2px;
      outline: none;
      margin: 0;
    }
    input[type="range"]::-webkit-slider-thumb {
      -webkit-appearance: none;
      appearance: none;
      width: 12px;
      height: 12px;
      background: #e5a00d;
      border-radius: 50%;
      cursor: pointer;
    }
    input[type="range"]::-moz-range-thumb {
      width: 12px;
      height: 12px;
      background: #e5a00d;
      border: none;
      border-radius: 50%;
      cursor: pointer;
    }
  `;

  /**
   * Creates a player controls instance that injects into the Plex control bar.
   * @returns {{ inject: (container: HTMLElement) => void, remove: () => void, updateState: (enabled: boolean, settings: object) => void }}
   */
  function createPlayerControls() {
    let host = null;       // The custom element host
    let shadow = null;     // Shadow root
    let panelOpen = false;
    let controlsObserver = null;
    let injected = false;
    let currentContainer = null;

    // Internal state (synced from storage)
    let enabled = C.DEFAULTS.enabled;
    let settings = {
      intensity: C.DEFAULTS.intensity,
      spread: C.DEFAULTS.spread,
      blurRadius: C.DEFAULTS.blurRadius,
    };

    // DOM refs inside shadow
    let btnEl = null;
    let panelEl = null;
    let toggleEl = null;
    let settingsSectionEl = null;
    let intensityInput = null;
    let intensityValueEl = null;
    let spreadInput = null;
    let spreadValueEl = null;
    let blurInput = null;
    let blurValueEl = null;

    /**
     * Build the Shadow DOM structure.
     */
    function buildDOM() {
      host = document.createElement('div');
      host.id = C.PLAYER_CONTROLS_ID;

      shadow = host.attachShadow({ mode: 'closed' });

      // Styles
      const style = document.createElement('style');
      style.textContent = PANEL_STYLES;
      shadow.appendChild(style);

      // Button
      btnEl = document.createElement('button');
      btnEl.className = 'pa-btn' + (enabled ? ' active' : '');
      btnEl.title = 'Ambilight Settings';
      btnEl.innerHTML = ICON_SVG;
      btnEl.addEventListener('click', onButtonClick);
      shadow.appendChild(btnEl);

      // Panel
      panelEl = document.createElement('div');
      panelEl.className = 'pa-panel';
      panelEl.addEventListener('click', function (e) { e.stopPropagation(); });
      shadow.appendChild(panelEl);

      // Panel header: title + toggle
      const header = document.createElement('div');
      header.className = 'pa-panel-header';

      const title = document.createElement('span');
      title.className = 'pa-panel-title';
      title.textContent = 'Ambilight';
      header.appendChild(title);

      toggleEl = document.createElement('button');
      toggleEl.className = 'pa-toggle';
      toggleEl.setAttribute('role', 'switch');
      toggleEl.setAttribute('aria-checked', String(enabled));
      toggleEl.innerHTML = '<span class="pa-toggle-knob"></span>';
      toggleEl.addEventListener('click', onToggleClick);
      header.appendChild(toggleEl);

      panelEl.appendChild(header);

      // Settings section
      settingsSectionEl = document.createElement('div');
      settingsSectionEl.className = 'pa-settings' + (enabled ? '' : ' hidden');

      // Intensity
      const intensityRow = createSliderRow(
        'Intensity', 'pa-intensity', 0.1, 1.0, 0.05, settings.intensity,
        function (v) { return Math.round(v * 100) + '%'; }
      );
      intensityInput = intensityRow.input;
      intensityValueEl = intensityRow.valueEl;
      settingsSectionEl.appendChild(intensityRow.row);

      // Spread
      const spreadRow = createSliderRow(
        'Spread', 'pa-spread', 40, 250, 10, settings.spread,
        function (v) { return v + 'px'; }
      );
      spreadInput = spreadRow.input;
      spreadValueEl = spreadRow.valueEl;
      settingsSectionEl.appendChild(spreadRow.row);

      // Blur
      const blurRow = createSliderRow(
        'Blur', 'pa-blur', 20, 160, 5, settings.blurRadius,
        function (v) { return v + 'px'; }
      );
      blurInput = blurRow.input;
      blurValueEl = blurRow.valueEl;
      settingsSectionEl.appendChild(blurRow.row);

      panelEl.appendChild(settingsSectionEl);
    }

    /**
     * Helper: build a slider setting row.
     */
    function createSliderRow(label, id, min, max, step, value, format) {
      const row = document.createElement('div');
      row.className = 'pa-setting';

      const lbl = document.createElement('label');
      lbl.setAttribute('for', id);
      lbl.textContent = label;
      row.appendChild(lbl);

      const input = document.createElement('input');
      input.type = 'range';
      input.id = id;
      input.min = String(min);
      input.max = String(max);
      input.step = String(step);
      input.value = String(value);
      input.addEventListener('input', onSliderInput);
      row.appendChild(input);

      const valueEl = document.createElement('span');
      valueEl.className = 'pa-setting-value';
      valueEl.textContent = format(value);
      row.appendChild(valueEl);

      return { row, input, valueEl, format };
    }

    // --- Event handlers ---

    function onButtonClick(e) {
      e.stopPropagation();
      panelOpen = !panelOpen;
      panelEl.classList.toggle('open', panelOpen);
      if (panelOpen) {
        // Close on outside click (next tick to avoid catching this click)
        setTimeout(function () {
          document.addEventListener('click', onDocumentClick, { once: true, capture: true });
        }, 0);
      }
    }

    function onDocumentClick() {
      panelOpen = false;
      if (panelEl) panelEl.classList.remove('open');
    }

    async function onToggleClick() {
      try {
        const newEnabled = await PA.Messaging.requestToggle();
        if (newEnabled !== undefined) {
          enabled = newEnabled;
          applyStateToDOM();
        }
      } catch (err) {
        log('Toggle error:', err);
      }
    }

    let saveTimer = null;
    function onSliderInput() {
      // Update display values immediately
      intensityValueEl.textContent = Math.round(intensityInput.value * 100) + '%';
      spreadValueEl.textContent = spreadInput.value + 'px';
      blurValueEl.textContent = blurInput.value + 'px';

      // Debounce save
      clearTimeout(saveTimer);
      saveTimer = setTimeout(saveSliderSettings, 300);
    }

    async function saveSliderSettings() {
      try {
        const result = await chrome.storage.sync.get(C.STORAGE_KEY_SETTINGS);
        const current = result[C.STORAGE_KEY_SETTINGS] || {};

        const updated = Object.assign({}, current, {
          intensity: parseFloat(intensityInput.value),
          spread: parseInt(spreadInput.value, 10),
          blurRadius: parseInt(blurInput.value, 10),
        });

        await chrome.storage.sync.set({ [C.STORAGE_KEY_SETTINGS]: updated });
      } catch (err) {
        log('Settings save error:', err);
      }
    }

    /**
     * Apply current enabled/settings state to DOM elements.
     */
    function applyStateToDOM() {
      if (!btnEl) return;
      btnEl.classList.toggle('active', enabled);
      toggleEl.setAttribute('aria-checked', String(enabled));
      settingsSectionEl.classList.toggle('hidden', !enabled);
    }

    // --- Control bar detection & injection ---

    /**
     * Find the insertion point for our icon next to the ⋮ ellipsis.
     * Uses a bottom-up approach: find Plex icon buttons (they contain
     * SVGs), then identify their shared parent container.
     * Returns { parent, refChild } where we should insertBefore(host, refChild).
     * @param {HTMLElement} container
     * @returns {{ parent: HTMLElement, refChild: HTMLElement|null }|null}
     */
    function findInsertionPoint(container) {
      // Strategy 1: find the More (⋮) button, then locate the nearest
      // sibling icon button row and insert at its start.
      for (const sel of C.PLEX_MORE_BUTTON_SELECTORS) {
        const moreBtn = container.querySelector(sel) || document.querySelector(sel);
        if (!moreBtn) continue;

        // The ⋮ and icon buttons might be direct siblings
        var next = moreBtn.nextElementSibling;
        while (next) {
          // If the next sibling is a button or contains buttons, insert before it
          if (next.tagName === 'BUTTON' || next.querySelectorAll('button').length > 0) {
            return { parent: moreBtn.parentElement, refChild: next };
          }
          next = next.nextElementSibling;
        }

        // If ⋮ has no button siblings, insert right after it
        return { parent: moreBtn.parentElement, refChild: moreBtn.nextElementSibling };
      }

      // Strategy 2: bottom-up — find all buttons with SVGs in the
      // controls area. Group by parent to find the icon row.
      var scope = null;
      for (const sel of C.PLEX_CONTROLS_SELECTORS) {
        scope = container.querySelector(sel) || document.querySelector(sel);
        if (scope) break;
      }
      if (!scope) return null;

      var svgButtons = scope.querySelectorAll('button:has(svg)');
      if (svgButtons.length < 2) return null;

      // Find the most common parent among SVG buttons (the icon row)
      var parentCounts = new Map();
      for (var i = 0; i < svgButtons.length; i++) {
        var p = svgButtons[i].parentElement;
        parentCounts.set(p, (parentCounts.get(p) || 0) + 1);
      }

      var bestParent = null;
      var bestCount = 0;
      parentCounts.forEach(function (count, p) {
        if (count > bestCount) {
          bestCount = count;
          bestParent = p;
        }
      });

      if (bestParent) {
        return { parent: bestParent, refChild: bestParent.firstChild };
      }

      return null;
    }

    /**
     * Inject the controls button into the Plex player.
     * @param {HTMLElement} container - The player container from plex-detector
     */
    function inject(container) {
      currentContainer = container;

      if (!host) buildDOM();

      tryInject();

      // Watch for Plex re-rendering controls (SPA navigation, fullscreen, etc.)
      if (controlsObserver) controlsObserver.disconnect();
      controlsObserver = new MutationObserver(function () {
        if (!document.contains(host)) {
          injected = false;
          tryInject();
        }
      });
      controlsObserver.observe(container, { childList: true, subtree: true });
      // Also observe body for cases where controls are outside the container
      controlsObserver.observe(document.body, { childList: true, subtree: false });
    }

    /**
     * Attempt to place the button next to the ⋮ ellipsis in the icon row.
     */
    function tryInject() {
      if (injected && document.contains(host)) return;

      var point = findInsertionPoint(currentContainer);
      if (point) {
        point.parent.insertBefore(host, point.refChild);
        injected = true;
        log('Controls injected into', point.parent.className);
      } else {
        // Controls not rendered yet — retry shortly
        injected = false;
        setTimeout(function () {
          if (!injected && currentContainer) tryInject();
        }, C.PLAYER_CONTROLS_REINJECT_DELAY);
      }
    }

    /**
     * Remove the controls from the DOM and clean up.
     */
    function remove() {
      panelOpen = false;
      if (controlsObserver) {
        controlsObserver.disconnect();
        controlsObserver = null;
      }
      if (host && host.parentElement) {
        host.parentElement.removeChild(host);
      }
      injected = false;
      currentContainer = null;
      document.removeEventListener('click', onDocumentClick, { capture: true });
      log('Controls removed');
    }

    /**
     * Update visible state from external source (storage change).
     * @param {boolean} newEnabled
     * @param {object} newSettings
     */
    function updateState(newEnabled, newSettings) {
      if (newEnabled !== undefined) enabled = newEnabled;
      if (newSettings) {
        if (newSettings.intensity !== undefined) settings.intensity = newSettings.intensity;
        if (newSettings.spread !== undefined) settings.spread = newSettings.spread;
        if (newSettings.blurRadius !== undefined) settings.blurRadius = newSettings.blurRadius;

        // Sync slider values
        if (intensityInput) {
          intensityInput.value = String(settings.intensity);
          intensityValueEl.textContent = Math.round(settings.intensity * 100) + '%';
        }
        if (spreadInput) {
          spreadInput.value = String(settings.spread);
          spreadValueEl.textContent = settings.spread + 'px';
        }
        if (blurInput) {
          blurInput.value = String(settings.blurRadius);
          blurValueEl.textContent = settings.blurRadius + 'px';
        }
      }

      applyStateToDOM();
    }

    return { inject, remove, updateState };
  }

  PA.createPlayerControls = createPlayerControls;
})();
