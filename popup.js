/**
 * Said Screenshot Pro - Popup Script (popup.js)
 * Manages UI interactions, capture triggers, countdown timers, and recent history
 */

class SaidPopup {
  constructor() {
    this.selectedDelay = 0;
    this.selectedMode = 'visible';
    this.init();
  }

  async init() {
    this.setupListeners();
    await this.loadRecentHistory();
  }

  setupListeners() {
    document.querySelectorAll('.mode-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        document.querySelectorAll('.mode-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        this.selectedMode = pill.dataset.mode;
      });
    });

    document.querySelectorAll('.timer-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.timer-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.selectedDelay = parseInt(btn.dataset.delay, 10);
      });
    });

    document.getElementById('btn-capture-visible').addEventListener('click', () => {
      this.triggerCapture('CAPTURE_VISIBLE');
    });

    document.getElementById('btn-capture-area').addEventListener('click', () => {
      this.triggerCapture('START_AREA_SELECTION');
    });

    document.getElementById('btn-capture-fullpage').addEventListener('click', () => {
      this.triggerCapture('START_FULL_PAGE');
    });

    document.getElementById('btn-capture-custom').addEventListener('click', () => {
      this.triggerCapture('START_CUSTOM_SCROLL');
    });

    document.getElementById('btn-capture-pdf').addEventListener('click', () => {
      this.triggerCapture('CAPTURE_VISIBLE');
    });

    document.getElementById('btn-open-options').addEventListener('click', () => {
      if (chrome.runtime.openOptionsPage) {
        chrome.runtime.openOptionsPage();
      } else {
        window.open(chrome.runtime.getURL('options.html'));
      }
    });

    document.getElementById('btn-clear-history').addEventListener('click', async () => {
      if (confirm('Clear all recent screenshot history?')) {
        await chrome.storage.local.set({ said_history: [] });
        await this.loadRecentHistory();
      }
    });
  }

  async triggerCapture(type) {
    if (this.selectedDelay > 0) {
      await this.runCountdown(this.selectedDelay);
    }
    chrome.runtime.sendMessage({ type });
    window.close();
  }

  runCountdown(seconds) {
    return new Promise((resolve) => {
      const hud = document.getElementById('countdown-hud');
      const num = document.getElementById('countdown-num');
      hud.style.display = 'flex';
      let remaining = seconds;
      num.textContent = remaining;

      const timer = setInterval(() => {
        remaining--;
        if (remaining <= 0) {
          clearInterval(timer);
          hud.style.display = 'none';
          resolve();
        } else {
          num.textContent = remaining;
        }
      }, 1000);
    });
  }

  async loadRecentHistory() {
    try {
      const res = await chrome.storage.local.get('said_history');
      const history = res.said_history || [];
      const countBadge = document.getElementById('history-count');
      const listContainer = document.getElementById('history-list');

      countBadge.textContent = history.length;

      if (history.length === 0) {
        listContainer.innerHTML = `
          <div class="empty-history">
            <span>📷</span>
            <p>No recent screenshots yet. Capture your first one above!</p>
          </div>
        `;
        return;
      }

      listContainer.innerHTML = '';
      history.forEach(item => {
        const row = document.createElement('div');
        row.className = 'history-item';

        const d = new Date(item.timestamp);
        const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const dateStr = d.toLocaleDateString([], { month: 'short', day: 'numeric' });

        row.innerHTML = `
          <div class="history-item-left" title="Open in Studio Editor">
            <img src="${item.thumbnail || 'icons/icon32.png'}" class="history-thumb" alt="Thumbnail">
            <div class="history-meta">
              <span class="history-filename">${item.filename || 'Screenshot'}</span>
              <span class="history-sub">${dateStr} • ${timeStr} • ${item.width || 0}×${item.height || 0}px</span>
            </div>
          </div>
          <div class="history-actions">
            <button class="hist-btn copy" title="Copy to clipboard">📋</button>
            <button class="hist-btn dl" title="Download PNG">⬇</button>
            <button class="hist-btn del" title="Delete">✕</button>
          </div>
        `;

        row.querySelector('.history-item-left').addEventListener('click', async () => {
          const sessionId = 'said_session_' + Date.now();
          await chrome.storage.local.set({
            [sessionId]: {
              mode: 'visible',
              dataUrl: item.dataUrl || item.thumbnail,
              filename: item.filename,
              timestamp: item.timestamp
            }
          });
          chrome.tabs.create({ url: chrome.runtime.getURL(`editor.html?session=${sessionId}`) });
          window.close();
        });

        row.querySelector('.hist-btn.copy').addEventListener('click', async (e) => {
          e.stopPropagation();
          try {
            const res = await fetch(item.dataUrl || item.thumbnail);
            const blob = await res.blob();
            await navigator.clipboard.write([
              new ClipboardItem({ 'image/png': blob })
            ]);
            e.target.textContent = '✓';
            setTimeout(() => e.target.textContent = '📋', 1500);
          } catch (err) {
            console.error('Copy failed:', err);
          }
        });

        row.querySelector('.hist-btn.dl').addEventListener('click', (e) => {
          e.stopPropagation();
          const a = document.createElement('a');
          a.href = item.dataUrl || item.thumbnail;
          a.download = (item.filename || 'SaidScreenshot') + '.png';
          document.body.appendChild(a);
          a.click();
          a.remove();
        });

        row.querySelector('.hist-btn.del').addEventListener('click', async (e) => {
          e.stopPropagation();
          const updated = history.filter(h => h.id !== item.id);
          await chrome.storage.local.set({ said_history: updated });
          await this.loadRecentHistory();
        });

        listContainer.appendChild(row);
      });
    } catch (err) {
      console.error('History load failed:', err);
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new SaidPopup();
});