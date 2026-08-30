# Verify: the clip's visual language · spec 0009 · written 2026-08-18

_Steps derived from spec 0009 acceptance criteria. `/check verify` runs these;
`/test` locks the durable ones._

**This sheet matters more than usual.** Every acceptance criterion in this spec
is a structural proxy, because no test can say whether a frame looks produced.
The suite protects against regression; this sheet is where the design is actually
judged. Phase 0 deferred that judgement "to a real timeline" and this is the
first sitting that closes it.

**Nothing here spends money or calls a vendor.** Rendering is free by design, and
no step re plans. Run project `0620` on the dev branch (`ep-holy-hall-aoe13azt`),
which is what `apps/broll/.env.local` points at. Have a project with at least one
chart scene, one text card, one character scene and one object scene, in both
landscape and portrait.

**Watch exports, not previews.** The preview and the encoder share one renderer,
but the encoder is the thing a creator publishes, and H.264 is where fine detail
dies. Every step below that says "watch" means open the exported MP4 at full
size, not the canvas in the studio.

## The judgement, first

Do this before the criterion by criterion steps, while the clips are new to you.

- [ ] Render a batch of at least eight scenes covering every template. Watch them
      back to back at full size, once, without pausing.
- [ ] Answer honestly: does this read as produced, or as generated? Phase 0 asked
      the same question as "broadcast or slideshow". If the answer is still
      slideshow, the rest of this sheet passing does not matter, and the finding
      belongs in a follow up rather than in a tick.
- [ ] Watch one clip immediately after a clip exported before this work. The
      spec's stated negative consequence is that the two generations look
      different in one edit. Confirm how bad that actually is.

## Motion

- [ ] Watch any clip's last second → it holds a settled composition. Nothing
      fades, slides or shrinks away at the end → AC-175
- [ ] Watch a 4 second clip and a 10 second clip of the same template back to
      back → both finish at visibly the same scale. Neither drifts noticeably
      further in than the other → AC-177
- [ ] Watch any clip for its whole length → there is a slow push in. It should be
      almost impossible to notice while watching and obvious if you compare the
      first and last frames → AC-176
- [ ] Compare the first and last frame of a clip from each of the built templates
      → every one has pushed. None is static → AC-176
- [ ] Watch a character or object clip's opening → the figure arrives, slightly
      overshoots, and settles. It should read as weight, not as a bounce → AC-174
- [ ] Watch a chart clip's opening → bars and values do **not** overshoot. A
      number that springs reads as decorative → AC-174
- [ ] Watch a bar chart's opening frame by frame if needed → bars arrive one
      after another, left to right, in the order the values appear. The largest is
      not promoted to last → AC-180
- [ ] Turn on the operating system's reduce motion setting, reload the studio,
      hover a row → the preview does not autoplay. Then export that scene → the
      exported file still animates fully → AC-179

## Chart

- [ ] Watch a bar chart → a hairline rule sits under the bars, and there are
      **no** horizontal value lines anywhere. The only grid visible is the
      backdrop → AC-181
- [ ] Freeze on a settled bar chart frame → bars are rounded at the top and
      square where they meet the baseline. Look for banding across the yellow: it
      should be flat and clean → AC-182
- [ ] Find or force a chart the planner typed as pie or donut → it draws as a
      donut with visible gaps between slices, and the hole holds a number. Check
      that number appears in the scene's own values in Scene Studio. **If it is a
      sum of them, that is a failure, not a rounding difference** → AC-183
- [ ] Same donut, with a long value in the hole → the figure fits inside the hole
      rather than overrunning the arc. The hole's type is sized to the hole, not
      to the frame → AC-183
- [ ] Same donut, with two slices of nearly equal size → the gaps between slices
      are still visible and the proportion still reads true → AC-183
- [ ] Find or force a line chart → straight segments with a dot at each value. No
      fill under the line, and no curve between points → AC-184
- [ ] Force a scene whose value is seven digits or more → it renders compact
      (`1.2M`), it stays inside the frame, and its unit is still attached → AC-185
- [ ] Set a very long chart title, 200 characters or so → it wraps to at most two
      lines and trims with an ellipsis. No part of it leaves the frame → AC-186
- [ ] Watch a single big number scene → it counts up, and its unit is smaller and
      dimmer than the figure. Check a prefix unit (a currency mark) and a suffix
      unit (a percent) both sit correctly, since one formatter decides both
      → AC-187
