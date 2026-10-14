/**
 * Said Screenshot Pro - Google Drive API Client (drive.js)
 * Clean OAuth2 integration with folder auto-creation and zero hardcoded secrets
 */

export class SaidDriveClient {
  static async getAuthToken(interactive = true) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(['google_access_token', 'google_client_id'], (data) => {
        if (data.google_access_token) {
          return resolve(data.google_access_token);
        }

        if (chrome.identity && chrome.identity.getAuthToken) {
          chrome.identity.getAuthToken({ interactive }, (token) => {
            if (chrome.runtime.lastError) {
              const err = chrome.runtime.lastError.message || '';
              if (err.includes('OAuth2 client id is not found') || err.includes('client_id')) {
                return reject(new Error('Google Client ID is not configured in manifest or settings. Please check Extension Options.'));
              }
              return reject(new Error(err));
            }
            if (!token) {
              return reject(new Error('Failed to retrieve Google Auth token.'));
            }
            resolve(token);
          });
        } else {
          reject(new Error('Chrome Identity API is unavailable in this environment.'));
        }
      });
    });
  }

  static async getOrCreateFolder(token, folderName = 'Said Screenshot Pro') {
    const query = encodeURIComponent(`mimeType = 'application/vnd.google-apps.folder' and name = '${folderName}' and trashed = false`);
    const searchRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name)`, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    if (!searchRes.ok) {
      if (searchRes.status === 401) {
        throw new Error('Authentication expired. Please reconnect your Google Drive.');
      }
      const err = await searchRes.json().catch(() => ({}));
      throw new Error(err.error?.message || 'Error searching Google Drive folders.');
    }

    const searchData = await searchRes.json();
    if (searchData.files && searchData.files.length > 0) {
      return searchData.files[0].id;
    }

    const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder'
      })
    });

    if (!createRes.ok) {
      const err = await createRes.json().catch(() => ({}));
      throw new Error(err.error?.message || 'Failed to create Said Screenshot Pro folder in Google Drive.');
    }

    const folderData = await createRes.json();
    return folderData.id;
  }

  static async uploadFile(fileBlob, filename, folderName = 'Said Screenshot Pro') {
    const token = await this.getAuthToken(true);
    const folderId = await this.getOrCreateFolder(token, folderName);

    const metadata = {
      name: filename,
      parents: [folderId]
    };

    const boundary = '-------SaidScreenshotPro' + Math.random().toString(36).substring(2);
    const delimiter = `\r\n--${boundary}\r\n`;
    const closeDelimiter = `\r\n--${boundary}--`;

    const arrayBuffer = await fileBlob.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);

    const metaHeader = 'Content-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(metadata);
    const fileHeader = `Content-Type: ${fileBlob.type || 'image/png'}\r\n\r\n`;

    const encoder = new TextEncoder();
    const metaPart = encoder.encode(delimiter + metaHeader + delimiter + fileHeader);
    const closePart = encoder.encode(closeDelimiter);

    const fullBody = new Uint8Array(metaPart.length + bytes.length + closePart.length);
    fullBody.set(metaPart, 0);
    fullBody.set(bytes, metaPart.length);
    fullBody.set(closePart, metaPart.length + bytes.length);

    const uploadRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`
      },
      body: fullBody
    });

    if (!uploadRes.ok) {
      const err = await uploadRes.json().catch(() => ({}));
      throw new Error(err.error?.message || 'Failed to upload screenshot to Google Drive.');
    }

    const file = await uploadRes.json();
    return file;
  }
}