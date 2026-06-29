# Rough Cut — Technical Specification

## What This Is

A web-based video editing app that automates rough cut editing. Users upload a raw video, the app transcribes it, detects silence and retakes, proposes cuts, and lets the user adjust everything through a text-based editor — like editing a document instead of dragging clips on a timeline. When they're happy, the app renders the final MP4 directly in their browser. The video never leaves their machine.

Think of it as a simplified Gling AI or Descript, focused purely on A-roll rough cut editing.

---

## Core Architecture: Local-First

This app does **not** use cloud storage or cloud rendering. The user's browser does all the heavy lifting.

### What runs in the cloud (your infrastructure)

- The web application itself (HTML, CSS, JavaScript)
- User authentication and accounts
- A database for user data and saved transcripts
- A proxy endpoint that sends audio to Deepgram and returns the transcript

### What runs on the user's machine (their browser)

- Reading the video file from their hard drive
- Extracting the audio track
- Playing video preview during editing
- All frame-by-frame video processing during export
- Encoding the final MP4
- Saving the result to their Downloads folder

### What this means

The video file is never uploaded to any server. The only data that crosses the internet is the extracted audio track (~100 MB for 60 minutes of footage), which is sent to Deepgram for transcription. Everything else — preview, editing, rendering, export — happens locally in the browser using the WebCodecs API.

---

## Tech Stack

### Next.js (App Router, TypeScript)

**What it is:** A React-based framework for building full-stack web applications.

**What it does in this app:**

- Serves the marketing/landing pages (SSR for SEO)
- Serves the editor UI (client-side React app)
- Provides API routes that handle auth checks, database queries, and proxying audio to Deepgram
- Handles environment variables and secrets (Deepgram API key, Clerk keys, database URL)

**Where it runs:** Deployed on Railway. Railway auto-detects Next.js from the repo, builds it, and serves it. No Docker or manual server config needed.

**Why this and not something else:** Next.js gives SSR for marketing pages and a rich client-side React experience for the editor in one framework. The App Router supports server components, API routes, and middleware — all needed here. TypeScript is used end-to-end for type safety.

---

### Tailwind CSS

**What it is:** A utility-first CSS framework.

**What it does in this app:** All styling — layout, colors, typography, responsive design, dark mode.

**Where it runs:** Compiles at build time into regular CSS. Ships to the user's browser.

**Why this:** Pairs naturally with React components. Fast to iterate on UI. No separate CSS files to manage.

---

### Clerk

**What it is:** A managed authentication service.

**What it does in this app:**

- Signup and login (email/password, Google OAuth)
- Session management (JWT tokens, automatic refresh)
- Protects API routes and editor pages — only authenticated users can access the app
- Provides React components (`<SignIn />`, `<SignUp />`, `<UserButton />`) that drop into the UI
- Provides a Next.js middleware that checks auth on every request

**Where it runs:** Clerk's cloud. You configure it via their dashboard and environment variables.

**Cost:** Free for the first 10,000 monthly active users. After that, ~$0.02 per user.

---

### Access Code Gate (Skool Community Integration)

**What it is:** A simple code-based access control layer on top of Clerk.

**How it works:**

1. You post a secret access code inside your Skool community (only members can see it)
2. The signup page on your app has an "Access Code" field alongside the normal signup form
3. When someone signs up, the API checks the code before creating the account
4. If the code is wrong, signup is rejected
5. You can rotate the code from an admin page whenever you want

**Why not a direct Skool integration:** Skool has no official first-party API and no OAuth support. There is no "Login with Skool" option. The access code approach is the simplest reliable method. A Zapier-based auto-sync can be added later if needed.

**Implementation:** This is just a string comparison in the signup API route. The access code is stored as an environment variable on Railway.

---

### PostgreSQL

**What it is:** A relational database.

**What it stores:**

