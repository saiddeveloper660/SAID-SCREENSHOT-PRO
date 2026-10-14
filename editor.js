/**
 * Said Screenshot Pro - Studio Editor Logic (editor.js)
 * High-resolution canvas stitching, vector annotation engine, privacy tools, and exports
 */

import { SaidPdfGenerator } from './pdf-export.js';
import { SaidDriveClient } from './drive.js';

class SaidEditor {
  constructor() {
    this.baseCanvas = document.getElementById('base-canvas');
    this.baseCtx = this.baseCanvas.getContext('2d', { willReadFrequently: true });
    this.annotCanvas = document.getElementById('annotation-canvas');
    this.annotCtx = this.annotCanvas.getContext('2d');
    this.viewport = document.getElementById('viewport');
    this.stage = document.getElementById('stage');

    this.filenameInput = document.getElementById('filename-input');
    this.dimBadge = document.getElementById('dim-text');
    this.sizeBadge = document.getElementById('size-text');
    this.strokeSlider = document.getElementById('stroke-width');
    this.strokePreview = document.getElementById('stroke-preview-circle');
    this.undoBtn = document.getElementById('btn-undo');
    this.redoBtn = document.getElementById('btn-redo');

    this.currentTool = 'select';
    this.currentColor = '#0284c7';
    this.currentStroke = 4;
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this.isPanning = false;
    this.startPanX = 0;
    this.startPanY = 0;

    this.history = [];
    this.redoStack = [];
    this.maxHistory = 25;

    this.isDrawing = false;
    this.startX = 0;
    this.startY = 0;
    this.currentPoints = [];

    this.sessionData = null;

    this.init();
  }

  async init() {
    this.setupEvents();
    this.setupModals();
    await this.loadSession();
  }

  async loadSession() {
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get('session');

    if (!sessionId) {
      this.initEmptyCanvas(1280, 720);
      return;
    }

    try {
      const data = await chrome.storage.local.get(sessionId);
      this.sessionData = data[sessionId];

      if (!this.sessionData) {
        this.showToast('No screenshot session found. Creating canvas.');
        this.initEmptyCanvas(1280, 720);
        return;
      }

      if (this.sessionData.filename) {
        this.filenameInput.value = this.sessionData.filename;
      }

      if (this.sessionData.mode === 'fullpage') {
        await this.stitchFullPage(this.sessionData.frames);
      } else if (this.sessionData.mode === 'area') {
        await this.loadAndCropImage(this.sessionData.dataUrl, this.sessionData.cropRect, this.sessionData.dpr);
      } else if (this.sessionData.mode === 'custom_scroll') {
        await this.stitchFullPage(this.sessionData.frames);
      } else {
        await this.loadImage(this.sessionData.dataUrl);
      }

      this.saveSnapshot();
      this.addToRecentHistory();
      this.fitToScreen();
    } catch (err) {
      console.error('Failed to load session:', err);
      this.initEmptyCanvas(1280, 720);
    }
  }

  initEmptyCanvas(w, h) {
    this.baseCanvas.width = w;
    this.baseCanvas.height = h;
    this.annotCanvas.width = w;
    this.annotCanvas.height = h;

    this.baseCtx.fillStyle = '#1e293b';
    this.baseCtx.fillRect(0, 0, w, h);
    this.baseCtx.fillStyle = '#94a3b8';
    this.baseCtx.font = '24px system-ui';
    this.baseCtx.textAlign = 'center';
    this.baseCtx.fillText('Said Screenshot Pro - Ready to Annotate', w / 2, h / 2);

    this.updateDimensionsInfo();
    this.saveSnapshot();
    this.fitToScreen();
  }

  loadImage(dataUrl) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        this.baseCanvas.width = img.width;
        this.baseCanvas.height = img.height;
        this.annotCanvas.width = img.width;
        this.annotCanvas.height = img.height;

