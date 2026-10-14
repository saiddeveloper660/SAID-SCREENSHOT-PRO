/**
 * Said Screenshot Pro - Options & Settings Script (options.js)
 */

class SaidOptions {
  constructor() {
    this.saveTimeout = null;
    this.init();
  }

  async init() {
    this.setupTabs();
    this.setupListeners();
    await this.loadSettings();
    this.updateNamingPreview();
  }

  setupTabs() {
    document.querySelectorAll('.nav-item').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));

        btn.classList.add('active');
        const tabId = 'tab-' + btn.dataset.tab;
        const targetPane = document.getElementById(tabId);
        if (targetPane) targetPane.classList.add('active');
      });
    });
  }

  setupListeners() {
    const qSlider = document.getElementById('setting-quality');
    const qBadge = document.getElementById('quality-val-badge');
    qSlider.addEventListener('input', () => {
      qBadge.textContent = qSlider.value + '%';
      this.triggerAutoSave();
    });

    const autoSaveInputs = [
      'setting-default-format',
      'setting-auto-download',
      'setting-auto-drive',
      'setting-high-dpr',
      'setting-hide-sticky',
      'setting-scroll-delay',
      'setting-naming-style',
      'setting-name-prefix',
      'setting-drive-folder',
      'setting-google-client-id'
    ];

    autoSaveInputs.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('change', () => {
        this.triggerAutoSave();
        this.updateNamingPreview();
      });
      el.addEventListener('input', () => {
        this.triggerAutoSave();
        this.updateNamingPreview();
      });
    });

    const driveBtn = document.getElementById('btn-toggle-drive-auth');
    driveBtn.addEventListener('click', async () => {
      try {
        if (chrome.identity && chrome.identity.getAuthToken) {
          chrome.identity.getAuthToken({ interactive: true }, (token) => {
            if (chrome.runtime.lastError) {
              alert('Google Drive connection message: ' + chrome.runtime.lastError.message);
              return;
            }
            if (token) {
              chrome.storage.local.set({ google_access_token: token });
              this.updateDriveUI(true);
              this.showToast('✓ Successfully connected to Google Drive!');
            }
          });
        } else {
          alert('Chrome Identity API is only active when loaded as an unpacked extension in Chrome.');
        }
      } catch (err) {
        alert('Could not authenticate: ' + err.message);
      }
    });
  }

  async loadSettings() {
    try {
      const res = await chrome.storage.local.get(['settings', 'google_access_token', 'google_client_id']);
      const s = res.settings || {};

      if (s.defaultFormat) document.getElementById('setting-default-format').value = s.defaultFormat;
      if (s.defaultQuality) {
        document.getElementById('setting-quality').value = s.defaultQuality;
        document.getElementById('quality-val-badge').textContent = s.defaultQuality + '%';
      }
      if (s.autoDownload !== undefined) document.getElementById('setting-auto-download').checked = s.autoDownload;
      if (s.autoDrive !== undefined) document.getElementById('setting-auto-drive').checked = s.autoDrive;
      if (s.highDpr !== undefined) document.getElementById('setting-high-dpr').checked = s.highDpr;
      if (s.hideStickyHeaders !== undefined) document.getElementById('setting-hide-sticky').checked = s.hideStickyHeaders;
      if (s.fullPageDelay) document.getElementById('setting-scroll-delay').value = s.fullPageDelay;
      if (s.namingStyle) document.getElementById('setting-naming-style').value = s.namingStyle;
      if (s.namePrefix) document.getElementById('setting-name-prefix').value = s.namePrefix;
      if (s.driveFolder) document.getElementById('setting-drive-folder').value = s.driveFolder;
      if (res.google_client_id) document.getElementById('setting-google-client-id').value = res.google_client_id;

      this.updateDriveUI(Boolean(res.google_access_token));
    } catch (err) {
      console.error('Error loading settings:', err);
    }
  }

  updateDriveUI(connected) {
    const statusText = document.getElementById('drive-conn-status');
    const statusSub = document.getElementById('drive-conn-sub');
    const btn = document.getElementById('btn-toggle-drive-auth');

    if (connected) {
      statusText.textContent = 'Google Drive: Connected ✓';
      statusText.style.color = '#34d399';
      statusSub.textContent = 'Connected. Screenshots can be saved to your "Said Screenshot Pro" folder.';
      btn.textContent = 'Disconnect';
      btn.style.background = 'rgba(239, 68, 68, 0.2)';
      btn.style.color = '#f87171';
      btn.onclick = () => {
        chrome.storage.local.remove('google_access_token');
        this.updateDriveUI(false);
        this.showToast('Google Drive disconnected.');
      };
    } else {
      statusText.textContent = 'Google Drive: Disconnected';
      statusText.style.color = '#ffffff';
      statusSub.textContent = 'Connect to automatically save screenshots to Google Drive.';
      btn.textContent = 'Connect Account';
      btn.style.background = '#0284c7';
      btn.style.color = '#ffffff';
    }
  }

  updateNamingPreview() {
    const style = document.getElementById('setting-naming-style').value;
    const prefix = document.getElementById('setting-name-prefix').value || 'SaidScreenshot_';
    const previewEl = document.getElementById('naming-preview');

    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    const timeStr = [
      String(now.getHours()).padStart(2, '0'),
      String(now.getMinutes()).padStart(2, '0'),
      String(now.getSeconds()).padStart(2, '0')
    ].join('-');

    if (style === 'title_date') {
      previewEl.textContent = `Google_Homepage_${dateStr}_${timeStr}.png`;
    } else {
      previewEl.textContent = `${prefix}${dateStr}_${timeStr}.png`;
    }
  }

  triggerAutoSave() {
    clearTimeout(this.saveTimeout);
    this.saveTimeout = setTimeout(() => this.saveSettings(), 300);
  }

  async saveSettings() {
    const settings = {
      defaultFormat: document.getElementById('setting-default-format').value,
      defaultQuality: parseInt(document.getElementById('setting-quality').value, 10),
      autoDownload: document.getElementById('setting-auto-download').checked,
      autoDrive: document.getElementById('setting-auto-drive').checked,
      highDpr: document.getElementById('setting-high-dpr').checked,
      hideStickyHeaders: document.getElementById('setting-hide-sticky').checked,
      fullPageDelay: parseInt(document.getElementById('setting-scroll-delay').value, 10),
      namingStyle: document.getElementById('setting-naming-style').value,
      namePrefix: document.getElementById('setting-name-prefix').value,
      driveFolder: document.getElementById('setting-drive-folder').value
    };

    const customClientId = document.getElementById('setting-google-client-id').value.trim();

    await chrome.storage.local.set({
      settings,
      google_client_id: customClientId
    });

    this.showToast('✓ Settings saved!');
  }

  showToast(text) {
    const toast = document.getElementById('save-toast');
    toast.textContent = text;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2000);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new SaidOptions();
});