/**
 * Plex Ambilight - Canvas-based ambilight renderer.
 *
 * Architecture:
 * 1. Samples video frames onto a tiny offscreen canvas (64x36)
 * 2. Extracts edge strips (top/right/bottom/left) onto 4 micro-canvases
 * 3. Those micro-canvases are displayed as DOM elements with CSS filter: blur()
 *    to create the ambient glow
 * 4. Uses requestVideoFrameCallback (primary) or requestAnimationFrame (fallback)
 * 5. Exponential color smoothing between frames for smooth transitions
 */
(function () {
  'use strict';

  const PA = (globalThis.__PlexAmbilight = globalThis.__PlexAmbilight || {});
  const C = PA.Constants;

  function log(...args) {
    if (C.DEBUG) console.debug('[PlexAmbilight:Renderer]', ...args);
  }

  /**
   * Creates an ambilight renderer instance.
   * @param {HTMLVideoElement} video - The video element to sample from
   * @param {HTMLElement} playerContainer - The player container to wrap with glow
   * @returns {{ start: () => void, stop: () => void, updateSettings: (s: object) => void }}
   */
  function createRenderer(video, playerContainer) {
    // --- State ---
    let running = false;
    let paused = false;
    let settings = Object.assign({}, C.DEFAULTS);
    let rafId = null;
    let rvfcId = null;
    let useRVFC = typeof video.requestVideoFrameCallback === 'function';

    // --- Offscreen sampling canvas ---
    const sampleCanvas = document.createElement('canvas');
    const sampleCtx = sampleCanvas.getContext('2d', { willReadFrequently: true });
    sampleCanvas.width = settings.sampleResolution.width;
    sampleCanvas.height = settings.sampleResolution.height;

    // --- Glow DOM elements ---
    let glowContainer = null;
    /** @type {{ side: string, canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D }[]} */
    let glowElements = [];

    // --- Previous frame colors for smoothing ---
    /** @type {Map<string, ImageData>} */
    const prevEdgeData = new Map();

    // --- Reusable temporary canvas for edge extraction (avoids per-frame allocation) ---
    const tmpCanvas = document.createElement('canvas');
    const tmpCtx = tmpCanvas.getContext('2d', { willReadFrequently: true });

    // Smoothing factor: 0 = no smoothing, 1 = never updates
    const SMOOTHING_ALPHA = 0.35;

    /**
     * Build the glow container and 4 edge canvases, inject into the DOM.
     * Uses position:fixed on document.body to avoid interfering with Plex's layout.
     */
    function createGlowDOM() {
      if (glowContainer) return;

      glowContainer = document.createElement('div');
      glowContainer.id = C.GLOW_CONTAINER_ID;

      const sides = C.GLOW_SIDES; // ['top', 'right', 'bottom', 'left']

      for (const side of sides) {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d', { willReadFrequently: true });

        // Edge canvases: horizontal edges are wide+short, vertical are short+wide
        if (side === 'top' || side === 'bottom') {
          canvas.width = settings.segmentsPerEdge;
          canvas.height = 2;
        } else {
          canvas.width = 2;
          canvas.height = settings.segmentsPerEdge;
        }

        canvas.className = 'plex-ambilight-glow plex-ambilight-glow--' + side;
        glowContainer.appendChild(canvas);

        glowElements.push({ side, canvas, ctx });
      }

      // Insert into document.body with position:fixed so we never modify
      // the Plex player container's CSS (which breaks its layout).
      document.body.appendChild(glowContainer);

      applyGlowStyles();
      updateGlowPosition();
      log('Glow DOM created');
    }

    /**
     * Compute the bounding rect of the actual visible video content,
     * accounting for object-fit letterboxing (black bars).
     * @param {HTMLVideoElement} vid
     * @returns {{ top: number, left: number, width: number, height: number }}
     */
    function getVideoContentRect(vid) {
      const elemRect = vid.getBoundingClientRect();
      const videoAspect = vid.videoWidth / vid.videoHeight;
      const elemAspect = elemRect.width / elemRect.height;

      if (videoAspect > elemAspect) {
        // Letterboxed top/bottom (wide video in narrow container)
        const contentHeight = elemRect.width / videoAspect;
        return {
          top: elemRect.top + (elemRect.height - contentHeight) / 2,
          left: elemRect.left,
          width: elemRect.width,
          height: contentHeight,
        };
      } else {
        // Letterboxed left/right (tall video in wide container — e.g. 4:3 in 16:9)
        const contentWidth = elemRect.height * videoAspect;
        return {
          top: elemRect.top,
          left: elemRect.left + (elemRect.width - contentWidth) / 2,
          width: contentWidth,
          height: elemRect.height,
        };
      }
    }

    /**
     * Update the glow container's fixed position to match the visible video
     * content rect, accounting for aspect-ratio letterboxing.
     * Called each render frame and on initial setup.
     */
    function updateGlowPosition() {
      if (!glowContainer || !video) return;

      const rect = getVideoContentRect(video);
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      glowContainer.style.top = rect.top + 'px';
      glowContainer.style.left = rect.left + 'px';
      glowContainer.style.width = rect.width + 'px';
      glowContainer.style.height = rect.height + 'px';

      // Size each canvas to extend from the video edge to the viewport edge,
      // spanning the full viewport in the cross direction.
      for (const { side, canvas } of glowElements) {
        switch (side) {
          case 'top':
            canvas.style.left = (-rect.left) + 'px';
            canvas.style.width = vw + 'px';
            canvas.style.height = rect.top + 'px';
            break;
          case 'bottom':
            canvas.style.left = (-rect.left) + 'px';
            canvas.style.width = vw + 'px';
            canvas.style.height = (vh - rect.top - rect.height) + 'px';
            break;
          case 'left':
            canvas.style.top = (-rect.top) + 'px';
            canvas.style.height = vh + 'px';
            canvas.style.width = rect.left + 'px';
            break;
          case 'right':
            canvas.style.top = (-rect.top) + 'px';
            canvas.style.height = vh + 'px';
            canvas.style.width = (vw - rect.left - rect.width) + 'px';
            break;
        }
      }

      // Frame-shaped clip: visible outside the video rect, hidden over it.
      // Outer rect covers full viewport + blur overflow. Inner rect cuts out video.
      const blurExtra = settings.blurRadius * 2;
      const w = rect.width;
      const h = rect.height;
      const oL = -rect.left - blurExtra;
      const oT = -rect.top - blurExtra;
      const oR = vw - rect.left + blurExtra;
      const oB = vh - rect.top + blurExtra;

      glowContainer.style.clipPath = 'polygon(evenodd, ' +
        oL + 'px ' + oT + 'px, ' +
        oR + 'px ' + oT + 'px, ' +
        oR + 'px ' + oB + 'px, ' +
        oL + 'px ' + oB + 'px, ' +
        oL + 'px ' + oT + 'px, ' +
        '0px 0px, ' +
        '0px ' + h + 'px, ' +
        w + 'px ' + h + 'px, ' +
        w + 'px 0px, ' +
        '0px 0px)';
    }

    /**
     * Apply dynamic styles based on current settings.
     */
    function applyGlowStyles() {
      if (!glowContainer) return;

      const blur = settings.blurRadius;
      const spread = settings.spread;
      const opacity = settings.intensity;

      glowContainer.style.opacity = String(opacity);

      for (const { side, canvas } of glowElements) {
        canvas.style.filter = 'blur(' + blur + 'px)';

        // Anchor each canvas at its corresponding video edge.
        // Size and cross-axis position are set in updateGlowPosition().
        let maskDir;
        switch (side) {
          case 'top':
            canvas.style.bottom = '100%';
            canvas.style.top = '';
            maskDir = 'to top';
            break;
          case 'bottom':
            canvas.style.top = '100%';
            canvas.style.bottom = '';
            maskDir = 'to bottom';
            break;
          case 'left':
            canvas.style.right = '100%';
            canvas.style.left = '';
            maskDir = 'to left';
            break;
          case 'right':
            canvas.style.left = '100%';
            canvas.style.right = '';
            maskDir = 'to right';
            break;
        }

        // Spread controls the saturated zone: full color for the first
        // `spread` pixels from the video edge, then fades to transparent
        // toward the viewport edge.
        const mask = 'linear-gradient(' + maskDir + ', black ' + spread + 'px, transparent)';
        canvas.style.maskImage = mask;
        canvas.style.webkitMaskImage = mask;
      }
    }

    /**
     * Remove the glow DOM from the page.
     */
    function removeGlowDOM() {
      if (glowContainer && glowContainer.parentElement) {
        glowContainer.parentElement.removeChild(glowContainer);
      }
      glowContainer = null;
      glowElements = [];
      prevEdgeData.clear();

      log('Glow DOM removed');
    }

    /**
     * Sample the current video frame onto the offscreen canvas.
     * @returns {boolean} true if frame was successfully sampled
     */
    function sampleFrame() {
      if (video.readyState < C.MIN_VIDEO_READY_STATE || video.videoWidth === 0) {
        return false;
      }

      try {
        sampleCtx.drawImage(
          video,
          0, 0,
          sampleCanvas.width, sampleCanvas.height
        );
        return true;
      } catch (e) {
        log('Frame sample failed:', e.message);
        return false;
      }
    }

    /**
     * Extract edge strip pixel data from the sampled frame and paint
     * onto the 4 glow canvases with exponential smoothing.
     */
    function updateGlowCanvases() {
      const sw = sampleCanvas.width;
      const sh = sampleCanvas.height;
      const stripFrac = settings.edgeStripWidth; // fraction of dimension
      const stripH = Math.max(1, Math.round(sh * stripFrac)); // pixel rows for top/bottom
      const stripW = Math.max(1, Math.round(sw * stripFrac)); // pixel cols for left/right

      for (const { side, canvas, ctx } of glowElements) {
        let srcX, srcY, srcW, srcH;

        switch (side) {
          case 'top':
            srcX = 0; srcY = 0; srcW = sw; srcH = stripH;
            break;
          case 'bottom':
            srcX = 0; srcY = sh - stripH; srcW = sw; srcH = stripH;
            break;
          case 'left':
            srcX = 0; srcY = 0; srcW = stripW; srcH = sh;
            break;
          case 'right':
            srcX = sw - stripW; srcY = 0; srcW = stripW; srcH = sh;
            break;
        }

        // Resize reusable temp canvas if needed and draw edge strip
        if (tmpCanvas.width !== srcW || tmpCanvas.height !== srcH) {
          tmpCanvas.width = srcW;
          tmpCanvas.height = srcH;
        }
        // Draw the edge region directly from the sample canvas (avoids getImageData + putImageData)
        tmpCtx.drawImage(sampleCanvas, srcX, srcY, srcW, srcH, 0, 0, srcW, srcH);

        // Apply exponential smoothing if we have previous data
        const cw = canvas.width;
        const ch = canvas.height;

        // Draw downsampled edge onto glow canvas
        ctx.drawImage(tmpCanvas, 0, 0, srcW, srcH, 0, 0, cw, ch);

        // Exponential smoothing: blend current with previous
        const currentData = ctx.getImageData(0, 0, cw, ch);
        const prevData = prevEdgeData.get(side);

        if (prevData && prevData.data.length === currentData.data.length) {
          const alpha = SMOOTHING_ALPHA;
          const data = currentData.data;
          const prev = prevData.data;
          for (let i = 0; i < data.length; i++) {
            data[i] = data[i] * (1 - alpha) + prev[i] * alpha;
          }
          ctx.putImageData(currentData, 0, 0);
        }

        // Store for next frame
        prevEdgeData.set(side, currentData);
      }
    }

    /**
     * Single render tick: sample frame, update glow canvases, reposition overlay.
     */
    function renderFrame() {
      if (!running || paused) return;

      // Skip if tab not visible
      if (document.visibilityState === 'hidden') return;

      updateGlowPosition();

      if (sampleFrame()) {
        updateGlowCanvases();
      }
    }

    /**
     * Start the rendering loop using requestVideoFrameCallback or rAF fallback.
     */
    function startLoop() {
      if (useRVFC) {
        function rvfcLoop() {
          if (!running) return;
          renderFrame();
          rvfcId = video.requestVideoFrameCallback(rvfcLoop);
        }
        rvfcId = video.requestVideoFrameCallback(rvfcLoop);
        log('Render loop started (requestVideoFrameCallback)');
      } else {
        const targetInterval = 1000 / settings.samplingFps;
        let lastTime = 0;

        function rafLoop(timestamp) {
          if (!running) return;
          if (timestamp - lastTime >= targetInterval) {
            renderFrame();
            lastTime = timestamp;
          }
          rafId = requestAnimationFrame(rafLoop);
        }
        rafId = requestAnimationFrame(rafLoop);
        log('Render loop started (requestAnimationFrame fallback)');
      }
    }

    /**
     * Stop the rendering loop.
     */
    function stopLoop() {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      if (rvfcId !== null && typeof video.cancelVideoFrameCallback === 'function') {
        video.cancelVideoFrameCallback(rvfcId);
        rvfcId = null;
      }
    }

    // --- Visibility handling ---
    function onVisibilityChange() {
      if (!running) return;
      if (document.visibilityState === 'hidden') {
        stopLoop();
        log('Tab hidden, loop paused');
      } else {
        startLoop();
        log('Tab visible, loop resumed');
      }
    }

    // --- Video play/pause handling ---
    function onVideoPlay() {
      if (!running) return;
      paused = false;
      if (glowContainer) glowContainer.style.opacity = String(settings.intensity);
      log('Video playing');
    }

    function onVideoPause() {
      if (!running) return;
      paused = true;
      // Dim the glow when paused
      if (glowContainer) glowContainer.style.opacity = String(settings.intensity * 0.3);
      log('Video paused, glow dimmed');
    }

    // --- Public API ---

    function start() {
      if (running) return;
      running = true;
      paused = video.paused;

      createGlowDOM();
      startLoop();

      document.addEventListener('visibilitychange', onVisibilityChange);
      video.addEventListener('play', onVideoPlay);
      video.addEventListener('playing', onVideoPlay);
      video.addEventListener('pause', onVideoPause);

      if (paused && glowContainer) {
        glowContainer.style.opacity = String(settings.intensity * 0.3);
      }

      log('Renderer started');
    }

    function stop() {
      if (!running) return;
      running = false;

      stopLoop();
      removeGlowDOM();

      document.removeEventListener('visibilitychange', onVisibilityChange);
      video.removeEventListener('play', onVideoPlay);
      video.removeEventListener('playing', onVideoPlay);
      video.removeEventListener('pause', onVideoPause);

      log('Renderer stopped');
    }

    /**
     * Update renderer settings on the fly.
     * @param {object} newSettings
     */
    function updateSettings(newSettings) {
      Object.assign(settings, newSettings);

      // Update sample canvas dimensions if resolution changed
      if (newSettings.sampleResolution) {
        sampleCanvas.width = settings.sampleResolution.width;
        sampleCanvas.height = settings.sampleResolution.height;
      }

      // Re-apply glow styles
      applyGlowStyles();

      // Update loop timing if using rAF fallback and fps changed
      if (!useRVFC && newSettings.samplingFps && running) {
        stopLoop();
        startLoop();
      }

      log('Settings updated', settings);
    }

    return { start, stop, updateSettings };
  }

  PA.createRenderer = createRenderer;
})();