- [ ] Look at a bar or line value label in the same batch → the unit there is
      **not** shrunk. Only the big number splits the two → AC-187
- [ ] Watch every clip in the batch → none carries a citation, a source line, an
      attribution or a timecode burned into the frame → AC-188

## Text

- [ ] Type `we built a *castle* here` into a scene's on screen text → the word
      castle renders in Key Yellow, and no asterisk appears on the frame → AC-189
- [ ] Type text containing a figure nobody said, for example `it was 94%`, with
      no asterisks → **nothing is highlighted**. The renderer must never pick a
      word on its own → AC-190
- [ ] Type an unmatched asterisk, `a *castle` → the asterisk renders as a literal
      asterisk, nothing is emphasised, and no character is eaten. This is the
      parser's failure case → AC-189
- [ ] Type text long enough to wrap with an emphasised word near a line break →
      the emphasis stays on the right word across the break, and the line spacing
      is unchanged. This is the run aware wrapping working → AC-189
- [ ] Set text where the last line would be one short word, and the line above
      already ends in a long word → the orphan is **kept** rather than forced up
      into an overflow → AC-192
- [ ] Look at a text card of all capitals → the block sits optically centred, not
      slightly low → AC-191
- [ ] Set text that would wrap with one short word left over on the last line →
      a word is pulled down from the line above instead → AC-192
- [ ] Watch a character centre clip with text over the figure → the scrim fades
      out with no visible horizontal edge across the creator's body → AC-193

## Depth

- [ ] Freeze on any frame → the backdrop grid is present near the centre and
      fades toward the edges. It should not stop abruptly → AC-194
- [ ] Freeze on a character clip with a dark cutout → the figure separates from
      the black ground. Look specifically at hair and shoulder edges → AC-195
- [ ] Look for banding in the glow and the grid fade at full size → both sit on
      dark ground and should be clean. Banding here is the one thing the flat fill
      decision was protecting against elsewhere → AC-194, AC-195

## The vertical frame

- [ ] Switch the project to vertical, render one clip per template, and watch
      each → no **text or chart mark** enters the bottom margin or the right
      margin → AC-196
- [ ] Watch a vertical character clip specifically → the figure **does** still
      reach the bottom edge, and that is correct. Figures are deliberately exempt,
      because a caption bar over shins is cosmetic and a caption bar over a word
      is not. If the figure has been inset too, the rule was applied too widely
      → AC-196
- [ ] Open a vertical clip in the studio → a faint guide shows the reserved
      areas → AC-197
- [ ] Export that same clip and step through it → **the guide is not in the
      file**, on any frame → AC-197
- [ ] Optional but worth it: put a vertical clip into a phone preview, or overlay
      a screenshot of a Reels or TikTok interface → the reserved areas match where
      the chrome actually sits. These figures are the only ones in this spec that
      come from outside the repo → AC-196

## Cost

- [ ] Time a single 6 second 1080p30 render, from pressing render to the file
      landing. Compare against Phase 0's 1791ms → AC-198
- [ ] Render a twelve scene batch and time the whole thing. If a batch has gone
      past about a minute, the ceiling has been breached and the follow up about
      measuring after slice 3 was not acted on → AC-198
- [ ] Note the machine you measured on. Phase 0's figure has no hardware recorded
      beside it, which is a gap worth not repeating.

## Automated

These are the structural proxies and belong in the suite rather than here. Listed
so `/test` knows what to lock, and so a reader understands why this sheet exists.

- [ ] No template module exports or defines an easing function → AC-173
- [ ] `drawRenderable` receives `durationMs`, and the still, the preview and the
      worker all pass it → AC-178
- [ ] Two frames drawn at the same elapsed time and duration are identical, so
      drawing stays pure after the central push → AC-176
- [ ] Draw calls in a portrait frame all sit outside the reserved insets → AC-196

---

## What is actually built, as of 2026-08-18

