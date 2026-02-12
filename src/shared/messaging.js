/**
 * Plex Ambilight - Chrome extension messaging helpers.
 * Wraps chrome.runtime messaging with typed message objects.
 */
(function () {
  'use strict';

  const PA = (globalThis.__PlexAmbilight = globalThis.__PlexAmbilight || {});
  const C = PA.Constants;

  const Messaging = {};

  /**
   * Send a message to the background service worker.
   * @param {string} type - Message type from Constants.MSG_*
   * @param {object} [data] - Optional payload
   * @returns {Promise<any>} Response from the handler
   */
  Messaging.sendToBackground = function (type, data) {
    return chrome.runtime.sendMessage({ type, data });
  };

  /**
   * Send a message to a specific tab's content script.
   * @param {number} tabId
   * @param {string} type
   * @param {object} [data]
   * @returns {Promise<any>}
   */
  Messaging.sendToTab = function (tabId, type, data) {
    return chrome.tabs.sendMessage(tabId, { type, data });
  };

  /**
   * Register a message handler. Handlers receive (data, sender) and
   * may return a value or a Promise (the listener automatically calls
   * sendResponse for async handlers).
   * @param {string} type
   * @param {(data: any, sender: chrome.runtime.MessageSender) => any} handler
   */
  Messaging.onMessage = function (type, handler) {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type !== type) return false;

      const result = handler(message.data, sender);

      if (result instanceof Promise) {
        result
          .then((val) => sendResponse(val))
          .catch((err) => {
            if (C.DEBUG) console.debug('[PlexAmbilight] Message handler error:', err);
            sendResponse({ error: err.message });
          });
        return true; // keep channel open for async
      }

      sendResponse(result);
      return false;
    });
  };

  /**
   * Convenience: toggle ambilight and notify background.
   * @returns {Promise<boolean>} New enabled state
   */
  Messaging.requestToggle = async function () {
    const response = await Messaging.sendToBackground(C.MSG_TOGGLE);
    return response?.enabled;
  };

  PA.Messaging = Messaging;
})();