        this.baseCtx.drawImage(img, 0, 0);
        this.updateDimensionsInfo();
        resolve();
      };
      img.src = dataUrl;
    });
  }

  loadAndCropImage(dataUrl, rect, dpr = 1) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const cropX = Math.round(rect.x * dpr);
        const cropY = Math.round(rect.y * dpr);
        const cropW = Math.round(rect.width * dpr);
        const cropH = Math.round(rect.height * dpr);

        this.baseCanvas.width = cropW;
        this.baseCanvas.height = cropH;
        this.annotCanvas.width = cropW;
        this.annotCanvas.height = cropH;

        this.baseCtx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
        this.updateDimensionsInfo();
        resolve();
      };
      img.src = dataUrl;
    });
  }

  async stitchFullPage(frames) {
    if (!frames || frames.length === 0) return;

    const firstImg = await this.loadImageAsync(frames[0].dataUrl);
    const frameW = firstImg.width;
    const viewportH = frames[0].viewportHeight;
    const dpr = frameW / frames[0].viewportWidth || 1;

    const totalPixelHeight = Math.round(frames[frames.length - 1].totalHeight * dpr) || Math.round(frames.length * firstImg.height);

    this.baseCanvas.width = frameW;
    this.baseCanvas.height = totalPixelHeight;
    this.annotCanvas.width = frameW;
    this.annotCanvas.height = totalPixelHeight;

    this.baseCtx.drawImage(firstImg, 0, 0);

    for (let i = 1; i < frames.length; i++) {
      const f = frames[i];
      const img = await this.loadImageAsync(f.dataUrl);
      const drawY = Math.round(f.scrollY * dpr);
      this.baseCtx.drawImage(img, 0, drawY);
    }

    this.updateDimensionsInfo();
  }

  loadImageAsync(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.src = src;
    });
  }

  updateDimensionsInfo() {
    const w = this.baseCanvas.width;
    const h = this.baseCanvas.height;
    this.dimBadge.textContent = `${w} × ${h} px`;

    const estBytes = (w * h * 4 * 0.45);
    const kb = (estBytes / 1024).toFixed(0);
    const mb = (estBytes / (1024 * 1024)).toFixed(1);
    this.sizeBadge.textContent = estBytes > 1024 * 1024 ? `${mb} MB` : `${kb} KB`;
  }

  async addToRecentHistory() {
    try {
      const thumb = this.createThumbnail(160, 100);
      const item = {
        id: 'hist_' + Date.now(),
        filename: this.filenameInput.value,
        timestamp: Date.now(),
        width: this.baseCanvas.width,
        height: this.baseCanvas.height,
        thumbnail: thumb,
        dataUrl: this.baseCanvas.toDataURL('image/png', 0.8)
      };

      const res = await chrome.storage.local.get('said_history');
      const history = res.said_history || [];
      history.unshift(item);
      if (history.length > 20) history.pop();

      await chrome.storage.local.set({ said_history: history });
    } catch (_) {}
  }

  createThumbnail(maxW, maxH) {
    const c = document.createElement('canvas');
    const scale = Math.min(maxW / this.baseCanvas.width, maxH / this.baseCanvas.height);
    c.width = Math.round(this.baseCanvas.width * scale);
    c.height = Math.round(this.baseCanvas.height * scale);
    const ctx = c.getContext('2d');
    ctx.drawImage(this.baseCanvas, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.7);
  }

  setupEvents() {
    document.querySelectorAll('.tool-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.setTool(btn.dataset.tool);
      });
    });

    document.querySelectorAll('.color-dot').forEach(dot => {
      dot.addEventListener('click', () => {
        document.querySelectorAll('.color-dot').forEach(d => d.classList.remove('active'));
        dot.classList.add('active');
        this.setColor(dot.dataset.color);
      });
    });

    const customColor = document.getElementById('custom-color-picker');
    customColor.addEventListener('input', (e) => {
      this.setColor(e.target.value);
    });

    this.strokeSlider.addEventListener('input', (e) => {
      this.currentStroke = parseInt(e.target.value, 10);
      this.strokePreview.style.width = Math.min(24, Math.max(4, this.currentStroke)) + 'px';
      this.strokePreview.style.height = this.strokePreview.style.width;
    });

    document.getElementById('btn-zoom-in').addEventListener('click', () => this.setZoom(this.zoom * 1.2));
    document.getElementById('btn-zoom-out').addEventListener('click', () => this.setZoom(this.zoom / 1.2));
    document.getElementById('btn-zoom-reset').addEventListener('click', () => this.setZoom(1));
    document.getElementById('btn-zoom-fit').addEventListener('click', () => this.fitToScreen());

    this.undoBtn.addEventListener('click', () => this.undo());
    this.redoBtn.addEventListener('click', () => this.redo());
    document.getElementById('btn-clear').addEventListener('click', () => this.clearAnnotations());

    this.annotCanvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
    window.addEventListener('mousemove', (e) => this.onMouseMove(e));
    window.addEventListener('mouseup', (e) => this.onMouseUp(e));

    this.viewport.addEventListener('mousedown', (e) => {
      if (this.currentTool === 'select' || e.button === 1 || e.spaceKey) {
        this.isPanning = true;
        this.startPanX = e.clientX - this.panX;
        this.startPanY = e.clientY - this.panY;
      }
    });

    this.viewport.addEventListener('wheel', (e) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.1 : 0.9;
        this.setZoom(this.zoom * factor);
      }
    }, { passive: false });

    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        this.undo();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'Z'))) {
        e.preventDefault();
        this.redo();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
        e.preventDefault();
        this.copyToClipboard();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        this.download('png');
      }
    });

    document.getElementById('btn-copy').addEventListener('click', () => this.copyToClipboard());

    const dlBtn = document.getElementById('btn-download');
    const dlMenu = document.getElementById('download-menu');
    dlBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      dlMenu.classList.toggle('show');
    });
    window.addEventListener('click', () => dlMenu.classList.remove('show'));

    document.querySelectorAll('.dropdown-item').forEach(item => {
      item.addEventListener('click', () => {
        const fmt = item.dataset.format;
        if (fmt === 'jpeg') {
          this.openJpgModal();
        } else {
          this.download(fmt);
        }
      });
    });

    document.getElementById('btn-close').addEventListener('click', () => {
      window.close();
    });
  }

  setTool(tool) {
    this.currentTool = tool;
    if (tool === 'crop') {
      this.initCropBox();
    } else {
      this.hideCropBox();
    }
  }

  setColor(hex) {
    this.currentColor = hex;
    this.strokePreview.style.background = hex;
  }

  setZoom(z) {
    this.zoom = Math.min(5, Math.max(0.1, z));
    document.getElementById('btn-zoom-reset').textContent = `${Math.round(this.zoom * 100)}%`;
    this.applyTransform();
  }

  fitToScreen() {
    const vpW = this.viewport.clientWidth - 80;
    const vpH = this.viewport.clientHeight - 80;
    const cW = this.baseCanvas.width;
    const cH = this.baseCanvas.height;

    const scale = Math.min(vpW / cW, vpH / cH, 1);
    this.zoom = Math.max(0.1, scale);
    this.panX = 0;
    this.panY = 0;
    document.getElementById('btn-zoom-reset').textContent = `${Math.round(this.zoom * 100)}%`;
    this.applyTransform();
  }

  applyTransform() {
    this.stage.style.transform = `scale(${this.zoom})`;
    this.stage.style.transformOrigin = 'center center';
  }

  getCanvasPoint(e) {
    const rect = this.annotCanvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (this.annotCanvas.width / rect.width);
    const y = (e.clientY - rect.top) * (this.annotCanvas.height / rect.height);
    return { x, y };
  }

  onMouseDown(e) {
    if (this.currentTool === 'select' || this.currentTool === 'crop') return;
    if (e.button !== 0) return;

    this.isDrawing = true;
    const pt = this.getCanvasPoint(e);
    this.startX = pt.x;
    this.startY = pt.y;
    this.currentPoints = [pt];

    if (this.currentTool === 'text') {
      this.addTextPrompt(pt.x, pt.y);
      this.isDrawing = false;
    }
  }

  onMouseMove(e) {
    if (this.isPanning) {
      this.panX = e.clientX - this.startPanX;
      this.panY = e.clientY - this.startPanY;
      return;
    }

    if (!this.isDrawing) return;
    const pt = this.getCanvasPoint(e);

    if (this.currentTool === 'pen' || this.currentTool === 'highlighter') {
      this.currentPoints.push(pt);
      this.renderCurrentFreehand();
    } else {
      this.renderCurrentShape(pt.x, pt.y);
    }
  }

  onMouseUp(e) {
    if (this.isPanning) {
      this.isPanning = false;
    }

    if (!this.isDrawing) return;
    this.isDrawing = false;
    const pt = this.getCanvasPoint(e);

    if (this.currentTool === 'blur') {
      this.applyBlur(this.startX, this.startY, pt.x, pt.y);
    } else if (this.currentTool === 'pixelate') {
      this.applyPixelate(this.startX, this.startY, pt.x, pt.y);
    } else {
      this.commitShapeToBaseCanvas(pt.x, pt.y);
    }

    this.annotCtx.clearRect(0, 0, this.annotCanvas.width, this.annotCanvas.height);
    this.saveSnapshot();
  }

  renderCurrentFreehand() {
    this.annotCtx.clearRect(0, 0, this.annotCanvas.width, this.annotCanvas.height);
    this.annotCtx.beginPath();
    this.annotCtx.strokeStyle = this.currentColor;
    this.annotCtx.lineWidth = this.currentStroke;
    this.annotCtx.lineCap = 'round';
    this.annotCtx.lineJoin = 'round';

    if (this.currentTool === 'highlighter') {
      this.annotCtx.globalAlpha = 0.35;
      this.annotCtx.lineWidth = this.currentStroke * 3;
    } else {
      this.annotCtx.globalAlpha = 1.0;
    }

    for (let i = 0; i < this.currentPoints.length; i++) {
      const p = this.currentPoints[i];
      if (i === 0) this.annotCtx.moveTo(p.x, p.y);
      else this.annotCtx.lineTo(p.x, p.y);
    }
    this.annotCtx.stroke();
    this.annotCtx.globalAlpha = 1.0;
  }

  renderCurrentShape(currentX, currentY) {
    this.annotCtx.clearRect(0, 0, this.annotCanvas.width, this.annotCanvas.height);
    this.annotCtx.strokeStyle = this.currentColor;
    this.annotCtx.lineWidth = this.currentStroke;
    this.annotCtx.fillStyle = this.currentColor;

    const w = currentX - this.startX;
    const h = currentY - this.startY;

    if (this.currentTool === 'rect' || this.currentTool === 'blur' || this.currentTool === 'pixelate') {
      this.annotCtx.strokeRect(this.startX, this.startY, w, h);
    } else if (this.currentTool === 'circle') {
      this.annotCtx.beginPath();
      this.annotCtx.ellipse(
        this.startX + w / 2,
        this.startY + h / 2,
        Math.abs(w / 2),
        Math.abs(h / 2),
        0, 0, 2 * Math.PI
      );
      this.annotCtx.stroke();
    } else if (this.currentTool === 'line') {
      this.annotCtx.beginPath();
      this.annotCtx.moveTo(this.startX, this.startY);
      this.annotCtx.lineTo(currentX, currentY);
      this.annotCtx.stroke();
    } else if (this.currentTool === 'arrow') {
      this.drawArrow(this.annotCtx, this.startX, this.startY, currentX, currentY);
    }
  }

  drawArrow(ctx, fromX, fromY, toX, toY) {
    const headLength = Math.max(14, this.currentStroke * 3);
    const angle = Math.atan2(toY - fromY, toX - fromX);

    ctx.beginPath();
    ctx.moveTo(fromX, fromY);
    ctx.lineTo(toX, toY);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(toX, toY);
    ctx.lineTo(toX - headLength * Math.cos(angle - Math.PI / 6), toY - headLength * Math.sin(angle - Math.PI / 6));
    ctx.lineTo(toX - headLength * Math.cos(angle + Math.PI / 6), toY - headLength * Math.sin(angle + Math.PI / 6));
    ctx.closePath();
    ctx.fill();
  }

  commitShapeToBaseCanvas(currentX, currentY) {
    this.baseCtx.strokeStyle = this.currentColor;
    this.baseCtx.lineWidth = this.currentStroke;
    this.baseCtx.fillStyle = this.currentColor;

    if (this.currentTool === 'pen' || this.currentTool === 'highlighter') {
      this.baseCtx.beginPath();
      this.baseCtx.lineCap = 'round';
      this.baseCtx.lineJoin = 'round';

      if (this.currentTool === 'highlighter') {
        this.baseCtx.globalAlpha = 0.35;
        this.baseCtx.lineWidth = this.currentStroke * 3;
      }

      for (let i = 0; i < this.currentPoints.length; i++) {
        const p = this.currentPoints[i];
        if (i === 0) this.baseCtx.moveTo(p.x, p.y);
        else this.baseCtx.lineTo(p.x, p.y);
      }
      this.baseCtx.stroke();
      this.baseCtx.globalAlpha = 1.0;
    } else if (this.currentTool === 'rect') {
      this.baseCtx.strokeRect(this.startX, this.startY, currentX - this.startX, currentY - this.startY);
    } else if (this.currentTool === 'circle') {
      const w = currentX - this.startX;
      const h = currentY - this.startY;
      this.baseCtx.beginPath();
      this.baseCtx.ellipse(this.startX + w / 2, this.startY + h / 2, Math.abs(w / 2), Math.abs(h / 2), 0, 0, 2 * Math.PI);
      this.baseCtx.stroke();
    } else if (this.currentTool === 'line') {
      this.baseCtx.beginPath();
      this.baseCtx.moveTo(this.startX, this.startY);
      this.baseCtx.lineTo(currentX, currentY);
      this.baseCtx.stroke();
    } else if (this.currentTool === 'arrow') {
      this.drawArrow(this.baseCtx, this.startX, this.startY, currentX, currentY);
    }
  }

  addTextPrompt(x, y) {
    const text = window.prompt('Enter annotation text:');
    if (!text) return;

    this.baseCtx.save();
    this.baseCtx.font = `bold ${Math.max(16, this.currentStroke * 4)}px -apple-system, sans-serif`;
    
    const metrics = this.baseCtx.measureText(text);
    const pad = 6;
    this.baseCtx.fillStyle = 'rgba(15, 23, 42, 0.85)';
    this.baseCtx.fillRect(x - pad, y - 20 - pad, metrics.width + pad * 2, 26 + pad);

    this.baseCtx.fillStyle = this.currentColor;
    this.baseCtx.fillText(text, x, y);
    this.baseCtx.restore();

    this.saveSnapshot();
  }

  applyBlur(x1, y1, x2, y2) {
    const minX = Math.max(0, Math.min(x1, x2));
    const minY = Math.max(0, Math.min(y1, y2));
    const w = Math.min(this.baseCanvas.width - minX, Math.abs(x2 - x1));
    const h = Math.min(this.baseCanvas.height - minY, Math.abs(y2 - y1));

    if (w < 4 || h < 4) return;

    const imgData = this.baseCtx.getImageData(minX, minY, w, h);
    const data = imgData.data;

    const radius = Math.max(6, Math.floor(Math.min(w, h) / 10));
    this.fastBoxBlur(data, w, h, radius);

    this.baseCtx.putImageData(imgData, minX, minY);
  }

  fastBoxBlur(data, w, h, r) {
    for (let i = 0; i < data.length; i += 4) {
      const pixelIdx = i / 4;
      const px = pixelIdx % w;
      const py = Math.floor(pixelIdx / w);

      let rSum = 0, gSum = 0, bSum = 0, count = 0;
      for (let dy = -r; dy <= r; dy += 3) {
        for (let dx = -r; dx <= r; dx += 3) {
          const nx = px + dx;
          const ny = py + dy;
          if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
            const nIdx = (ny * w + nx) * 4;
            rSum += data[nIdx];
            gSum += data[nIdx + 1];
            bSum += data[nIdx + 2];
            count++;
          }
        }
      }
      data[i] = rSum / count;
      data[i + 1] = gSum / count;
      data[i + 2] = bSum / count;
    }
  }

  applyPixelate(x1, y1, x2, y2) {
    const minX = Math.round(Math.max(0, Math.min(x1, x2)));
    const minY = Math.round(Math.max(0, Math.min(y1, y2)));
    const w = Math.round(Math.min(this.baseCanvas.width - minX, Math.abs(x2 - x1)));
    const h = Math.round(Math.min(this.baseCanvas.height - minY, Math.abs(y2 - y1)));

    if (w < 4 || h < 4) return;

    const blockSize = Math.max(10, Math.round(Math.min(w, h) / 10));
    const imgData = this.baseCtx.getImageData(minX, minY, w, h);
    const data = imgData.data;

    for (let by = 0; by < h; by += blockSize) {
      for (let bx = 0; bx < w; bx += blockSize) {
        let r = 0, g = 0, b = 0, count = 0;
        for (let dy = 0; dy < blockSize && by + dy < h; dy++) {
          for (let dx = 0; dx < blockSize && bx + dx < w; dx++) {
            const idx = ((by + dy) * w + (bx + dx)) * 4;
            r += data[idx];
            g += data[idx + 1];
            b += data[idx + 2];
            count++;
          }
        }
        r = Math.round(r / count);
        g = Math.round(g / count);
        b = Math.round(b / count);

        for (let dy = 0; dy < blockSize && by + dy < h; dy++) {
          for (let dx = 0; dx < blockSize && bx + dx < w; dx++) {
            const idx = ((by + dy) * w + (bx + dx)) * 4;
            data[idx] = r;
            data[idx + 1] = g;
            data[idx + 2] = b;
          }
        }
      }
    }

    this.baseCtx.putImageData(imgData, minX, minY);
  }

  initCropBox() {
    const cropBox = document.getElementById('crop-overlay');
    cropBox.style.display = 'block';

    const w = Math.round(this.baseCanvas.width * 0.8);
    const h = Math.round(this.baseCanvas.height * 0.8);
    const x = Math.round(this.baseCanvas.width * 0.1);
    const y = Math.round(this.baseCanvas.height * 0.1);

    cropBox.style.left = x + 'px';
    cropBox.style.top = y + 'px';
    cropBox.style.width = w + 'px';
    cropBox.style.height = h + 'px';
    document.getElementById('crop-dim-badge').textContent = `${w} × ${h} px`;

    document.getElementById('btn-apply-crop').onclick = () => {
      const cropRect = {
        x: parseInt(cropBox.style.left, 10),
        y: parseInt(cropBox.style.top, 10),
        w: parseInt(cropBox.style.width, 10),
        h: parseInt(cropBox.style.height, 10)
      };
      this.executeCrop(cropRect);
      this.hideCropBox();
      this.setTool('select');
    };

    document.getElementById('btn-cancel-crop').onclick = () => {
      this.hideCropBox();
      this.setTool('select');
    };
  }

  hideCropBox() {
    document.getElementById('crop-overlay').style.display = 'none';
  }

  executeCrop(rect) {
    const cropped = document.createElement('canvas');
    cropped.width = rect.w;
    cropped.height = rect.h;
    const ctx = cropped.getContext('2d');
    ctx.drawImage(this.baseCanvas, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);

    this.baseCanvas.width = rect.w;
    this.baseCanvas.height = rect.h;
    this.annotCanvas.width = rect.w;
    this.annotCanvas.height = rect.h;

    this.baseCtx.drawImage(cropped, 0, 0);
    this.updateDimensionsInfo();
    this.saveSnapshot();
    this.fitToScreen();
    this.showToast('Crop applied successfully!');
  }

  saveSnapshot() {
    const snapshot = this.baseCtx.getImageData(0, 0, this.baseCanvas.width, this.baseCanvas.height);
    this.history.push({
      width: this.baseCanvas.width,
      height: this.baseCanvas.height,
      data: snapshot
    });
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }
    this.redoStack = [];
    this.updateHistoryButtons();
  }

  undo() {
    if (this.history.length <= 1) return;
    const current = this.history.pop();
    this.redoStack.push(current);

    const prev = this.history[this.history.length - 1];
    this.restoreSnapshot(prev);
    this.updateHistoryButtons();
  }

  redo() {
    if (this.redoStack.length === 0) return;
    const next = this.redoStack.pop();
    this.history.push(next);
    this.restoreSnapshot(next);
    this.updateHistoryButtons();
  }

  restoreSnapshot(snap) {
    this.baseCanvas.width = snap.width;
    this.baseCanvas.height = snap.height;
    this.annotCanvas.width = snap.width;
    this.annotCanvas.height = snap.height;
    this.baseCtx.putImageData(snap.data, 0, 0);
    this.updateDimensionsInfo();
  }

  updateHistoryButtons() {
    this.undoBtn.disabled = this.history.length <= 1;
    this.redoBtn.disabled = this.redoStack.length === 0;
  }

  clearAnnotations() {
    if (confirm('Reset canvas to initial captured state?')) {
      if (this.history.length > 0) {
        this.restoreSnapshot(this.history[0]);
        this.history = [this.history[0]];
        this.redoStack = [];
        this.updateHistoryButtons();
        this.showToast('Canvas reset to original capture.');
      }
    }
  }

  async copyToClipboard() {
    try {
      this.baseCanvas.toBlob(async (blob) => {
        if (!blob) throw new Error('Blob generation failed');
        await navigator.clipboard.write([
          new ClipboardItem({ 'image/png': blob })
        ]);
        this.showToast('✓ Screenshot copied to clipboard! Ready to paste (WhatsApp, Slack, Messenger).');
      }, 'image/png');
    } catch (err) {
      console.error('Clipboard copy failed:', err);
      this.showToast('⚠️ Could not copy to clipboard: ' + err.message);
    }
  }

  download(format = 'png', quality = 1.0) {
    const filename = (this.filenameInput.value || 'SaidScreenshot').trim() + '.' + (format === 'jpeg' ? 'jpg' : format);
    const mime = format === 'jpeg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png';

    const dataUrl = this.baseCanvas.toDataURL(mime, quality);
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    this.showToast(`✓ Saved as ${filename}`);
  }

  openJpgModal() {
    const modal = document.getElementById('jpg-modal');
    modal.style.display = 'flex';
  }

  showToast(msg) {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3500);
  }

  setupModals() {
    const jpgModal = document.getElementById('jpg-modal');
    const jpgSlider = document.getElementById('jpg-quality-slider');
    const jpgVal = document.getElementById('jpg-quality-val');

    jpgSlider.addEventListener('input', (e) => {
      jpgVal.textContent = e.target.value + '%';
    });

    document.getElementById('btn-close-jpg-modal').onclick = () => jpgModal.style.display = 'none';
    document.getElementById('btn-confirm-jpg-download').onclick = () => {
      const q = parseInt(jpgSlider.value, 10) / 100;
      jpgModal.style.display = 'none';
      this.download('jpeg', q);
    };

    const pdfModal = document.getElementById('pdf-modal');
    document.getElementById('btn-pdf-modal').onclick = () => pdfModal.style.display = 'flex';
    document.getElementById('btn-close-pdf-modal').onclick = () => pdfModal.style.display = 'none';
    document.getElementById('btn-cancel-pdf').onclick = () => pdfModal.style.display = 'none';

    document.getElementById('btn-generate-pdf').onclick = async () => {
      pdfModal.style.display = 'none';
      this.showToast('Generating high-resolution PDF...');

      const orientation = document.querySelector('input[name="pdf-format"]:checked').value;
      const multiPage = document.getElementById('pdf-multipage').checked;
      const title = this.filenameInput.value || 'Said Screenshot Pro';

      try {
        const pdfBlob = await SaidPdfGenerator.createPdf(this.baseCanvas, {
          orientation,
          pageSize: orientation === 'original' ? 'original' : 'a4',
          multiPage,
          title
        });

        const url = URL.createObjectURL(pdfBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${title}.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        this.showToast('✓ PDF downloaded successfully!');
      } catch (err) {
        console.error('PDF generation error:', err);
        this.showToast('⚠️ PDF creation failed: ' + err.message);
      }
    };

    const driveModal = document.getElementById('drive-modal');
    document.getElementById('btn-drive-modal').onclick = () => driveModal.style.display = 'flex';
    document.getElementById('btn-close-drive-modal').onclick = () => driveModal.style.display = 'none';
    document.getElementById('btn-cancel-drive').onclick = () => driveModal.style.display = 'none';

    document.getElementById('btn-confirm-drive').onclick = async () => {
      const dest = document.querySelector('input[name="save-dest"]:checked').value;
      const progressWrap = document.getElementById('drive-upload-progress');
      const progressFill = document.getElementById('drive-progress-fill');
      const progressText = document.getElementById('drive-progress-text');
      const successAlert = document.getElementById('drive-success-alert');
      const errorAlert = document.getElementById('drive-error-alert');
      const openLink = document.getElementById('drive-open-link');

      progressWrap.style.display = 'block';
      progressFill.style.width = '30%';
      progressText.textContent = 'Connecting to Google Drive...';
      successAlert.style.display = 'none';
      errorAlert.style.display = 'none';

      try {
        if (dest === 'computer' || dest === 'both') {
          this.download('png');
        }

        if (dest === 'computer') {
          driveModal.style.display = 'none';
          return;
        }

        progressFill.style.width = '60%';
        progressText.textContent = 'Uploading high-resolution file...';

        const filename = (this.filenameInput.value || 'SaidScreenshot') + '.png';
        const fileBlob = await new Promise(r => this.baseCanvas.toBlob(r, 'image/png'));

        const driveResult = await SaidDriveClient.uploadFile(fileBlob, filename, 'Said Screenshot Pro');

        progressFill.style.width = '100%';
        progressText.textContent = 'Completed!';
        successAlert.style.display = 'flex';
        openLink.href = driveResult.webViewLink || 'https://drive.google.com';
        this.showToast('✓ Screenshot saved to Google Drive!');
      } catch (err) {
        console.error('Drive upload failed:', err);
        progressWrap.style.display = 'none';
        errorAlert.style.display = 'block';
        errorAlert.textContent = '⚠️ ' + (err.message || 'Drive connection error. Check Settings for Google Client ID.');
      }
    };
  }
}

window.addEventListener('DOMContentLoaded', () => {
  new SaidEditor();
});