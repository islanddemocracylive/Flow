/**
 * Open Simulator modal – open in new window, URL display, QR code, copy.
 */

export function setupShareModal(sim) {
  const shareModal = document.getElementById('share-modal');
  const shareUrlInput = document.getElementById('share-url');
  const btnShareViewer = document.getElementById('btn-share-viewer');
  const btnCopyUrl = document.getElementById('btn-copy-url');
  const shareCopyStatus = document.getElementById('share-copy-status');
  const openViewerLink = document.getElementById('open-viewer-link');

  if (!shareModal || !btnShareViewer) return;

  function getViewerUrl() {
    return location.origin + '/viewer.html';
  }

  // Open Simulator button in header → show modal
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

  // "Open in New Window" link inside modal – save scenario first
  if (openViewerLink && sim) {
    openViewerLink.addEventListener('click', () => {
      localStorage.setItem('flow_viewer_scenario', JSON.stringify(sim.toScenarioData()));
    });
  }

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
