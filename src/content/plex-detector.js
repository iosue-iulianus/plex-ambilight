/**
 * Plex Ambilight - Plex video player detector.
 * Uses MutationObserver + polling fallback to reliably detect when a
 * <video> element is active in the Plex Web SPA.
 */
(function () {
  'use strict';

  const PA = (globalThis.__PlexAmbilight = globalThis.__PlexAmbilight || {});
  const C = PA.Constants;

  function log(...args) {
    if (C.DEBUG) console.debug('[PlexAmbilight:Detector]', ...args);
  }

  /**
   * @typedef {Object} DetectorCallbacks
   * @property {(video: HTMLVideoElement, container: HTMLElement) => void} onVideoFound
   * @property {() => void} onVideoLost
   */

  /**
   * Creates a Plex video detector instance.
   * @param {DetectorCallbacks} callbacks
   * @returns {{ start: () => void, stop: () => void, getVideo: () => HTMLVideoElement|null }}
   */
  function createDetector(callbacks) {
    let activeVideo = null;
    let activeContainer = null;
    let observer = null;
    let pollTimer = null;
    let running = false;

    /**
     * Find the player container element for a given video.
     * Walks up the DOM looking for known Plex player container patterns.
     * @param {HTMLVideoElement} video
     * @returns {HTMLElement}
     */
    function findPlayerContainer(video) {
      // Try known selectors first
      for (const sel of C.PLEX_PLAYER_CONTAINER_SELECTORS) {
        const match = video.closest(sel);
        if (match) return match;
      }

      // Heuristic: walk up to find a container that is significantly larger
      // than the video and looks like a player wrapper
      let el = video.parentElement;
      while (el && el !== document.body) {
        const rect = el.getBoundingClientRect();
        if (rect.width >= window.innerWidth * 0.5 && rect.height >= window.innerHeight * 0.5) {
          return el;
        }
        el = el.parentElement;
      }

      // Fallback: use direct parent
      return video.parentElement || document.body;
    }

    /**
     * Check if a video element is actively playing or ready to play.
     * @param {HTMLVideoElement} video
     * @returns {boolean}
     */
    function isVideoActive(video) {
      return (
        video.readyState >= C.MIN_VIDEO_READY_STATE &&
        video.videoWidth > 0 &&
        video.videoHeight > 0 &&
        !video.ended &&
        (video.src || video.srcObject || video.querySelector('source'))
      );
    }

    /**
     * Scan the DOM for an active video element.
     * @returns {{ video: HTMLVideoElement, container: HTMLElement } | null}
     */
    function scanForVideo() {
      const videos = document.querySelectorAll(C.PLEX_VIDEO_SELECTOR);
      for (const video of videos) {
        if (isVideoActive(video)) {
          return {
            video,
            container: findPlayerContainer(video),
          };
        }
      }
      return null;
    }

    /**
     * Core detection check — called by both observer and poll.
     */
    function detect() {
      const found = scanForVideo();

      if (found && found.video !== activeVideo) {
        // New video detected (or different video element)
        if (activeVideo) {
          cleanupVideoListeners();
          callbacks.onVideoLost();
        }
        activeVideo = found.video;
        activeContainer = found.container;
        attachVideoListeners();
        const cRect = activeContainer.getBoundingClientRect();
        log(
          'Video found', activeVideo.videoWidth + 'x' + activeVideo.videoHeight,
          '| Container:', activeContainer.tagName +
            (activeContainer.id ? '#' + activeContainer.id : '') +
            (activeContainer.className ? '.' + String(activeContainer.className).split(' ').join('.') : ''),
          '| Container rect:', Math.round(cRect.width) + 'x' + Math.round(cRect.height),
          'at', Math.round(cRect.left) + ',' + Math.round(cRect.top)
        );
        callbacks.onVideoFound(activeVideo, activeContainer);
      } else if (!found && activeVideo) {
        // Video was removed
        log('Video lost');
        cleanupVideoListeners();
        activeVideo = null;
        activeContainer = null;
        callbacks.onVideoLost();
      }
    }

    /**
     * Listen for the video element being removed or ending.
     */
    function attachVideoListeners() {
      if (!activeVideo) return;
      activeVideo.addEventListener('emptied', onVideoEnded);
      activeVideo.addEventListener('error', onVideoEnded);
    }

    function cleanupVideoListeners() {
      if (!activeVideo) return;
      activeVideo.removeEventListener('emptied', onVideoEnded);
      activeVideo.removeEventListener('error', onVideoEnded);
    }

    function onVideoEnded() {
      if (!running) return;
      log('Video ended/errored');
      cleanupVideoListeners();
      activeVideo = null;
      activeContainer = null;
      callbacks.onVideoLost();
    }

    /**
     * Start observing.
     */
    function start() {
      if (running) return;
      running = true;
      log('Starting detection');

      // Initial scan
      detect();

      // MutationObserver for DOM changes (Plex SPA navigation)
      // Debounced to avoid forcing synchronous layout on every mutation.
      let detectTimer = null;
      observer = new MutationObserver(() => {
        if (detectTimer) return;
        detectTimer = setTimeout(() => {
          detectTimer = null;
          detect();
        }, 200);
      });
      observer.observe(document.body, {
        childList: true,
        subtree: true,
      });

      // Polling fallback for cases MutationObserver might miss
      // (e.g., video src changes, readyState transitions)
      pollTimer = setInterval(detect, C.DETECTION_POLL_INTERVAL);
    }

    /**
     * Stop observing and clean up.
     */
    function stop() {
      if (!running) return;
      running = false;
      log('Stopping detection');

      if (observer) {
        observer.disconnect();
        observer = null;
      }

      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }

      cleanupVideoListeners();

      if (activeVideo) {
        activeVideo = null;
        activeContainer = null;
        callbacks.onVideoLost();
      }
    }

    return {
      start,
      stop,
      getVideo: () => activeVideo,
      getContainer: () => activeContainer,
    };
  }

  PA.createDetector = createDetector;
})();