- User accounts (linked to Clerk user IDs)
- Saved transcripts (the JSON from Deepgram, so users don't have to re-transcribe)
- Project metadata (file name, duration, creation date, transcript reference)
- Edit state / EDL (the user's cut decisions, stored as JSON so they can return later)

**What it does NOT store:** Video files, audio files, rendered outputs — none of these ever touch the server.

**Where it runs:** Railway managed Postgres, or Neon (serverless Postgres with a generous free tier).

**Schema overview:**

```
users
  id            UUID (primary key)
  clerk_id      TEXT (from Clerk)
  email         TEXT
  created_at    TIMESTAMP

projects
  id            UUID (primary key)
  user_id       UUID (foreign key → users)
  file_name     TEXT (original file name, for display only)
  duration_ms   INTEGER (source duration in milliseconds)
  transcript    JSONB (Deepgram response — word-level timestamps)
  edl           JSONB (cut decisions — kept/removed segments with timestamps)
  created_at    TIMESTAMP
  updated_at    TIMESTAMP
```

The `edl` field is the critical one. It stores the user's edit state as a JSON array of segments:

```json
{
  "segments": [
    { "start": 0.000, "end": 4.521, "status": "keep", "reason": null },
    { "start": 4.521, "end": 6.890, "status": "cut", "reason": "silence" },
    { "start": 6.890, "end": 15.234, "status": "keep", "reason": null },
    { "start": 15.234, "end": 18.100, "status": "cut", "reason": "retake" },
    { "start": 18.100, "end": 42.500, "status": "keep", "reason": null }
  ]
}
```

This EDL is what the editor UI reads and writes, and what the WebCodecs renderer consumes during export.

---

### Deepgram Nova-3 (Batch API)

**What it is:** A speech-to-text cloud API that returns word-level timestamps.

**What it does in this app:**

1. The browser extracts the audio track from the video file (locally, using libav.js / WebAssembly FFmpeg)
2. The audio (~100 MB for 60 min) is uploaded to your Next.js API route
3. Your API route forwards it to Deepgram's batch transcription endpoint
4. Deepgram returns a JSON response with every word, its start time, end time, and confidence score
5. Your API route saves the transcript to Postgres and returns it to the browser

**What the response looks like:**

```json
{
  "words": [
    { "word": "Africa", "start": 0.42, "end": 0.89, "confidence": 0.98 },
    { "word": "needs", "start": 0.91, "end": 1.15, "confidence": 0.97 },
    { "word": "to", "start": 1.16, "end": 1.22, "confidence": 0.99 },
    { "word": "wake", "start": 1.24, "end": 1.51, "confidence": 0.96 },
    { "word": "up", "start": 1.52, "end": 1.68, "confidence": 0.95 }
  ]
}
```

These timestamps are what connect the transcript text to the video timeline. When a user clicks a word, the video seeks to that word's start time. When they delete a word, the segment between that word's start and end is marked as "cut" in the EDL.

**Cost:** $0.0043 per minute of audio (batch mode). A 60-minute file costs ~$0.26.

**API key:** Stored as an environment variable on Railway. Never exposed to the browser — the API route proxies the request.

---

### WebCodecs API + Web Workers

**What it is:** A browser-native API (built into Chrome and Edge) that gives JavaScript direct access to hardware video decoders and encoders.

**What it does in this app:** This is the rendering engine. When the user clicks "Export," WebCodecs:

1. Reads the source video file from the user's hard drive
2. Demuxes the container (separates video and audio streams) using mp4box.js or libav.js
3. Decodes only the video frames that belong to "keep" segments in the EDL
4. Encodes those frames into H.264
5. Separately processes the audio for kept segments
6. Muxes video + audio back into an MP4 container
7. Triggers a browser download — the finished file saves to the user's Downloads folder

**Why Web Workers:** The rendering runs in a Web Worker (a background thread). This keeps the main browser UI responsive — the user sees a progress bar, can interact with the page, and the render chugs along in the background. Without a Worker, the browser would freeze during rendering.

**Browser support:** Chrome 94+ and Edge 94+ fully support WebCodecs. Safari and Firefox have partial or no support. For v1, require Chrome or Edge. Show a browser compatibility message for unsupported browsers.

**Key libraries needed:**

- `mp4box.js` — for demuxing MP4/MOV containers (separating video/audio streams without decoding)
- `libav.js` — WebAssembly port of FFmpeg, used as a fallback for formats mp4box can't handle, and for audio processing
- `fix-webm-duration` or `mux.js` — for muxing the final output container

**Limitations to design around:**

- No built-in muxing/demuxing in WebCodecs — you need the libraries above
- Audio WebCodecs support is inconsistent across browsers — may need libav.js fallback for audio
- Large files (30+ GB) may hit browser memory limits — show a warning for very large files
- The browser tab must stay open during rendering — show a clear "keep this tab open" message
- Different source formats (iPhone, Android, DSLR, screen recording) use different codecs — test broadly

---

## User Flow (Step by Step)

### 1. Landing Page
User visits the app URL. Sees marketing page explaining what the app does. Clicks "Get Started."

### 2. Signup
Clerk signup form appears. User enters email, password, and access code (from Skool community). If the access code matches, account is created. If not, rejected with an error message.

### 3. Dashboard
User sees a simple dashboard with a "New Project" button and a list of previous projects (if any).

### 4. File Selection
User clicks "New Project." A file picker dialog opens (browser-native `<input type="file">`). They select their raw video file from their hard drive. The file is NOT uploaded anywhere — the browser gets read access to it on disk.

### 5. Audio Extraction + Transcription
The browser extracts the audio track from the video file using libav.js (runs locally in WebAssembly). The extracted audio (~100 MB for 60 min) is sent to the Next.js API route, which forwards it to Deepgram. This is the only moment data leaves the user's machine. Deepgram returns the word-level transcript in ~1-2 minutes.

### 6. Analysis
The app analyzes the transcript to propose cuts:

- **Silence detection:** gaps between words longer than 2 seconds are marked as dead air
- **Retake detection:** repeated phrases/sentences are identified — the final complete take is kept, earlier attempts are marked for cutting
- **Production direction detection:** phrases like "insert infographic here" or "cut to B-roll" are flagged as direction markers, not speech content

This analysis runs in the browser (JavaScript). The result is the initial EDL — a list of segments marked as "keep" or "cut" with reasons.

### 7. Editing
The editor view has three main areas:

**Transcript panel (left):** The full transcript displayed as text. Cut words/sentences have strikethrough styling. The user can:
- Click a word to seek the video to that timestamp
- Select words and press Delete to cut them
- Click on a cut (strikethrough) section to restore it
- Drag the cut boundary handles to adjust where a cut starts/ends

**Video preview (top right):** A standard video player showing the source file. When playing, it automatically skips over cut segments — so the user hears the rough cut in real time without rendering. Playback is driven by the EDL: play a "keep" segment, seek past the next "cut" segment, play the next "keep" segment, and so on.

**Timeline / stats bar (bottom):** Shows original duration vs. cut duration. A minimap-style bar showing keep (colored) and cut (gray) segments. Summary stats: "Removed 12 minutes of silence, 3 retakes."

**Key editing interactions:**
- `Space` — play/pause
- `J/K/L` — rewind/pause/forward (standard NLE shortcuts)
- `Delete` — cut selected words
- `Cmd+Z` / `Ctrl+Z` — undo
- `Cmd+Shift+Z` / `Ctrl+Shift+Z` — redo

Every edit updates the EDL in state. The EDL is auto-saved (debounced) to Postgres via an API call, so the user can close the tab and return later without losing work.

### 8. Export
User clicks "Export." A modal appears:

- Shows estimated render time
- Displays "Keep this tab open during export"
- Progress bar updates as frames are processed

The WebCodecs pipeline runs in a Web Worker:
1. Reads source file from disk
2. Decodes kept segments frame by frame
3. Encodes to H.264 MP4
4. On completion, triggers a browser file download

The finished MP4 saves to the user's Downloads folder. The original file is untouched.

### 9. Done
User can start a new project, return to edit this one later (transcript and EDL are saved), or close the app.

---

## API Routes

```
POST   /api/auth/verify-code     — checks access code during signup
POST   /api/projects              — creates a new project record
GET    /api/projects              — lists user's projects
GET    /api/projects/:id          — gets project details + transcript + EDL
PATCH  /api/projects/:id          — updates EDL (auto-save from editor)
DELETE /api/projects/:id          — deletes project record
POST   /api/transcribe            — receives audio, sends to Deepgram, saves transcript
```

All routes are protected by Clerk middleware — only authenticated users can access them.

The `/api/transcribe` route is the only one that handles substantial data (the audio file). All other routes handle small JSON payloads.

---

## Deployment

### Railway Setup

The entire app is a single Next.js project deployed on Railway:

1. Connect your GitHub repo to Railway
2. Railway auto-detects Next.js, builds, and deploys
3. Add environment variables:
   - `CLERK_SECRET_KEY` — from Clerk dashboard
   - `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` — from Clerk dashboard
   - `DATABASE_URL` — Railway provides this when you add Postgres
   - `DEEPGRAM_API_KEY` — from Deepgram dashboard
   - `ACCESS_CODE` — the secret code you post in Skool
4. Add a Postgres database from Railway's dashboard (one click)
5. Set up a custom domain if needed

No Docker. No Dockerfile. No docker-compose. No CI/CD config. Railway handles the build pipeline from the GitHub push.

### Environment Variables

```
# Clerk
CLERK_SECRET_KEY=sk_live_...
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_...

# Database
DATABASE_URL=postgresql://user:pass@host:5432/dbname

# Deepgram
DEEPGRAM_API_KEY=...

# Access control
ACCESS_CODE=SKOOL2026
```

---

## Cost Model

### Fixed monthly costs

| Item | Cost |
|------|------|
| Railway (Next.js + Postgres) | ~$25–40/month |
| Clerk (under 10k users) | $0 |
| Domain name | ~$1/month |
| **Total fixed** | **~$25–40/month** |

### Variable costs (per user session)

| Item | Cost |
|------|------|
| Deepgram transcription (60 min audio) | ~$0.26 |
| Cloud storage | $0 (no cloud storage) |
| Cloud rendering | $0 (renders in browser) |
| Bandwidth / egress | $0 (video never uploaded) |
| **Total per session** | **~$0.26** |

### What the user's machine contributes (at no cost to you)

- CPU time for rendering (~15–25 min per 60 min of source footage)
- Disk I/O for reading source and writing output
- RAM for holding decoded frames during rendering
- GPU acceleration for H.264 encode/decode (if available via WebCodecs)

---

## Build Phases

### Phase 1 — Foundation (Week 1)
- Next.js project setup with App Router and TypeScript
- Clerk integration (signup, login, protected routes)
- Access code gate on signup
- Postgres schema and basic project CRUD
- Landing page
- File picker (browser-native, no upload)

### Phase 2 — Transcription Pipeline (Week 2)
- Audio extraction in the browser using libav.js
- API route that proxies audio to Deepgram
- Transcript storage in Postgres
- Basic transcript display (plain text with timestamps)

### Phase 3 — Editor Core (Weeks 3–5)
- Transcript panel with clickable words (click to seek)
- Video preview player synced to transcript
- Silence detection algorithm (2s+ gaps = dead air)
- Retake detection algorithm (repeated phrases, keep final take)
- Initial EDL generation from analysis
- Cut/restore interactions on transcript text
- Strikethrough styling for cut segments
- Auto-save EDL to Postgres (debounced)
- Undo/redo stack

### Phase 4 — Cut Preview Playback (Week 6)
- Custom playback controller that skips cut segments
- Smooth seeking across cut boundaries
- Audio continuity during skip playback (no pops/clicks)
- Duration display (original vs. cut)
- Timeline minimap showing keep/cut segments

### Phase 5 — WebCodecs Render Pipeline (Weeks 7–9)
- Web Worker setup for background rendering
- Source file demuxing via mp4box.js
- Video frame decoding (kept segments only)
- H.264 encoding via VideoEncoder
- Audio processing for kept segments (via libav.js)
- Muxing video + audio into final MP4
- Progress reporting from Worker to main thread
- File download trigger on completion
- Error handling and cancellation
- beforeunload warning during active render

### Phase 6 — Polish (Week 10)
- Keyboard shortcuts (Space, J/K/L, Delete, Cmd+Z)
- Drag handles on cut boundaries for fine adjustment
- Browser compatibility check (show warning for non-Chromium)
- Responsive layout adjustments
- Error states and loading states throughout
- Onboarding flow for first-time users
- Testing with diverse source formats (iPhone, Android, DSLR, screen recordings)

---

## Future Enhancements (Not in v1)

These are features that can be added later without changing the core architecture:

- **Cloud rendering (premium feature):** Add Hetzner + R2 for users who want to close their laptop during export. Requires adding a job queue and render worker service.
- **Zapier integration for Skool:** Auto-sync member list instead of using access codes. Adds/removes access automatically when someone joins or leaves the Skool community.
- **Multi-track editing:** Support B-roll overlay, not just A-roll cutting.
- **Caption/subtitle export:** Generate SRT/VTT files from the transcript with cut-adjusted timestamps.
- **Batch processing:** Queue multiple files for sequential rendering.
- **Mobile support:** Currently desktop-only (Chrome/Edge). Mobile browsers lack WebCodecs support.

---

## Key Technical Risks

1. **WebCodecs browser support.** Only Chrome and Edge fully support it. Safari and Firefox users cannot use the export feature. Mitigation: require Chrome/Edge, show a clear browser check on load.

2. **Source format variety.** Users will upload iPhone videos (HEVC/MOV), Android videos (H.264/MP4), DSLR footage (various), and screen recordings (VP9/WebM). Each has different codecs, container formats, frame rates, and color spaces. Mitigation: test extensively; use libav.js as a fallback demuxer for formats mp4box.js can't handle.

3. **Large file handling.** 10 GB files are common for raw footage. Browser memory limits may cause issues during rendering. Mitigation: process frames in small batches, use streaming patterns, and show file size warnings above 20 GB.

4. **Audio sync.** When cutting and re-encoding, audio and video can drift apart — especially with variable frame rate sources. Mitigation: use timestamp-based sync rather than frame counting; normalize VFR to CFR during decode.

5. **Tab closure during render.** If the user closes the tab, the render is lost. Mitigation: beforeunload warning, clear messaging, and potentially a resume-from-checkpoint system in v2.

---

## What This App is NOT

- It is NOT a full NLE (no multi-track, no effects, no transitions, no color grading)
- It is NOT a cloud storage service (your servers never hold video files)
- It is NOT a cloud rendering service in v1 (the user's machine does all processing)
- It is NOT cross-browser compatible in v1 (Chrome/Edge only for export)
- It is NOT a mobile app (desktop browsers only)

It is a focused tool that does one thing well: turns raw footage into a clean rough cut by removing silence, retakes, and dead air, using the user's own hardware for processing.
