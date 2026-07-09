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
  onEnhanceAi: vi.fn(),
  aiBusy: false,
  aiCostLabel: "2 credits",
  hasAiCuts: false,
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

  it("shows the AI cut enhancement card when cutEvent is present and hasAiCuts is false", () => {
    render(
      <TranscriptPanel 
        {...defaultProps} 
        cutEvent={{ kind: "rough", at: Date.now() }} 
      />
    );
    
    expect(screen.getByText(/Enhance with AI Cut/i)).toBeVisible();
    expect(screen.getByText(/Uses 2 credits/i)).toBeVisible();
  });

  // AC-X / Slice 4
  it("shows the AI cuts already included text with timestamp when hasAiCuts is true", () => {
    const lastRunDate = new Date(Date.now() - 5 * 60000).toISOString(); // 5 minutes ago
    render(
      <TranscriptPanel 
        {...defaultProps} 
        cutEvent={{ kind: "rough", at: Date.now() }} 
        hasAiCuts={true}
        lastAiCutTime={lastRunDate}
      />
    );
    
    expect(screen.getByText(/Your AI cuts are already included/i)).toBeVisible();
    expect(screen.getByText(/last run 5 minutes/i)).toBeVisible();
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
