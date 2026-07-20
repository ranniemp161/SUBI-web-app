// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import TranscriptPanel from "./transcript-panel";
import type { TranscriptWord, EDL } from "@/lib/edl";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const DEFAULT_WORDS: TranscriptWord[] = [
  { word: "Hello", start: 0, end: 1, confidence: 0.9 },
  { word: "world", start: 1, end: 2, confidence: 0.9 },
];

const DEFAULT_EDL: EDL = {
  segments: [
    { start: 0, end: 2, status: "keep", reason: null },
  ],
};

const defaultProps = {
  words: DEFAULT_WORDS,
  edl: DEFAULT_EDL,
  currentTime: 0,
  isPlaying: false,
  onSeek: vi.fn(),
  onCutWords: vi.fn(),
  onRestoreSegment: vi.fn(),
  onOpenRetakeReview: vi.fn(),
  cutEvent: null,
  onPolishWithAi: vi.fn(),
  aiBusy: false,
  aiCostLabel: "2 credits",
  noAiRunYet: true,
  hasDiverged: false,
  onRestoreAiSuggestions: vi.fn(),
};

describe("TranscriptPanel", () => {
  beforeEach(() => {
    localStorage.clear();
  });
  
  afterEach(() => {
    localStorage.clear();
  });

  it("renders words and calls onSeek when a word is clicked", async () => {
    const user = userEvent.setup();
    render(<TranscriptPanel {...defaultProps} />);
    
    const wordEl = screen.getByText("Hello");
    expect(wordEl).toBeVisible();
    
    await user.click(wordEl);
    expect(defaultProps.onSeek).toHaveBeenCalledWith(0);
  });

  it("cuts a word when right-clicked and 'Cut' is selected", async () => {
    const user = userEvent.setup();
    render(<TranscriptPanel {...defaultProps} />);
    
    const wordEl = screen.getByText("world");
    await user.pointer([{ target: wordEl, keys: "[MouseRight]" }]);
    
    const cutBtn = await screen.findByRole("menuitem", { name: /cut 1 word/i });
    await user.click(cutBtn);
    
    expect(defaultProps.onCutWords).toHaveBeenCalledWith([{ word: "world", start: 1, end: 2, confidence: 0.9 }]);
  });

  // AC-6: the manual "Polish with AI" button shows only when no run exists.
  it("shows the Polish with AI button when cutEvent is present and no run exists yet", () => {
    render(
      <TranscriptPanel
        {...defaultProps}
        cutEvent={{ kind: "rough", at: Date.now() }}
      />
    );

    expect(screen.getByRole("button", { name: /Polish with AI/i })).toBeVisible();
    expect(screen.getByText(/Uses 2 credits/i)).toBeVisible();
  });

  // AC-6: after a successful run (noAiRunYet false), the manual button is gone.
  it("hides the Polish with AI button once a run exists (noAiRunYet false)", () => {
    const lastRunDate = new Date(Date.now() - 5 * 60000).toISOString(); // 5 minutes ago
    render(
      <TranscriptPanel
        {...defaultProps}
        cutEvent={{ kind: "ai", at: Date.now() }}
        noAiRunYet={false}
        hasDiverged={false}
        lastAiCutTime={lastRunDate}
      />
    );

    expect(screen.queryByRole("button", { name: /Polish with AI/i })).toBeNull();
    expect(screen.getByText(/Your AI cuts are applied/i)).toBeVisible();
    expect(screen.getByText(/last run 5 minutes/i)).toBeVisible();
  });

  // AC-7: the free "Restore AI suggestions" action shows only when a run exists
  // and the user has diverged from it; pressing it calls the client-side restore
  // with no network involved.
  it("shows Restore AI suggestions only when a run exists and the user has diverged", async () => {
    const user = userEvent.setup();
    render(
      <TranscriptPanel
        {...defaultProps}
        cutEvent={{ kind: "ai", at: Date.now() }}
        noAiRunYet={false}
        hasDiverged={true}
      />
    );

    const restoreBtn = screen.getByRole("button", { name: /Restore AI suggestions/i });
    expect(restoreBtn).toBeVisible();
    // The paid manual button must not be offered alongside it.
    expect(screen.queryByRole("button", { name: /Polish with AI/i })).toBeNull();

    await user.click(restoreBtn);
    expect(defaultProps.onRestoreAiSuggestions).toHaveBeenCalledTimes(1);
  });

  it("shows neither AI action when a run exists and nothing has diverged", () => {
    render(
      <TranscriptPanel
        {...defaultProps}
        cutEvent={{ kind: "ai", at: Date.now() }}
        noAiRunYet={false}
        hasDiverged={false}
      />
    );

    expect(screen.queryByRole("button", { name: /Polish with AI/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Restore AI suggestions/i })).toBeNull();
  });
  
  it("shows empty state when no words are provided", () => {
    render(<TranscriptPanel {...defaultProps} words={[]} />);
    expect(screen.getByText("No transcript available.")).toBeVisible();
  });

  it("toggles hide cut preference and collapses cut words", async () => {
    const user = userEvent.setup();
    const cutEdl: EDL = {
      segments: [
        { start: 0, end: 1, status: "cut", reason: "manual" },
        { start: 1, end: 2, status: "keep", reason: null },
      ]
    };
    const onRestoreSegment = vi.fn();
    render(<TranscriptPanel {...defaultProps} edl={cutEdl} onRestoreSegment={onRestoreSegment} />);

    const toggleBtn = screen.getByTitle("Hide removed text");
    await user.click(toggleBtn);

    // The cut word should be replaced with a pill
    const pill = await screen.findByTitle(/1 removed word/i);
    expect(pill).toBeVisible();

    // Clicking the pill opens the anchored menu — restore happens only from it.
    await user.click(pill);
    expect(onRestoreSegment).not.toHaveBeenCalled();
    await user.click(await screen.findByRole("menuitem", { name: /restore/i }));
    expect(onRestoreSegment).toHaveBeenCalledWith(expect.objectContaining({
      start: 0, end: 1
    }));
  });
  
  it("restores only the clicked word's own span, not the whole merged segment it shares with other cut words", async () => {
    const user = userEvent.setup();
    // Two independently-cut words that now share one merged EDL segment
    // (mergeAdjacent fuses adjacent same-status/reason segments) — mirrors
    // what happens in the app after cutting adjacent words one at a time.
    const words: TranscriptWord[] = [
      { word: "one", start: 0, end: 1, confidence: 0.9 },
      { word: "two", start: 1, end: 2, confidence: 0.9 },
      { word: "three", start: 2, end: 3, confidence: 0.9 },
    ];
    const mergedCutEdl: EDL = {
      segments: [{ start: 0, end: 2, status: "cut", reason: "manual" }, { start: 2, end: 3, status: "keep", reason: null }],
    };
    const onRestoreSegment = vi.fn();
    render(
      <TranscriptPanel {...defaultProps} words={words} edl={mergedCutEdl} onRestoreSegment={onRestoreSegment} />
    );

    const wordEl = screen.getByText("one");
    await user.pointer([{ target: wordEl, keys: "[MouseRight]" }]);

    const restoreBtn = await screen.findByRole("menuitem", { name: /restore 1 word/i });
    await user.click(restoreBtn);

    // Only "one"'s own [0, 1) span should be restored, not the merged [0, 2) segment.
    expect(onRestoreSegment).toHaveBeenCalledWith(
      expect.objectContaining({ start: 0, end: 1 })
    );
    expect(onRestoreSegment).not.toHaveBeenCalledWith(
      expect.objectContaining({ start: 0, end: 2 })
    );
  });

  it("accessible name for hide cut toggle updates", async () => {
    const user = userEvent.setup();
    render(<TranscriptPanel {...defaultProps} />);
    const toggleBtn = screen.getByTitle("Hide removed text");
    expect(toggleBtn).toHaveAttribute("aria-pressed", "false");

    await user.click(toggleBtn);
    expect(screen.getByTitle("Show removed text")).toHaveAttribute("aria-pressed", "true");
  });

  it("plain click sets the anchor so a Ctrl+click on another word selects the range", async () => {
    const user = userEvent.setup();
    const onSeek = vi.fn();
    render(<TranscriptPanel {...defaultProps} onSeek={onSeek} />);

    // Plain click seeks AND anchors the range at "Hello".
    await user.click(screen.getByText("Hello"));
    expect(onSeek).toHaveBeenCalledWith(0);

    await user.keyboard("{Control>}");
    await user.click(screen.getByText("world"));
    await user.keyboard("{/Control}");

    expect(screen.getByText(/2 words selected/i)).toBeVisible();
    // The modifier click extends the selection; it must not seek again.
    expect(onSeek).toHaveBeenCalledTimes(1);
  });

  it("Shift+click also extends the range from the last plain-clicked word", async () => {
    const user = userEvent.setup();
    const onSeek = vi.fn();
    render(<TranscriptPanel {...defaultProps} onSeek={onSeek} />);

    await user.click(screen.getByText("Hello"));
    await user.keyboard("{Shift>}");
    await user.click(screen.getByText("world"));
    await user.keyboard("{/Shift}");

    expect(screen.getByText(/2 words selected/i)).toBeVisible();
  });

  it("selection bar 'Play selection' plays from the earliest selected word", async () => {
    const user = userEvent.setup();
    const onSeek = vi.fn();
    const onPlayFrom = vi.fn();
    render(<TranscriptPanel {...defaultProps} onSeek={onSeek} onPlayFrom={onPlayFrom} />);

    await user.click(screen.getByText("Hello"));
    await user.keyboard("{Control>}");
    await user.click(screen.getByText("world"));
    await user.keyboard("{/Control}");

    await user.click(screen.getByRole("button", { name: /play selection/i }));
    expect(onPlayFrom).toHaveBeenCalledWith(0);
  });

  it("a plain click never shows the selection bar — not even mid-click", () => {
    const onSeek = vi.fn();
    render(<TranscriptPanel {...defaultProps} onSeek={onSeek} />);
    const word = screen.getByText("Hello");

    // Mid-click (button held down on a word): no "N words selected" bar.
    fireEvent.mouseDown(word);
    expect(screen.queryByText(/selected/i)).toBeNull();

    fireEvent.mouseUp(word);
    expect(screen.queryByText(/selected/i)).toBeNull();
    // Click semantics kept: releasing on the word still seeks.
    expect(onSeek).toHaveBeenCalledWith(0);
  });

  it("context-menu Deselect only clears the highlight — no cut, no restore", async () => {
    const user = userEvent.setup();
    const onCutWords = vi.fn();
    const onRestoreSegment = vi.fn();
    render(
      <TranscriptPanel
        {...defaultProps}
        onCutWords={onCutWords}
        onRestoreSegment={onRestoreSegment}
      />
    );

    await user.click(screen.getByText("Hello"));
    await user.keyboard("{Control>}");
    await user.click(screen.getByText("world"));
    await user.keyboard("{/Control}");
    expect(screen.getByText(/2 words selected/i)).toBeVisible();

    await user.pointer([{ target: screen.getByText("world"), keys: "[MouseRight]" }]);
    await user.click(await screen.findByRole("menuitem", { name: /deselect/i }));

    expect(screen.queryByText(/2 words selected/i)).toBeNull();
    expect(onCutWords).not.toHaveBeenCalled();
    expect(onRestoreSegment).not.toHaveBeenCalled();
  });

  it("shows the gesture hint strip until dismissed, then persists the dismissal", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<TranscriptPanel {...defaultProps} />);

    expect(screen.getByText(/a word to jump/i)).toBeVisible();
    await user.click(screen.getByRole("button", { name: /dismiss hints/i }));
    expect(screen.queryByText(/a word to jump/i)).toBeNull();

    // A fresh mount respects the stored dismissal.
    unmount();
    render(<TranscriptPanel {...defaultProps} />);
    expect(screen.queryByText(/a word to jump/i)).toBeNull();
  });

  it("renders legend chips for the cut reasons present in the EDL", () => {
    const cutEdl: EDL = {
      segments: [
        { start: 0, end: 0.5, status: "cut", reason: "silence" },
        { start: 0.5, end: 1, status: "cut", reason: "retake" },
        { start: 1, end: 1.5, status: "cut", reason: "ai" },
        { start: 1.5, end: 2, status: "keep", reason: null },
      ],
    };
    render(<TranscriptPanel {...defaultProps} edl={cutEdl} />);

    expect(screen.getByText(/1 silence/i)).toBeVisible();
    expect(screen.getByText(/1 retake/i)).toBeVisible();
    expect(screen.getByText(/1 AI cut/i)).toBeVisible();
    expect(screen.queryByText(/repeat/i)).toBeNull();
  });

  it("left-clicking a struck-through word opens the anchored menu, not an instant restore", async () => {
    const user = userEvent.setup();
    const onRestoreSegment = vi.fn();
    const cutEdl: EDL = {
      segments: [
        { start: 0, end: 1, status: "cut", reason: "manual" },
        { start: 1, end: 2, status: "keep", reason: null },
      ],
    };
    render(<TranscriptPanel {...defaultProps} edl={cutEdl} onRestoreSegment={onRestoreSegment} />);

    await user.click(screen.getByText("Hello"));
    // Menu opens; nothing restored yet.
    const restoreItem = await screen.findByRole("menuitem", { name: /restore/i });
    expect(restoreItem).toBeVisible();
    expect(onRestoreSegment).not.toHaveBeenCalled();

    await user.click(restoreItem);
    expect(onRestoreSegment).toHaveBeenCalledWith(
      expect.objectContaining({ start: 0, end: 1, status: "cut" })
    );
  });

  it("clicking elsewhere closes the restore menu and keeps the word removed", async () => {
    const user = userEvent.setup();
    const onRestoreSegment = vi.fn();
    const cutEdl: EDL = {
      segments: [
        { start: 0, end: 1, status: "cut", reason: "manual" },
        { start: 1, end: 2, status: "keep", reason: null },
      ],
    };
    render(<TranscriptPanel {...defaultProps} edl={cutEdl} onRestoreSegment={onRestoreSegment} />);

    await user.click(screen.getByText("Hello"));
    expect(await screen.findByRole("menuitem", { name: /restore/i })).toBeVisible();

    await user.click(document.body);
    expect(screen.queryByRole("menuitem", { name: /restore/i })).toBeNull();
    expect(onRestoreSegment).not.toHaveBeenCalled();
  });

  it("right-click Restore on a cut word still works in one step", async () => {
    const user = userEvent.setup();
    const onRestoreSegment = vi.fn();
    const cutEdl: EDL = {
      segments: [
        { start: 0, end: 1, status: "cut", reason: "manual" },
        { start: 1, end: 2, status: "keep", reason: null },
      ],
    };
    render(<TranscriptPanel {...defaultProps} edl={cutEdl} onRestoreSegment={onRestoreSegment} />);

    await user.pointer([{ target: screen.getByText("Hello"), keys: "[MouseRight]" }]);
    await user.click(await screen.findByRole("menuitem", { name: /restore/i }));

    expect(onRestoreSegment).toHaveBeenCalledTimes(1);
  });

  it("previews the hidden words in the collapsed pill's tooltip", async () => {
    const user = userEvent.setup();
    const cutEdl: EDL = {
      segments: [
        { start: 0, end: 1, status: "cut", reason: "manual" },
        { start: 1, end: 2, status: "keep", reason: null },
      ],
    };
    render(<TranscriptPanel {...defaultProps} edl={cutEdl} />);

    await user.click(screen.getByTitle("Hide removed text"));
    const pill = await screen.findByTitle(/1 removed word.*Hello/i);
    expect(pill).toBeVisible();
  });
});
