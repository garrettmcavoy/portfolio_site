// Temporary, opt-in display measurements for debugging Safari on a real phone.
// Nothing is transmitted; the owner can copy the values from this page.
export function showViewportInfo(container: HTMLElement) {
  if (!new URLSearchParams(location.search).has('viewport-info')) return;
  const panel = document.createElement('div');
  panel.style.cssText = 'position:absolute;z-index:20;top:160px;left:1rem;right:1rem;max-width:30rem;max-height:calc(100svh - 180px);overflow:auto;padding:1rem;background:#fff;color:#000;border-radius:6px;font:13px/1.4 system-ui;';
  const heading = document.createElement('strong');
  heading.textContent = 'Safari display measurements';
  const output = document.createElement('pre');
  output.style.cssText = 'white-space:pre-wrap;margin:.7rem 0;';
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Copy display info';
  button.style.cssText = 'padding:.6rem .8rem;font:inherit;';
  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;top:-10000px;left:-10000px;visibility:hidden;box-sizing:content-box;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom);height:100lvh;width:0;pointer-events:none;';
  panel.append(heading, button, output);
  document.body.append(panel, probe);
  function measure() {
    const rect = container.getBoundingClientRect();
    const visual = visualViewport;
    const style = getComputedStyle(probe);
    output.textContent = JSON.stringify({
      screen: [screen.width, screen.height],
      inner: [innerWidth, innerHeight],
      client: [document.documentElement.clientWidth, document.documentElement.clientHeight],
      largeViewport: probe.getBoundingClientRect().height-parseFloat(style.paddingTop)-parseFloat(style.paddingBottom),
      safeArea: [style.paddingTop, style.paddingBottom],
      scene: [rect.x, rect.y, rect.width, rect.height],
      documentHeight: document.documentElement.scrollHeight,
      visual: visual ? [visual.width, visual.height, visual.offsetTop, visual.scale] : null,
      userAgent: navigator.userAgent,
    }, null, 2);
  }
  button.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(output.textContent!); button.textContent = 'Copied'; }
    catch { button.textContent = 'Select and copy the measurements above'; }
  });
  const observer = new ResizeObserver(measure);
  observer.observe(container);
  window.addEventListener('resize', measure);
  visualViewport?.addEventListener('resize', measure);
  measure();
}
