# Photography optimization

Measured October 9, 2026 against the original checkout at commit `c24c7ff`.

## Local comparison

A fresh Chromium context loaded each production page at 1440 × 900 (1× pixel density) and 390 × 844 (2×). Chrome DevTools emulated 12 Mbps download, 150 ms latency, and 4× CPU slowdown. The original built HTML and its original JPEGs were served locally, alongside the optimized Astro build. Each run waited for network idle without scrolling or opening the lightbox.

| Measurement | Original desktop | Optimized desktop | Original mobile | Optimized mobile |
| --- | ---: | ---: | ---: | ---: |
| Initial photo requests | 38 | 12 | 38 | 5 |
| Photo payload, decimal MB | 24.08 | 0.31 | 24.08 | 0.36 |
| Largest contentful paint | 11.54 s | 0.58 s | 5.54 s | 0.68 s |
| Load event | 16.43 s | 0.73 s | 16.43 s | 0.65 s |
| Cumulative layout shift | 0.397 | 0.005 | 0.143 | 0.015 |

Initial photo bytes fell by approximately 98.5–98.7%. These are single-run local lab measurements, not field measurements of the live domain; hosting, cache state, browser, network, viewport, and device will affect timings. Image payload excludes HTML, styles, scripts, fonts, and the favicon.

## Changes

- Preserve the source images, year groups, photo order, and horizontal gallery presentation.
- Generate appropriately sized WebP variants at build time, including higher-resolution lightbox assets.
- Include intrinsic dimensions and fixed aspect ratios so loading images do not move the gallery.
- Fetch offscreen photos near the viewport, including the clipped horizontal galleries.
- Request enlarged variants only when a visitor opens a photograph.
- Use a native dialog for focus containment, Escape handling, and reliable repeated opening/closing.
- Host the font locally and preload its regular face.
- Use static Astro 7 output; shared navigation works without client JavaScript.
- Consolidate project layouts, add canonical/descriptive metadata and a sitemap, fix invalid CV markup and a missing project destination, and validate the production site before deployment.

## Verification

`astro check`: zero errors, warnings, or hints. Static production build succeeds. Ten Chromium checks cover desktop and mobile loading, scrolling, lightbox controls and focus restoration, routes/links, layout overflow, and JavaScript-disabled use. The gallery-loading test enforces an initial image payload budget of 1 MB and prevents eager loading of all 38 originals. Desktop and mobile screenshots were visually inspected.
