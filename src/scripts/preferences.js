export function setupTheme() {
  document.querySelectorAll('.theme-toggle').forEach(button => button.addEventListener('click', () => {
    const theme = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('chatty-theme', theme); } catch {}
  }));
}
