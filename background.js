/**
 * Said Screenshot Pro - Service Worker (background.js)
 * Manifest V3 compatible
 */

const DEFAULT_SETTINGS = {
  defaultFormat: 'png',
  defaultQuality: 100,
  autoDownload: false,
  autoDrive: false,
  captureCursor: false,
  highDpr: true,
  fullPageDelay: 400,
  hideStickyHeaders: true,
  namingStyle: 'timestamp', // 'timestamp' | 'title_date' | 'custom'
  namePrefix: 'SaidScreenshot_',
  driveFolder: 'Said Screenshot Pro',
  theme: 'dark'
};

// Initialize settings and context menus on install
chrome.runtime.onInstalled.addListener(async (details) => {
  const current = await chrome.storage.local.get('settings');
  if (!current.settings) {
    await chrome.storage.local.set({ settings: DEFAULT_SETTINGS, said_history: [] });
  }

  setupContextMenus();
});

function setupContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'said-root',
      title: 'Said Screenshot Pro',
      contexts: ['all']
    });

    chrome.contextMenus.create({
      id: 'said-visible',
      parentId: 'said-root',
      title: '📸 Capture Visible Area (Ctrl+Shift+S)',
      contexts: ['all']
    });

    chrome.contextMenus.create({
      id: 'said-area',
      parentId: 'said-root',
      title: '✂ Capture Selected Area (Ctrl+Shift+A)',
      contexts: ['all']
    });

    chrome.contextMenus.create({
      id: 'said-fullpage',
      parentId: 'said-root',
      title: '🌐 Capture Full Page (Ctrl+Shift+F)',
      contexts: ['all']
    });
  });
}

// Handle Context Menu clicks
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab || !tab.id) return;
  if (info.menuItemId === 'said-visible') {
    handleCaptureVisible(tab);
  } else if (info.menuItemId === 'said-area') {
    handleStartAreaSelection(tab);
  } else if (info.menuItemId === 'said-fullpage') {
    handleCaptureFullPage(tab);
  }
});

// Handle Keyboard Shortcuts
chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) return;

  if (command === 'capture-visible') {
    handleCaptureVisible(tab);
  } else if (command === 'capture-area') {
    handleStartAreaSelection(tab);
  } else if (command === 'capture-fullpage') {
    handleCaptureFullPage(tab);
  }
});

// Message listener from popup and content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tab = sender.tab;

  if (message.type === 'CAPTURE_VISIBLE') {
    chrome.tabs.query({ active: true, currentWindow: true }).then(([activeTab]) => {
      if (activeTab) handleCaptureVisible(activeTab);
    });
    sendResponse({ status: 'initiated' });
    return true;
  }

  if (message.type === 'START_AREA_SELECTION') {
    chrome.tabs.query({ active: true, currentWindow: true }).then(([activeTab]) => {
      if (activeTab) handleStartAreaSelection(activeTab);
    });
    sendResponse({ status: 'initiated' });
    return true;
  }

  if (message.type === 'START_FULL_PAGE') {
    chrome.tabs.query({ active: true, currentWindow: true }).then(([activeTab]) => {
      if (activeTab) handleCaptureFullPage(activeTab);
    });
    sendResponse({ status: 'initiated' });
    return true;
  }

  if (message.type === 'START_CUSTOM_SCROLL') {
    chrome.tabs.query({ active: true, currentWindow: true }).then(([activeTab]) => {
      if (activeTab) handleStartCustomScroll(activeTab);
    });
    sendResponse({ status: 'initiated' });
    return true;
  }

  if (message.type === 'AREA_SELECTED') {
    // Crop coordinates received from content script selection
    processAreaCrop(sender.tab, message.rect, message.dpr);
    sendResponse({ status: 'processing' });
    return true;
  }

  if (message.type === 'CUSTOM_SCROLL_COMPLETE') {
    processCustomScrollCapture(sender.tab, message.startScrollY, message.endScrollY);
    sendResponse({ status: 'processing' });
    return true;
  }

  return false;
});

// Check if tab is capture-eligible (not chrome:// or special edge URLs)
function isCapturableUrl(url) {
  if (!url) return false;
  return !url.startsWith('chrome://') &&
         !url.startsWith('chrome-extension://') &&
         !url.startsWith('edge://') &&
         !url.startsWith('about:') &&
         !url.startsWith('chrome-search://');
}

