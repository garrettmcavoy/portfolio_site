import { Color } from 'three';

export const backgrounds = {
  classic: { top: [.002, .012, .12], bottom: [.018, .14, .105], light: 1, tint: 0xfff5df },
  blue: { top: [.003, .028, .22], bottom: [.012, .10, .23], light: 1.05, tint: 0xe9f6ff },
  lagoon: { top: [.004, .06, .12], bottom: [.025, .25, .19], light: 1.1, tint: 0xecffeb },
  dusk: { top: [.02, .008, .075], bottom: [.075, .055, .10], light: .75, tint: 0xffd2a0 },
  night: { top: [.001, .003, .018], bottom: [.003, .016, .035], light: .4, tint: 0xb9d8ff },
  black: { top: [0, 0, 0], bottom: [0, 0, 0], light: 1, tint: 0xfff5df },
};
export type Background = keyof typeof backgrounds;

// Match the shader's upper water color at its initial light level, converting
// linear RGB to the sRGB color used by CSS and browser chrome.
export const backgroundColors = Object.fromEntries(Object.entries(backgrounds).map(([name, preset]) => [
  name, `#${new Color().setRGB(...preset.top as [number, number, number]).multiplyScalar(.84).getHexString()}`,
])) as Record<Background, string>;
