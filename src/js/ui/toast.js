/**
 * Toast notification UI for CopyBoard.
 */

export function showToast(message) {
  const toast = document.getElementById('toast');

  if (!toast) {
    console.warn('CopyBoard: Toast-Element nicht gefunden.', message);
    return;
  }

  toast.textContent = message;
  toast.classList.add('show');

  clearTimeout(showToast._timer);

  showToast._timer = setTimeout(() => {
    toast.classList.remove('show');
  }, 1900);
}