// 1. Visible Tab Capture
async function handleCaptureVisible(tab) {
  try {
    if (!isCapturableUrl(tab.url)) {
      notifyTabError(tab.id, 'Cannot capture system or chrome:// pages for security reasons. Please try on a regular website.');
      return;
    }

    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    const filename = await generateFilename(tab.title);
    
    await openEditorWithImage({
      mode: 'visible',
      dataUrl,
      title: tab.title || 'Visible Screenshot',
      pageUrl: tab.url,
      filename,
      timestamp: Date.now()
    });
  } catch (err) {
    console.error('Visible capture failed:', err);
    notifyTabError(tab.id, 'Screenshot could not be captured on this page: ' + (err.message || 'Unknown error'));
  }
}

// 2. Select Area Capture
async function handleStartAreaSelection(tab) {
  try {
    if (!isCapturableUrl(tab.url)) {
      notifyTabError(tab.id, 'Cannot capture on system or internal browser pages.');
      return;
    }

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js']
    });

    await chrome.tabs.sendMessage(tab.id, { type: 'ACTIVATE_SELECTION' });
  } catch (err) {
    console.error('Failed to start area selection:', err);
    notifyTabError(tab.id, 'Could not initiate area selection on this page.');
  }
}

// Process crop from Area Selection
async function processAreaCrop(tab, rect, dpr = 1) {
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    const filename = await generateFilename(tab.title);

    await openEditorWithImage({
      mode: 'area',
      dataUrl,
      cropRect: rect,
      dpr,
      title: tab.title || 'Area Screenshot',
      pageUrl: tab.url,
      filename,
      timestamp: Date.now()
    });
  } catch (err) {
    console.error('Process area crop failed:', err);
    notifyTabError(tab.id, 'Failed to capture selected area.');
  }
}

// 3. Full Page Scrolling Capture Engine
async function handleCaptureFullPage(tab) {
  try {
    if (!isCapturableUrl(tab.url)) {
      notifyTabError(tab.id, 'Full page capture cannot be performed on browser internal pages.');
      return;
    }

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js']
    });

    await chrome.tabs.sendMessage(tab.id, { type: 'SHOW_CAPTURE_HUD', message: 'Analyzing page height & layout...' });

    const metrics = await chrome.tabs.sendMessage(tab.id, { type: 'GET_PAGE_METRICS' });
    if (!metrics) throw new Error('Could not retrieve page dimensions.');

    const { totalHeight, viewportHeight, totalWidth, viewportWidth, dpr } = metrics;
    const { settings = DEFAULT_SETTINGS } = await chrome.storage.local.get('settings');
    const scrollDelay = settings.fullPageDelay || 350;

    const frames = [];
    let currentY = 0;
    const maxCaptures = 30;
    let count = 0;

    if (settings.hideStickyHeaders) {
      await chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_STICKY_ELEMENTS', hide: true });
    }

    while (currentY < totalHeight && count < maxCaptures) {
      const progressPercent = Math.min(100, Math.round((currentY / totalHeight) * 100));
      await chrome.tabs.sendMessage(tab.id, {
        type: 'SHOW_CAPTURE_HUD',
        message: `Capturing page section ${count + 1} (${progressPercent}%)...`
      });

      await chrome.tabs.sendMessage(tab.id, { type: 'SCROLL_TO', y: currentY });
      await sleep(scrollDelay);

      const frameUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
      frames.push({
        dataUrl: frameUrl,
        scrollY: currentY,
        viewportHeight,
        totalHeight
      });

      currentY += viewportHeight;
      count++;
    }

    if (settings.hideStickyHeaders) {
      await chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_STICKY_ELEMENTS', hide: false });
    }
    await chrome.tabs.sendMessage(tab.id, { type: 'RESTORE_ORIGINAL_SCROLL' });
    await chrome.tabs.sendMessage(tab.id, { type: 'HIDE_CAPTURE_HUD' });

    const filename = await generateFilename(tab.title);

    await openEditorWithImage({
      mode: 'fullpage',
      frames,
      totalHeight,
      totalWidth,
      viewportHeight,
      viewportWidth,
      dpr,
      title: tab.title || 'Full Page Screenshot',
      pageUrl: tab.url,
      filename,
      timestamp: Date.now()
    });
  } catch (err) {
    console.error('Full page capture failed:', err);
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'HIDE_CAPTURE_HUD' });
    } catch (_) {}
    notifyTabError(tab.id, 'Full page capture failed: ' + (err.message || 'Unknown error'));
  }
}

