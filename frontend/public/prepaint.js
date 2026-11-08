(() => {
  const root = document.documentElement;
  const served = root.dataset.colorScheme;
  let stored = null;
  try {
    stored = localStorage.getItem('darkmode');
  } catch {
    stored = null;
  }
  const dark =
    served === 'dark' ||
    (served !== 'light' &&
      (stored === null ? matchMedia('(prefers-color-scheme: dark)').matches : stored === 'true' || stored === '1'));
  root.classList.toggle('dark', dark);
})();
