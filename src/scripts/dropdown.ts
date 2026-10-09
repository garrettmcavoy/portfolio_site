const narrowLayout = window.matchMedia('(max-width: 768px)');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

for (const details of document.querySelectorAll<HTMLDetailsElement>('.dropdown details')) {
  const summary = details.querySelector<HTMLElement>('summary');
  const reveal = details.querySelector<HTMLElement>('.dropdown-reveal');
  if (!summary || !reveal) continue;

  let animation: Animation | null = null;
  let wantedOpen = details.open;

  function settle() {
    animation?.cancel();
    animation = null;
    if (!wantedOpen && reveal!.contains(document.activeElement)) summary!.focus();
    details.open = wantedOpen;
  }

  summary.addEventListener('click', event => {
    event.preventDefault();
    wantedOpen = !wantedOpen;
    if (reducedMotion.matches) {
      settle();
      return;
    }

    const dimension = narrowLayout.matches ? 'width' : 'height';
    const fromSize = details.open ? reveal.getBoundingClientRect()[dimension] : 0;
    const fromOpacity = details.open ? getComputedStyle(reveal).opacity : '0';
    animation?.cancel();
    // Keep native contents available until the closing animation finishes.
    details.open = true;
    const toSize = wantedOpen ? reveal.getBoundingClientRect()[dimension] : 0;
    animation = reveal.animate([
      { [dimension]: `${fromSize}px`, opacity: fromOpacity },
      { [dimension]: `${toSize}px`, opacity: wantedOpen ? '1' : '0' },
    ], { duration: 180, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
    animation.onfinish = settle;
  });

  // A breakpoint change should not leave a width animation on a vertical menu.
  narrowLayout.addEventListener('change', settle);
}