// 4. Custom Scroll Mode
async function handleStartCustomScroll(tab) {
  try {
    if (!isCapturableUrl(tab.url)) {
      notifyTabError(tab.id, 'Custom scroll cannot be used on internal browser pages.');
      return;
    }

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js']
    });

    await chrome.tabs.sendMessage(tab.id, { type: 'ACTIVATE_CUSTOM_SCROLL' });
  } catch (err) {
    console.error('Custom scroll start failed:', err);
    notifyTabError(tab.id, 'Could not start custom scroll capture.');
  }
}

// Process custom scroll capture
async function processCustomScrollCapture(tab, startY, endY) {
  try {
    const minY = Math.min(startY, endY);
    const maxY = Math.max(startY, endY);
    const metrics = await chrome.tabs.sendMessage(tab.id, { type: 'GET_PAGE_METRICS' });
    const { viewportHeight, dpr } = metrics;
    const { settings = DEFAULT_SETTINGS } = await chrome.storage.local.get('settings');
    const scrollDelay = settings.fullPageDelay || 350;

    const frames = [];
    let currentY = minY;
    let count = 0;

    while (currentY < maxY && count < 25) {
      await chrome.tabs.sendMessage(tab.id, { type: 'SCROLL_TO', y: currentY });
      await sleep(scrollDelay);

      const frameUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
      frames.push({
        dataUrl: frameUrl,
        scrollY: currentY,
        viewportHeight,
        totalHeight: maxY - minY
      });

      currentY += viewportHeight;
      count++;
    }

    await chrome.tabs.sendMessage(tab.id, { type: 'RESTORE_ORIGINAL_SCROLL' });
    const filename = await generateFilename(tab.title);

    await openEditorWithImage({
      mode: 'custom_scroll',
      frames,
      minY,
      maxY,
      dpr,
      title: tab.title || 'Custom Scroll Screenshot',
      pageUrl: tab.url,
      filename,
      timestamp: Date.now()
    });
  } catch (err) {
    console.error('Custom scroll processing failed:', err);
    notifyTabError(tab.id, 'Could not complete custom scroll capture.');
  }
}

// Open Editor tab with session payload
async function openEditorWithImage(payload) {
  const sessionId = 'said_session_' + Date.now();
  await chrome.storage.local.set({ [sessionId]: payload });

  const editorUrl = chrome.runtime.getURL(`editor.html?session=${sessionId}`);
  await chrome.tabs.create({ url: editorUrl });
}

// Helper to notify errors to tab if available
async function notifyTabError(tabId, message) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (msg) => {
        const toast = document.createElement('div');
        toast.style.cssText = `
          position: fixed;
          top: 24px;
          right: 24px;
          z-index: 2147483647;
          background: #0f172a;
          color: #f87171;
          border: 1px solid #ef4444;
          padding: 14px 20px;
          border-radius: 10px;
          font-family: system-ui, -apple-system, sans-serif;
          font-size: 14px;
          font-weight: 500;
          box-shadow: 0 10px 25px -5px rgba(0,0,0,0.5);
          display: flex;
          align-items: center;
          gap: 10px;
          animation: saidSlideIn 0.3s ease-out;
        `;
        toast.innerHTML = `⚠️ <span>${msg}</span>`;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 4500);
      },
      args: [message]
    });
  } catch (_) {}
}

// Generate smart filename based on settings
async function generateFilename(pageTitle = '') {
  const { settings = DEFAULT_SETTINGS } = await chrome.storage.local.get('settings');
  const d = new Date();
  const dateStr = d.toISOString().split('T')[0];
  const timeStr = [
    String(d.getHours()).padStart(2, '0'),
    String(d.getMinutes()).padStart(2, '0'),
    String(d.getSeconds()).padStart(2, '0')
  ].join('-');

  const cleanTitle = (pageTitle || 'Webpage')
    .replace(/[^a-zA-Z0-9_\-\u0980-\u09FF]/g, '_')
    .substring(0, 30)
    .replace(/_+/g, '_');

  if (settings.namingStyle === 'title_date') {
    return `${cleanTitle}_${dateStr}_${timeStr}`;
  }

  return `${settings.namePrefix || 'SaidScreenshot_'}${dateStr}_${timeStr}`;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}