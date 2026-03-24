/**
 * Share Simulator modal – URL display, QR code, and copy functionality.
 */

export function setupShareModal() {
  const shareModal = document.getElementById('share-modal');
  const shareUrlInput = document.getElementById('share-url');
  const btnShareViewer = document.getElementById('btn-share-viewer');
  const btnCopyUrl = document.getElementById('btn-copy-url');
  const shareCopyStatus = document.getElementById('share-copy-status');

  if (!shareModal || !btnShareViewer) return;

  function getViewerUrl() {
    return location.origin + '/viewer.html';
  }

  btnShareViewer.addEventListener('click', () => {
    const url = getViewerUrl();
    shareUrlInput.value = url;
    shareCopyStatus.textContent = '';
    shareModal.style.display = 'flex';

    if (typeof QRious !== 'undefined') {
      new QRious({
        element: document.getElementById('share-qr'),
        value: url,
        size: 200,
        backgroundAlpha: 0,
        foreground: '#e0e0e0',
        level: 'M',
      });
    }
  });

  btnCopyUrl.addEventListener('click', () => {
    navigator.clipboard.writeText(shareUrlInput.value).then(() => {
      shareCopyStatus.textContent = 'Copied!';
    }).catch(() => {
      shareUrlInput.select();
      shareCopyStatus.textContent = 'Press Ctrl+C to copy';
    });
  });

  document.getElementById('share-modal-close').addEventListener('click', () => {
    shareModal.style.display = 'none';
  });

  shareModal.addEventListener('click', (e) => {
    if (e.target === shareModal) shareModal.style.display = 'none';
  });
}
