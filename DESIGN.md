# A soundtrack for the moment

Vibe Check is a dark music workbench. The upload and recommendation flow stays central. The visual reference is a fan of physical music sleeves in perspective, with warm light against a deep olive and charcoal ground.

## Palette and typography

Use charcoal `#131410` for the page, `#1c1e18` for the upload surface, warm white `#f4f0e7` for primary text, and olive-tinted `#b5b7a7` for secondary text. Dividers use `#36392e`. Primary actions use burnt orange `#e58b60` with dark text. Ember `#ed966c` carries small accents. Ambient olive and ember gradients stay bounded behind the centered upload area or the sleeve stage.

Manrope is self-hosted through `next/font/google`. Headings use medium weight, a compact line height, and tracking no tighter than `-0.04em`. Body text has generous leading. Numeric comparisons use tabular figures. No eyebrow above headings or gradient text.

## Composition

The initial workbench centers the headline and compact upload panel under a subtle ember light. Empty, preparing, and invalid photo states have no CD buttons, decorative discs, or reserved stage space. A prepared photo expands the desktop composition into copy and actions on the left and a photo CD on the right. Motion position transitions move the existing controls into place. On mobile, photo controls follow the headline so users can start within the first screen. The centered sleeve stage follows the controls, with space above its caption. Upload and camera controls share a row. Find my song spans the full control panel width. The privacy note sits directly underneath. Spotify connection remains available in the header, and the footer stays quiet.

The sleeve stage is the single expressive feature. Jewel-case edges, offset shadows, perspective, original typographic artwork, and local warm light create depth. The selected photo is always the front CD at rest. Finding a song or displaying recommendations adds no CDs. A song CD appears behind the photo only after Spotify confirms its queue request. Pending requests, failures, and unverified candidates add nothing. Each song uses the verified track title and artist over an original gradient. These are labeled as original track lettering, with no album cover claim.

The stack derives from the current recommendation and existing queue states. Its visual identity is the request ID plus song ID, deduplicated to one CD per key. Comparison selection and disconnecting Spotify leave the stack intact. Choosing another photo or resetting removes the stage immediately, and responses for older requests cannot add CDs to the new photo. There is no separate history or persistence. One to eight queued songs occupy the existing rear fan bounds, from left 112 to 276 pixels, top 119 to 24 pixels, and angle -25 to -13 degrees. The photo stays in front when interaction ends.

Results use the same dark surfaces. The actual winner and Spotify player lead into an open decision workbench. A six-axis radar compares the photo with the selected song on one 0–10 scale. Solid ember lines and circles identify the photo. Dashed sage `#b6c5a0` lines and diamonds identify the song. Every axis shows both numeric values. The eight server-ranked candidates sit alongside the radar with horizontal similarity bars. A winner label identifies the server-selected song independently of the comparison selection. Choosing a candidate updates the radar and precise comparison without changing the queue.

The overview uses one coordinated composition with dividers and generous gutters. It does not wrap every chart in a card. Below the radar, a segmented strip shows the six normalized parameter weights. Muted ember, olive, sand, slate green, blue gray, and mauve connect each segment to its numeric legend. The original weight reason stays visible. Two columns of paired tracks show all six photo meters, song markers, endpoints, evidence, absolute gaps, and weighted match points lost. Mobile stacks the radar, weights, ranking, and precise rows with readable labels.

The raw numeric comparison and scoring formula sit in the lower How we decided disclosure. It opens by default at widths of at least 768 pixels and starts closed on mobile. The main charts remain visible at every width. Scores and ranking always come from the recommendation. Derived match points lost equal 10 × normalized weight × absolute gap. Display rounding never changes ranking. Mood values are Gemma estimates, and similarity percentages do not represent confidence or measured audio.

## Motion and interaction

The sleeve fan is the focal interaction. The prepared photo fades into place, and confirmed queued CDs animate behind it using their actual identities. Each sleeve is a native button with a stable hit area. Hover or keyboard focus raises its artwork by 52 pixels, straightens it slightly, and changes its specular reflection. The active sleeve temporarily rises above the stack; inspection alone does not change its resting order. Placement, whole-fan pointer tilt, and individual lift use separate wrappers so transforms compose. Fine pointers tilt the fan by at most four degrees in each direction through MotionValues and bounded springs. Pointer movement does not update React state. Leaving the stage resets the tilt. Clicking, tapping, Enter, or Space inspects a sleeve and updates the caption and pressed state without changing the recommendation or queue.

Touch allows vertical scrolling and inspection without cursor tilt. Reduced motion removes lift, tilt, and spatial transitions for the workbench, CD assembly, and charts. Borders, color, captions, and pressed states still communicate interaction. The stage unmounts before revoked photo URLs can linger in an exit animation. Photo preparation, loading, and result transitions use brief fades and optional blur. Chart changes take about 220 milliseconds and can be interrupted by another selection. There are no repeating animations. `MotionConfig` follows the user's reduced-motion preference, and CSS disables decorative transitions under the same preference.

Every control has a visible keyboard focus ring. Selected candidates expose `aria-pressed`. Mood meters retain labels and numeric values. Errors and loading updates keep their live regions. Preserve existing photo, recommendation, cancellation, queueing, and object URL lifecycle behavior.

A confirmed song CD remains visible if the user queues that song again. The existing queue entry retains that confirmation during pending or failed repeat requests. No new CD appears for a repeat.
