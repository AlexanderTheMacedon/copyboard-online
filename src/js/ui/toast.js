/**
 * Global toast notification UI for CopyBoard.
 */

function showToast(msg){
    toast.textContent = msg; toast.classList.add('show');
    clearTimeout(showToast._t); showToast._t = setTimeout(()=>toast.classList.remove('show'), 1900);
  }

  // ================= V34.0 PERSONAL CLOUD SYNC =================
  // The complete board remains a local-first snapshot. Realtime only announces
  // a small revision row; the corresponding JSON snapshot is then downloaded.