Added by `/develop` after slices 1 to 4 landed (PR #153). The sheet above covers
the whole spec; this section says which of it can be run today, and which steps
would be checking something nobody has written yet.

**Runnable now** — motion, depth, and every chart mark. Slices 1, 2, 3 and 4.

**Not built yet, so skip rather than fail them:** anything about text setting or
optical centring (AC-191 to AC-193), creator marked emphasis and the asterisk
syntax (AC-189, AC-190), and the portrait safe area with its studio guide
(AC-196, AC-197). Those are slices 6 to 8 and are deliberately held until the
cost measurement below has been run.

### Run this one first

- [ ] **The cost gate.** Time a 6 second 1080p30 render against Phase 0's 1791ms
      → AC-198. **Everything else in this section is finished work; this is the
      step that decides whether the next three slices start.** What was added per
      frame: two radial gradients (the grid fade, plus the figure glow on the
      four figure templates), `roundRect` per bar instead of `fillRect`, one
      extra arc per donut slice, and one text measurement pass for the title.
      There is no `shadowBlur` anywhere, which was the operation expected to
      breach the ceiling. Record the machine.

### Motion, watched at full size

- [ ] Play any scene in Scene Studio and watch the whole clip. The frame should
      drift very slightly larger across its length and never appear to zoom
      → AC-176, AC-177
- [ ] Render one 4 second clip and one 10 second clip of the same scene. Step to
      the last frame of each: the composition should be at the same scale in
      both, not further pushed in the longer one → AC-177
- [ ] Step to the very last frame of any exported clip. It should be the settled
      composition, held. No fade, no drift out, nothing leaving the frame
      → AC-175
- [ ] Watch a `character-left` or `object-left` scene enter. The figure should
      go a touch past where it lands and settle back. If it reads as bouncy the
      overshoot is too high; if you cannot see it at all it is doing nothing
      → AC-174
- [ ] Watch a `chart-full` bar scene enter. The bars should arrive one after
      another left to right, and **in the order the values were spoken** — check
      against the scene's cited line, not against their heights → AC-180
- [ ] Turn the machine's reduce motion setting **on**. The on page preview should
      stop auto playing; the exported file must still animate. Export one and
      watch it outside the browser → AC-179

### Depth

- [ ] Look at the backdrop grid at the centre of the frame and then at a corner.
      It should be plainly there in the middle and gone by the corners, with no
      visible ring where it changes → AC-194
- [ ] Do the same on a portrait clip. The fade should still reach the corners
      rather than dying early → AC-194
- [ ] Look behind a character cutout, especially one with dark hair against the
      ground. There should be a soft pool of light separating them, with no
      visible edge to it and no outline tracing the cutout → AC-195
- [ ] Export a clip with a figure and scrub it in an NLE at full size. The glow
      is the thing most likely to band on an 8 bit encode; look for stepped rings
      rather than a smooth falloff → AC-195, AC-198

### Chart marks

- [ ] A bar chart: bars rounded at the top, square where they meet the baseline,
      flat fill with no gradient → AC-182
- [ ] One horizontal rule under the marks and **no** other horizontal lines
      across the plot → AC-181
- [ ] A donut scene: slices visibly separated, a real hole, and the number in the
      hole is one of the values on the chart. **Add up the values and confirm the
      hole is not showing that sum** → AC-183
- [ ] A line scene: a dot on every measured point, straight segments between
      them, no fill under the line, no curve → AC-184
- [ ] A scene whose chart title is long. It should wrap to two lines and end in
      an ellipsis, entirely inside the frame → AC-186
- [ ] A single big number scene: the number counts up, and its unit is set
      smaller and in the grey rather than at the same size and weight → AC-187
- [ ] Confirm no clip has a citation, an attribution or a timecode burned into
      the frame anywhere → AC-188

### Value sourcing, one step per row

Each of these varies an input and checks the output moves with it, which is what
catches a value read from the wrong place even when the frame looks right.

- [ ] **Push scale ← the clip's duration.** Change one scene's duration in Scene
      Studio and re render. The last frame's scale should be unchanged; only the
      rate of the push moves → AC-177
- [ ] **Bar stagger ← the value's index.** Reorder is not editable, so check the
      opposite: a chart whose largest value is last must still arrive last
      → AC-180
- [ ] **Donut hole ← the largest traced value.** Find a donut scene and confirm
      the hole matches the largest single value, including when that value is not
      the first slice → AC-183
- [ ] **Compact threshold ← seven digits.** A chart with a value of 999,999
      should read in full; 1,240,000 should read `1.2M`. Both must keep their
      unit → AC-185
- [ ] **Grid fade and glow ← the short edge and the half diagonal.** Switch a
      project between 16:9 and 9:16 and confirm neither the grid density nor the
      glow size jumps → AC-194, AC-195
