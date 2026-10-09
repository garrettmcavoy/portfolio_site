import type { ImageMetadata } from 'astro';

const images = import.meta.glob<{ default: ImageMetadata }>(
  '../assets/images/**/*.{jpg,jpeg,png,webp}',
);

export async function imageSource(path: string): Promise<ImageMetadata> {
  const load = images[`../assets/images/${path}`];
  if (!load) throw new Error(`Missing portfolio image: ${path}`);
  return (await load()).default;
}

export function imageWidths(source: ImageMetadata, widths: number[]): number[] {
  return [...new Set(widths.map((width) => Math.min(width, source.width)))];
}
