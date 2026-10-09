# Garrett McAvoy's portfolio

A static Astro portfolio, deployed to GitHub Pages at https://garrettmcavoy.com.

## Development

Use Node 22.19 or newer (the `.nvmrc` selects Node 22):

```sh
nvm use
npm ci
npm run dev
```

```sh
npm run check
npm run build
npx playwright install chromium webkit
npm test
npm run preview
```

Browser tests use the production build. They cover desktop and mobile gallery loading, horizontal and vertical scrolling, lightbox keyboard controls and focus, navigation, local links, and the JavaScript-disabled fallback.

## Structure

- `src/layouts/Layout.astro`: document metadata, sidebar, and navigation.
- `src/layouts/ProjectLayout.astro`: shared engineering project layout.
- `src/styles/global.css`: site styles and locally hosted Garamond fonts.
- `src/data/photography.ts`: year groups and the existing photo order.
- `src/assets/images/`: original images, preserved without recompression.
- `src/components/GalleryPhoto.astro`: responsive gallery and enlarged WebP assets generated at build time.
- `src/components/OptimizedImage.astro`: shared responsive project imagery.
- `src/scripts/gallery.ts`: viewport image loading and the native dialog lightbox.
- `src/scripts/dropdown.ts`: 180 ms vertical/horizontal menu animation with reduced-motion support.
- `src/components/Aquarium.astro` and `src/scripts/aquarium.ts`: home page reef, WebGL fish animation, saved background/audio preferences, and glass-tap sounds.
- `public/aquarium/`: converted early SereneScreen reference artwork; provenance and implementation notes are in [docs/aquarium.md](docs/aquarium.md).

To add photographs, put originals in `src/assets/images/<year>/` and add their relative paths to `src/data/photography.ts`. Astro infers dimensions and generates the required sizes. If known, replace generic photo labels with descriptive captions in the gallery data/component.

Only the first photograph is eager/high priority. Other images are kept in templates until an IntersectionObserver sees them near the viewport, including the horizontal strips. A `noscript` fallback preserves the gallery without JavaScript. Enlarged images are requested only on activation; the anchor opens the image directly when scripting is disabled. Shared navigation uses native `details` and works without JavaScript. A small script adds quick opening and closing animations, with instant toggling for reduced motion.

## Deployment

Pushes to `master` run type checks and a static build, then deploy through GitHub Pages. Chromium/WebKit browser tests run separately on pull requests or through the manually dispatched **Browser tests** action; they do not block deployment. Build-time image transforms are cached in CI. The site needs no application server, runtime image service, or database.

See [the optimization measurements](docs/performance.md) for a local before/after comparison.
