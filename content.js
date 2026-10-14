/**
 * Said Screenshot Pro - Content Script (content.js)
 * Manages area selection overlay, scrolling metrics, HUD and custom scroll widget
 */

(function () {
  if (window.__saidScreenshotProLoaded) return;
  window.__saidScreenshotProLoaded = true;

  let originalScrollY = 0;
  let hiddenFixedElements = [];

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
      case 'GET_PAGE_METRICS': {
        originalScrollY = window.scrollY;
        const totalHeight = Math.max(
          document.body.scrollHeight,
          document.documentElement.scrollHeight,
          document.body.offsetHeight,
          document.documentElement.offsetHeight,
          document.body.clientHeight,
          document.documentElement.clientHeight
        );
        const totalWidth = Math.max(
          document.body.scrollWidth,
          document.documentElement.scrollWidth,
          document.body.offsetWidth,
          document.documentElement.offsetWidth,
          document.body.clientWidth,
          document.documentElement.clientWidth
        );

        sendResponse({
          totalHeight,
          totalWidth,
          viewportHeight: window.innerHeight,
          viewportWidth: window.innerWidth,
          dpr: window.devicePixelRatio || 1
        });
        return true;
      }

      case 'SCROLL_TO': {
        window.scrollTo({ top: message.y, left: 0, behavior: 'instant' });
        sendResponse({ status: 'scrolled', y: window.scrollY });
        return true;
      }

      case 'RESTORE_ORIGINAL_SCROLL': {
        window.scrollTo({ top: originalScrollY, left: 0, behavior: 'instant' });
        sendResponse({ status: 'restored' });
        return true;
      }

      case 'TOGGLE_STICKY_ELEMENTS': {
        if (message.hide) {
          hiddenFixedElements = [];
          const allEls = document.querySelectorAll('*');
          for (const el of allEls) {
            const style = window.getComputedStyle(el);
            if (style.position === 'fixed' || style.position === 'sticky') {
              hiddenFixedElements.push({ el, origDisplay: el.style.display });
              el.style.display = 'none';
            }
          }
        } else {
          for (const item of hiddenFixedElements) {
            item.el.style.display = item.origDisplay;
          }
          hiddenFixedElements = [];
        }
        sendResponse({ status: 'toggled' });
        return true;
      }

      case 'SHOW_CAPTURE_HUD': {
        showFloatingHud(message.message);
        sendResponse({ status: 'hud_shown' });
        return true;
      }

      case 'HIDE_CAPTURE_HUD': {
        hideFloatingHud();
        sendResponse({ status: 'hud_hidden' });
        return true;
      }

      case 'ACTIVATE_SELECTION': {
        initAreaSelectionOverlay();
        sendResponse({ status: 'selection_started' });
        return true;
      }

      case 'ACTIVATE_CUSTOM_SCROLL': {
        initCustomScrollWidget();
        sendResponse({ status: 'custom_scroll_started' });
        return true;
      }
    }
  });

  function showFloatingHud(text) {
    let hud = document.getElementById('said-capture-hud');
    if (!hud) {
      hud = document.createElement('div');
      hud.id = 'said-capture-hud';
      hud.style.cssText = `
        position: fixed;
        bottom: 30px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 2147483647;
        background: rgba(15, 23, 42, 0.95);
        border: 1px solid #0284c7;
        color: #ffffff;
        padding: 12px 24px;
        border-radius: 9999px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 14px;
        font-weight: 500;
        box-shadow: 0 12px 30px rgba(0,0,0,0.6);
        display: flex;
        align-items: center;
        gap: 12px;
        backdrop-filter: blur(12px);
        pointer-events: none;
      `;
      document.body.appendChild(hud);
    }
    hud.innerHTML = `
      <div style="width: 16px; height: 16px; border: 2px solid #0284c7; border-top-color: transparent; border-radius: 50%; animation: said-spin 0.8s linear infinite;"></div>
      <span style="letter-spacing: 0.3px;">${text}</span>
      <style>
        @keyframes said-spin {
          to { transform: rotate(360deg); }
        }
      </style>
    `;
  }

  function hideFloatingHud() {
    const hud = document.getElementById('said-capture-hud');
    if (hud) hud.remove();
  }

  function initAreaSelectionOverlay() {
    const existing = document.getElementById('said-selection-container');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'said-selection-container';
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      z-index: 2147483647;
      cursor: crosshair;
      user-select: none;
      background: rgba(15, 23, 42, 0.35);
    `;

    const banner = document.createElement('div');
    banner.style.cssText = `
      position: fixed;
      top: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(15, 23, 42, 0.92);
      color: #f8fafc;
      padding: 10px 24px;
      border-radius: 30px;
      font-family: system-ui, sans-serif;
      font-size: 13px;
      font-weight: 500;
      box-shadow: 0 10px 25px rgba(0,0,0,0.4);
      border: 1px solid rgba(56, 189, 248, 0.4);
      display: flex;
      align-items: center;
      gap: 12px;
      pointer-events: none;
    `;
    banner.innerHTML = `
      <span style="color: #38bdf8; font-weight: 700;">SAID SCREENSHOT PRO</span>
      <span>Drag mouse to select area • Press <b>Esc</b> to Cancel</span>
    `;
    overlay.appendChild(banner);

    const cropBox = document.createElement('div');
    cropBox.style.cssText = `
      position: absolute;
      border: 2px dashed #0284c7;
      background: rgba(2, 132, 199, 0.12);
      box-shadow: 0 0 0 9999px rgba(15, 23, 42, 0.45), 0 0 15px rgba(2, 132, 199, 0.5);
      display: none;
      pointer-events: none;
    `;

    const badge = document.createElement('div');
    badge.style.cssText = `
      position: absolute;
      top: -30px;
      left: 0;
      background: #0284c7;
      color: #ffffff;
      font-size: 11px;
      font-family: monospace;
      padding: 3px 8px;
      border-radius: 4px;
      white-space: nowrap;
      pointer-events: none;
    `;
    cropBox.appendChild(badge);
    overlay.appendChild(cropBox);

    let isDrawing = false;
    let startX = 0, startY = 0, currentX = 0, currentY = 0;

    function updateBox() {
      const x = Math.min(startX, currentX);
      const y = Math.min(startY, currentY);
      const w = Math.abs(currentX - startX);
      const h = Math.abs(currentY - startY);

      cropBox.style.left = x + 'px';
      cropBox.style.top = y + 'px';
      cropBox.style.width = w + 'px';
      cropBox.style.height = h + 'px';
      badge.textContent = `${Math.round(w)} × ${Math.round(h)} px`;
    }

    function onMouseDown(e) {
      if (e.button !== 0) return;
      isDrawing = true;
      startX = e.clientX;
      startY = e.clientY;
      currentX = e.clientX;
      currentY = e.clientY;
      cropBox.style.display = 'block';
      updateBox();
    }

    function onMouseMove(e) {
      if (!isDrawing) return;
      currentX = e.clientX;
      currentY = e.clientY;
      updateBox();
    }

    function onMouseUp() {
      if (!isDrawing) return;
      isDrawing = false;

      const w = Math.abs(currentX - startX);
      const h = Math.abs(currentY - startY);

      if (w < 8 || h < 8) {
        cropBox.style.display = 'none';
        return;
      }

      const rect = {
        x: Math.min(startX, currentX),
        y: Math.min(startY, currentY),
        width: w,
        height: h
      };

      cleanup();

      chrome.runtime.sendMessage({
        type: 'AREA_SELECTED',
        rect,
        dpr: window.devicePixelRatio || 1
      });
    }

    function onKeyDown(e) {
      if (e.key === 'Escape') cleanup();
    }

    function cleanup() {
      window.removeEventListener('keydown', onKeyDown);
      overlay.remove();
    }

    overlay.addEventListener('mousedown', onMouseDown);
    overlay.addEventListener('mousemove', onMouseMove);
    overlay.addEventListener('mouseup', onMouseUp);
    window.addEventListener('keydown', onKeyDown);

    document.body.appendChild(overlay);
  }

  function initCustomScrollWidget() {
    const existing = document.getElementById('said-custom-scroll-bar');
    if (existing) existing.remove();

    let isCapturing = false;
    let startY = window.scrollY;

    const widget = document.createElement('div');
    widget.id = 'said-custom-scroll-bar';
    widget.style.cssText = `
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 2147483647;
      background: rgba(15, 23, 42, 0.95);
      border: 1px solid rgba(56, 189, 248, 0.4);
      border-radius: 16px;
      box-shadow: 0 20px 40px rgba(0,0,0,0.6);
      padding: 16px 20px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      color: #ffffff;
      min-width: 280px;
      backdrop-filter: blur(16px);
    `;

    widget.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
        <div style="font-weight: 700; font-size: 13px; color: #38bdf8; display: flex; align-items: center; gap: 6px;">
          <span>📜</span>
          <span>CUSTOM SCROLL CAPTURE</span>
        </div>
        <button id="said-cs-close" style="background: transparent; border: none; color: #94a3b8; font-size: 16px; cursor: pointer;">✕</button>
      </div>
      <div id="said-cs-status" style="font-size: 12px; color: #cbd5e1; margin-bottom: 14px; line-height: 1.4;">
        Scroll to your starting position, then click <b>Start Capture</b>.
      </div>
      <div style="display: flex; gap: 8px;">
        <button id="said-cs-toggle" style="flex: 1; background: #0284c7; color: #fff; border: none; padding: 9px 12px; border-radius: 8px; font-weight: 600; font-size: 12px; cursor: pointer; transition: 0.2s;">
          ▶ Start Capture
        </button>
        <button id="said-cs-cancel" style="background: rgba(255,255,255,0.1); color: #cbd5e1; border: none; padding: 9px 12px; border-radius: 8px; font-size: 12px; cursor: pointer;">
          Cancel
        </button>
      </div>
    `;

    document.body.appendChild(widget);

    const toggleBtn = widget.querySelector('#said-cs-toggle');
    const cancelBtn = widget.querySelector('#said-cs-cancel');
    const closeBtn = widget.querySelector('#said-cs-close');
    const statusDiv = widget.querySelector('#said-cs-status');

    function onScrollUpdate() {
      if (!isCapturing) return;
      const scrolledDist = Math.abs(window.scrollY - startY);
      statusDiv.innerHTML = `Capturing... Scrolled: <b style="color: #38bdf8;">${scrolledDist}px</b>. Scroll as far as you need, then click Stop.`;
    }

    window.addEventListener('scroll', onScrollUpdate);

    toggleBtn.addEventListener('click', () => {
      if (!isCapturing) {
        isCapturing = true;
        startY = window.scrollY;
        toggleBtn.style.background = '#ef4444';
        toggleBtn.innerHTML = '⏹ Stop & Capture';
        statusDiv.innerHTML = `Recording started at <b>${startY}px</b>. Now scroll down to where you want to end.`;
      } else {
        const endY = window.scrollY;
        window.removeEventListener('scroll', onScrollUpdate);
        widget.remove();

        chrome.runtime.sendMessage({
          type: 'CUSTOM_SCROLL_COMPLETE',
          startScrollY: startY,
          endScrollY: endY
        });
      }
    });

    function clean() {
      window.removeEventListener('scroll', onScrollUpdate);
      widget.remove();
    }

    cancelBtn.addEventListener('click', clean);
    closeBtn.addEventListener('click', clean);
  }
})();