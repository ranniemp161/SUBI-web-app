# 0003. Word boundary timestamp refinement — rationale

## Context

The editor already fixed one visible symptom of imprecise word timestamps (a trim boundary drag briefly showing a wider selection than what actually got cut). That fix corrected the symptom. The underlying cause is still present: every word's `start`/`end` comes straight from Deepgram's automatic speech recognition (ASR) output, which is a best guess, not a lab measured boundary. A leading consonant or trailing breath routinely shifts the true edge of a word by tens of milliseconds from what Deepgram reports. Any feature that cuts, trims, or highlights "exactly this word" (manual word cuts, Cut left/right, trim drag snap, the transcript's active word highlight, the auto rough cut's silence gap detection) inherits that imprecision.

Two constraints shape what is even possible here. First, the app's whole pitch is that video and audio never touch the server for processing beyond transcription itself; the extracted audio blob is deleted the moment Deepgram's callback returns (`api/transcribe/callback/route.ts`), so any server side refinement would need a new step inside that narrow window, with a new vendor seeing the raw audio. Second, the app already decodes the full audio waveform client side (`lib/waveform.ts`, via the `mediabunny` WebCodecs wrapper) to draw the timeline's waveform, at a resolution too coarse for word level precision (a fixed 4000 buckets across the whole clip, tens of milliseconds per bucket on a short video and much coarser on a long one), but the same decoding approach can be reused at a much finer, purpose built resolution.

The source video file itself is only available in the browser after the user reselects it in the studio (ADR 0004's reselect gated pipeline), which can happen long after transcription finished, or on a returning session for a project transcribed before this spec. That timing, not the transcription step itself, is when any client side refinement can actually run.

## Options considered

### Option 1: Client side energy threshold boundary snap

Reuse the app's existing `mediabunny`/WebCodecs decoding approach to compute a fine grained (about 5 millisecond buckets) audio energy envelope in one streaming pass over the reselected file, then for each word, search a small window (a few hundred milliseconds) around Deepgram's reported `start`/`end` for the nearest point the envelope crosses from silence into speech (or the reverse), and snap to it.

**Pros**:
- No new vendor, no new cost, no change to the app's "audio never leaves your device" story.
- Reuses a decoding approach the codebase already has proven working (`waveform.ts`).
- Simple, deterministic, and easy to unit test as pure functions, matching how `edl.ts`'s own boundary math is tested today.

**Cons**:
- Cruder than a trained model on noisy audio or a music bed under the voice; some words in a noisy recording may stay unrefined.
- A specific, known weakness of energy based detection generally (cross checked against the actual algorithm design): unvoiced consonants, fricatives, and breathy onsets are low energy even in a clean recording, so a word beginning with one of these sounds is more likely to refine late or fall back to its raw timestamp than a vowel led word. Partly mitigated by requiring a crossing to hold for a minimum duration (15ms) rather than triggering on one noisy sample, but not eliminated.
- Solves boundary refinement, not the harder "align arbitrary text to arbitrary audio from nothing" problem; not a fit if the product ever needs true from scratch alignment (e.g. aligning a manually rewritten caption to unrelated audio).

A VAD (voice activity detection) model such as Silero VAD (`@ricky0123/vad-web`) was also considered for this same client side role. It is more robust to noise than a plain energy threshold, but it is built for classifying live, streaming microphone input in real time, not batch refining short, already decoded PCM windows around a known approximate timestamp; adapting it to this use case would be real integration work, plus a new WebAssembly ONNX runtime dependency, for a problem a much simpler technique already fits. Left as a Follow-up if plain energy thresholding proves insufficient in practice.

### Option 2: Server side hosted forced alignment API (e.g. Rev.ai's alignment endpoint)

Call a purpose built forced alignment API (audio and transcript in, refined word timestamps out) from the existing transcription callback route, before the audio blob is deleted.

**Pros**:
- Purpose built for exactly this problem; likely higher precision, including on noisy audio, than a local heuristic.
- Inexpensive per minute by list pricing (research during this spec's design found Rev.ai's alignment endpoint listed around $0.003/minute).

**Cons**:
- A new third party vendor receives the raw audio, directly contradicting the app's own "video and audio never touch a server beyond transcription" pitch.
- A new step inside the transcription pipeline's critical path: another network call, another failure mode, another thing that can time out.
- Adds an ongoing per minute cost on top of today's unit economics; the actual latency for a typical clip was not confirmed during this spec's research and would need verifying before committing to it.

### Option 3: Self hosted open source forced aligner (Montreal Forced Aligner, WhisperX's alignment stage, or similar)

Run an open source aligner on a hosted inference endpoint (e.g. a dedicated Hugging Face Inference Endpoint) called from the transcription pipeline.

**Pros**:
- Highest achievable precision (Montreal Forced Aligner is documented at sub 20 millisecond phoneme level precision); no per request vendor lock in to one company's pricing.

**Cons**:
- Real new infrastructure for a team with none today: a hosted Python/ML inference endpoint, model deployment, cold starts, and someone who owns operating it.
- Same "audio leaves the device" concern as Option 2, just self operated instead of a vendor's.
- Overkill for the actual problem: the app already has decent word level timestamps from Deepgram; this option solves the harder from scratch alignment problem the app does not have.

## Rationale

The actual problem is narrower than "align text to audio from scratch": Deepgram already gives usable per word timestamps, just imprecise ones by tens of milliseconds. Local boundary refinement solves exactly that, and Option 1 is the only option that does not also introduce a new vendor with access to the user's raw audio, which would be a real regression against the app's own stated privacy posture (`AGENTS.md`: "Video never touches the server"). It also reuses a decoding approach (`mediabunny`/WebCodecs) already proven in this codebase, rather than adding a new dependency or a new hosted service to operate.

Options 2 and 3 would likely produce somewhat more precise timestamps, especially on noisy audio, and are worth revisiting if Option 1's accuracy proves insufficient in practice. But both cost real money per minute, add a new failure mode to the transcription pipeline's critical path, and (worse for this specific product) mean a third party service receiving the user's raw audio, which is the one thing this app has deliberately avoided since its first design decision (ADR 0001).

## References

**Project sources**:
- `AGENTS.md` (root and `apps/rough-cut/AGENTS.md`), the "video never touches the server" convention this decision preserves
- `apps/rough-cut/src/lib/waveform.ts`, the existing client side streaming decode pattern this spec reuses
- `apps/rough-cut/src/lib/edl.ts`, the existing pure-function, unit-tested boundary math convention this spec's algorithm follows
- spec [0002](../0002-transcript-timeline-live-sync/index.md), the transcript/timeline sync work whose boundary drift bug motivated this spec
- ADR `0004-reselect-gated-pipeline` (`docs/adr/rough-cut/`), the reselect timing constraint this spec's trigger design depends on

**Practices & standards**:
- Energy threshold onset detection, a standard, dependency free signal processing technique for finding a speech/silence boundary in a short audio window

**Links** (web verified during this spec's design; treat pricing/availability as of 2026-07-21, verify again before committing):
- Rev.ai forced alignment API: https://docs.rev.ai/api/alignment/
- AssemblyAI pricing (word-level timestamps included by default): https://www.assemblyai.com/pricing
- Montreal Forced Aligner: https://montrealcorpustools.github.io/Montreal-Forced-Aligner/
- WhisperX (wav2vec2 alignment stage): https://github.com/m-bain/whisperX
- `@ricky0123/vad-web` (Silero VAD via WebAssembly, considered and set aside above): https://www.npmjs.com/package/@ricky0123/vad-web
- Mediabunny (already in use in this app): https://mediabunny.dev/
