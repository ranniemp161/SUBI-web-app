// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup } from "@testing-library/react";
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
    
    const cutBtn = await screen.findByRole("menuitem", { name: /cut/i });
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
    render(<TranscriptPanel {...defaultProps} edl={cutEdl} />);
    
    const toggleBtn = screen.getByTitle("Hide removed text");
    await user.click(toggleBtn);
    
    // The cut word should be replaced with a pill
    const pill = await screen.findByTitle(/1 removed word/i);
    expect(pill).toBeVisible();
    
    // Restores when pill is clicked
    await user.click(pill);
    expect(defaultProps.onRestoreSegment).toHaveBeenCalledWith(expect.objectContaining({
      start: 0, end: 1
    }));
  });
  
  it("accessible name for hide cut toggle updates", async () => {
    const user = userEvent.setup();
    render(<TranscriptPanel {...defaultProps} />);
    const toggleBtn = screen.getByTitle("Hide removed text");
    expect(toggleBtn).toHaveAttribute("aria-pressed", "false");
    
    await user.click(toggleBtn);
    expect(screen.getByTitle("Show removed text")).toHaveAttribute("aria-pressed", "true");
  });
});
