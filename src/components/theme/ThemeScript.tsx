/**
 * Applies the saved theme before first paint.
 *
 * Without this the page renders light and then flips to dark on hydration — the
 * classic dark-mode flash. It has to be an inline script in <head> because it must
 * run before the browser paints anything.
 */
const script = `
(function () {
  try {
    var stored = localStorage.getItem('abl-theme-v2');
    var dark = stored === 'dark';
    if (dark) document.documentElement.classList.add('dark');
  } catch (e) {
    /* private mode / storage disabled — fall back to the light default */
  }
})();
`;

export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}
