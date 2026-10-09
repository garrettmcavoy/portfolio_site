# Home page aquarium

The home scene uses the early SereneScreen Marine Aquarium reef and fish artwork,
with a new browser renderer. The verified reference is the publisher's official
Aquarium 1.1.2 Windows distribution, listed under Marine Aquarium 1 in its FAQ.
An exact 1.0 distribution was not verified. This recreates the early 1.x scene
with the original fish geometry and artwork, samples of its swimming routine,
and a new browser renderer. It is not a verified pixel-for-pixel 1.0 reproduction.

- Publisher's legacy download listing: https://www.serenescreen.com/faq.html
- Reference installer: https://prolific.s3.amazonaws.com/Marine%20Aquarium/Windows/AquariumV11.exe
- Original artwork: Jim Sachs / SereneScreen / Prolific Publishing.
- The reference installer is stored outside the repository and was extracted
  without executing or installing the Windows program.
- Converted artwork retains its original ownership; it is not newly authored
  portfolio artwork or an open-source asset pack.

`public/aquarium/scene.json` contains the original mesh positions, UV coordinates,
surface normals, body-bend poses, and material assignments. Textures are lossless
WebP conversions of the original DDS resources. `bubbles.mp3` is converted from
the reference's looping bubble audio. The still reef provides an immediate
loading image and a fallback for unavailable JavaScript or WebGL.

Fish retain the original indexed vertices and outward triangle winding after
the Z reflection. Smooth vertex normals are refreshed during body deformation.
Fish use the recovered UVs without an extra vertical flip, which otherwise
inverts markings and cuts transparent texture areas through the body. Main fin
pivots follow the deformed body's attachment depth.

The renderer is loaded only on the home page. It limits pixel density to 1.5,
reuses geometry and textures, and stops rendering offscreen or in a hidden tab.
The animation follows the browser's reduced-motion preference. Bubble ambience
is enabled by default; browsers that block audible autoplay start it on the first
pointer or keyboard interaction. Aquarium
presses and touches, including over fish and reef, start a brief synthesized glass
tap on pointer-down, using an interactive audio latency hint. Navigation and
controls do not. Every tenth unmuted glass tap plays a short voice warning;
subsequent triggers during playback do not stack or restart it. The 54 KB clip
loads on the first glass tap, and the bubble ambience dips during speech. Mute
silences all aquarium audio and stops a speaking clip immediately. Tap counting
resets with each home-page visit. The user-supplied recording is trimmed only
at its beginning/end (1.20–5.65 s); all pauses between lines remain. The pitch
is lowered six semitones at the original tempo, with mild saturation and a
controlled output level. `scripts/process-aquarium-voice.sh` reproduces the
edit from the original recording, which is not included in the repository.
The decoded bubble recording loops through
Web Audio with a 120 ms crossfade to avoid a playback gap. The home aquarium
fills the viewport. Resizing crops
the original composition without stretching the fish, keeps the seabed in view
with a downward shift of 5% of the viewport height to crop the bottom lettering,
and leaves the title/navigation in white over the scene. Other pages retain
their usual layout and colors.

Two small white icons sit at the top right: a speaker toggles all aquarium audio
and switches between sound waves and a muted X; a horizon icon opens
Classic, Blue water, Lagoon, Dusk, Night, and Black background choices.
Black leaves the reef and fish lit. Background and mute/unmute preferences are saved locally
when browser storage is available and restored when returning to the home page
or reloading, before audio starts. First-time visitors still start unmuted.
The picker uses labeled color swatches,
closes after a choice, and dismisses on Escape or an outside press. Icons stay white with no hover effect. The light slider and bottom controls are removed.

The perspective camera uses the reference's .9305-radian vertical field of view,
with source Z reflected for Three's coordinate system. The near and recessed
reef include their original caustic meshes and low-alpha shadow texture, scrolling
at .5 UV units per second. Body steering uses the signed bend pose independently
of the recovered 14-radian/second tail wave. The principal fins pivot with steering.

`motion.dat` is gzip-compressed 16-bit swimming data, with its index in
`motion.json`. The isolated original swimming routine was sampled at 60 Hz and
stored at 10 Hz; positions and orientations interpolate at display refresh rate.
The starting state and seed are reconstructed. Individual recordings loop after
several minutes at an offscreen point; the yellow tang uses a one-second blend
between nearby poses. Playback shortens near-stationary segments and limits tilt
to keep fish moving and upright. Because the independent loops no longer share
the original simulation's timing, the browser adds live avoidance: it looks .8 s
ahead and separates envelopes containing the animated body and fins in 3D.
Depth separation is preferred, with vertical/lateral sidesteps for head-on turns.
Both reef layers use masks built from their triangulated geometry and texture
alpha. Fish retain their side of visible coral until they reach open water;
turns too broad for the gap between layers sidestep around the coral. The
caustic overlays use separate stencil masks for the near and distant reef,
so their moving shadows cannot paint over fish in front of the coral.
This avoidance is reconstructed, rather than a port of the original logic.
The two bubble strands use the recovered quad
positions, depth, UVs, and separate scroll rates behind the near reef. Their
upper edges extend beyond the tallest viewport, preserving the original tilt
and UV density so narrowing the window never exposes a cutoff. Fish
lighting, the starfish pose, and the slow background brightness cycle still
include approximations.

To reproduce the model and texture conversions, extract the official installer
with `innoextract`, then run `scripts/convert-aquarium.py` with the extracted
`Aquarium.scr` path. The converter requires Python, Pillow, and pefile.
The converter does not execute the reference program. Audio was converted with
FFmpeg (`-codec:a libmp3lame -b:a 64k`).
`scripts/sample-aquarium-motion.py` reproduces the movement recording with pefile
and Unicorn. It verifies the reference SHA-256 before using version-specific
addresses and emulates only the swimming math in isolated memory. Windows,
graphics, licensing, installer, networking, and host-system calls are not run.
The browser downloads artwork and sampled data, not the Windows executable.

Browser checks cover animated rendering, reduced-motion changes, and the
static fallback, saved backgrounds, icon controls, default bubble audio, and glass-tap/mute behavior in
Chromium and WebKit, on desktop and narrow viewports. Calculation checks cover
long-running fish movement, collision clearance across 20 minutes and dense
overlapping starting poses, and the audio loop seam.
