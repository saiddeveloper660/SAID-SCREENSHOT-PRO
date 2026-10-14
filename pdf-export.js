/**
 * Said Screenshot Pro - Pure JavaScript PDF Generator (pdf-export.js)
 * Standalone PDF 1.4 builder with multi-page splitting and zero external dependencies
 */

export class SaidPdfGenerator {
  static async createPdf(source, options = {}) {
    const {
      orientation = 'portrait',
      pageSize = 'a4',
      multiPage = true,
      title = 'Said Screenshot'
    } = options;

    let canvas;
    if (source instanceof HTMLCanvasElement) {
      canvas = source;
    } else {
      canvas = document.createElement('canvas');
      canvas.width = source.naturalWidth || source.width;
      canvas.height = source.naturalHeight || source.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(source, 0, 0);
    }

    const srcW = canvas.width;
    const srcH = canvas.height;

    let pageW = 595.28;
    let pageH = 841.89;

    if (pageSize === 'original') {
      pageW = srcW * 0.75;
      pageH = srcH * 0.75;
    } else if (orientation === 'landscape') {
      pageW = 841.89;
      pageH = 595.28;
    }

    const slices = [];
    const margin = 20;
    const contentW = pageW - margin * 2;
    const contentH = pageH - margin * 2;

    const scale = contentW / srcW;
    const totalRenderedHeight = srcH * scale;

    if (multiPage && totalRenderedHeight > contentH) {
      const sliceSrcHeight = contentH / scale;
      let offsetY = 0;

      while (offsetY < srcH) {
        const sliceH = Math.min(sliceSrcHeight, srcH - offsetY);
        const sliceCanvas = document.createElement('canvas');
        sliceCanvas.width = srcW;
        sliceCanvas.height = sliceH;
        const sctx = sliceCanvas.getContext('2d');
        sctx.drawImage(canvas, 0, offsetY, srcW, sliceH, 0, 0, srcW, sliceH);

        const jpegData = await this.canvasToJpegBytes(sliceCanvas, 0.92);
        slices.push({
          bytes: jpegData,
          width: srcW,
          height: sliceH,
          renderW: contentW,
          renderH: sliceH * scale,
          posX: margin,
          posY: pageH - margin - (sliceH * scale)
        });

        offsetY += sliceH;
      }
    } else {
      let finalW = contentW;
      let finalH = totalRenderedHeight;
      if (finalH > contentH) {
        const fitScale = contentH / finalH;
        finalW *= fitScale;
        finalH *= fitScale;
      }

      const jpegData = await this.canvasToJpegBytes(canvas, 0.92);
      slices.push({
        bytes: jpegData,
        width: srcW,
        height: srcH,
        renderW: finalW,
        renderH: finalH,
        posX: (pageW - finalW) / 2,
        posY: (pageH - finalH) / 2
      });
    }

    return this.buildPdfBinary(slices, pageW, pageH, title);
  }

  static canvasToJpegBytes(canvas, quality = 0.92) {
    return new Promise((resolve) => {
      canvas.toBlob(async (blob) => {
        const arrayBuf = await blob.arrayBuffer();
        resolve(new Uint8Array(arrayBuf));
      }, 'image/jpeg', quality);
    });
  }

  static buildPdfBinary(slices, pageW, pageH, title) {
    const objects = [];
    const xrefOffsets = [];

    function addObject(content) {
      const id = objects.length + 1;
      objects.push({ id, content });
      return id;
    }

    const catalogId = addObject(`<< /Type /Catalog /Pages 2 0 R >>`);

    const pageCount = slices.length;
    const pageIds = [];
    for (let i = 0; i < pageCount; i++) {
      pageIds.push(3 + i * 3);
    }

    const pagesKids = pageIds.map(id => `${id} 0 R`).join(' ');
    const pagesContent = `<< /Type /Pages /Kids [${pagesKids}] /Count ${pageCount} >>`;
    objects.push({ id: 2, content: pagesContent });

    slices.forEach((slice, idx) => {
      const pageObjId = 3 + idx * 3;
      const contentObjId = pageObjId + 1;
      const imageObjId = pageObjId + 2;

      const pageObj = `<<
  /Type /Page
  /Parent 2 0 R
  /MediaBox [0 0 ${pageW.toFixed(2)} ${pageH.toFixed(2)}]
  /Contents ${contentObjId} 0 R
  /Resources <<
    /ProcSet [/PDF /ImageC]
    /XObject << /Im${idx} ${imageObjId} 0 R >>
  >>
>>`;
      objects.push({ id: pageObjId, content: pageObj });

      const streamContent = `q
${slice.renderW.toFixed(2)} 0 0 ${slice.renderH.toFixed(2)} ${slice.posX.toFixed(2)} ${slice.posY.toFixed(2)} cm
/Im${idx} Do
Q`;
      const contentObj = `<< /Length ${streamContent.length} >>
stream
${streamContent}
endstream`;
      objects.push({ id: contentObjId, content: contentObj });

      const imgHeader = `<<
  /Type /XObject
  /Subtype /Image
  /Width ${slice.width}
  /Height ${slice.height}
  /ColorSpace /DeviceRGB
  /BitsPerComponent 8
  /Filter /DCTDecode
  /Length ${slice.bytes.length}
>>
stream\n`;
      const imgFooter = `\nendstream`;
      
      objects.push({
        id: imageObjId,
        isBinary: true,
        header: imgHeader,
        bytes: slice.bytes,
        footer: imgFooter
      });
    });

    const parts = [];
    const encoder = new TextEncoder();
    let currentOffset = 0;

    function appendString(str) {
      const buf = encoder.encode(str);
      parts.push(buf);
      currentOffset += buf.length;
    }

    function appendBytes(bytes) {
      parts.push(bytes);
      currentOffset += bytes.length;
    }

    appendString("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");

    xrefOffsets.push(0);
    objects.forEach(obj => {
      xrefOffsets[obj.id] = currentOffset;
      appendString(`${obj.id} 0 obj\n`);
      if (obj.isBinary) {
        appendString(obj.header);
        appendBytes(obj.bytes);
        appendString(obj.footer);
      } else {
        appendString(obj.content);
      }
      appendString(`\nendobj\n`);
    });

    const startXref = currentOffset;
    appendString(`xref\n0 ${objects.length + 1}\n`);
    appendString(`0000000000 65535 f \n`);
    for (let i = 1; i <= objects.length; i++) {
      const off = String(xrefOffsets[i]).padStart(10, '0');
      appendString(`${off} 00000 n \n`);
    }

    appendString(`trailer\n<<\n  /Size ${objects.length + 1}\n  /Root 1 0 R\n>>\n`);
    appendString(`startxref\n${startXref}\n%%EOF`);

    return new Blob(parts, { type: 'application/pdf' });
  }
}