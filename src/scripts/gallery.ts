const gallery = document.querySelector<HTMLElement>('.photography-container');
const dialog = document.querySelector<HTMLDialogElement>('[data-lightbox]');
const enlarged = dialog?.querySelector<HTMLImageElement>('.lightbox-image');

function revealPhoto(link: Element) {
  const template = link.querySelector<HTMLTemplateElement>('template[data-photo-image]');
  if (template) template.replaceWith(template.content.cloneNode(true));
}

if (gallery && dialog && enlarged) {
  // Observe viewport visibility, including clipping inside each horizontal strip.
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        revealPhoto(entry.target);
        observer.unobserve(entry.target);
      }
    }, { rootMargin: '160px' });
    gallery.querySelectorAll('[data-photo]').forEach(link => observer.observe(link));
  } else {
    gallery.querySelectorAll('[data-photo]').forEach(revealPhoto);
  }

  let previousOverflow = '';
  let opener: HTMLAnchorElement | null = null;

  gallery.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) return;
    const link = event.target.closest<HTMLAnchorElement>('[data-photo]');
    if (!link || !(event instanceof MouseEvent) || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    opener = link;
    revealPhoto(link);
    enlarged.alt = link.dataset.alt ?? '';
    enlarged.width = Number(link.dataset.width);
    enlarged.height = Number(link.dataset.height);
    enlarged.sizes = '90vw';
    enlarged.srcset = link.dataset.fullSrcset ?? '';
    enlarged.src = link.href;
    previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.showModal();
  });

  function closeLightbox() {
    if (!dialog?.open || !enlarged) return;
    document.body.style.overflow = previousOverflow;
    enlarged.removeAttribute('srcset');
    enlarged.removeAttribute('src');
    opener?.focus({ preventScroll: true });
    dialog.close();
    opener = null;
  }
  dialog.addEventListener('click', closeLightbox);
  dialog.addEventListener('cancel', event => {
    event.preventDefault();
    closeLightbox();
  });
}
