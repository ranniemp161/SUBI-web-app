import type { Render2DContext } from "./context";
import { BRAND } from "./theme";

/**
 * How a clip sets words: parsing the creator's emphasis, wrapping across it,
 * centring on the ink rather than on the font's declared box, and drawing the
 * result.
 *
 * This module exists because emphasis and wrapping cannot be separated. Once one
 * word in a line can carry its own colour, a line stops being a string: it is a
 * sequence of runs, and every step that used to take a string (measure, wrap,
 * draw) has to walk runs instead. Writing that per template is how four
 * templates end up disagreeing about where a line breaks, so all of it lives
 * here and every template that burns words on screen calls in.
 *
 * Spec `broll/0009` §Text.
 */

/**
 * A stretch of text that draws in one colour.
 *
 * `emphasis` is set only by the creator, by wrapping a word in asterisks. There
 * is deliberately no code path anywhere that decides a word deserves emphasis on
 * its own (**AC-190**), and the reason is honesty rather than taste: on screen
 * text is freely editable and never passes the honesty check, so a rule that
 * automatically highlighted, say, figures would take a number nobody spoke and
 * make it the loudest thing in the frame. A creator marking their own word
 * asserts nothing.
 */
export interface TextRun {
  text: string;
  emphasis: boolean;
}

/** One wrapped line, as the runs that make it up in drawing order. */
export type RunLine = TextRun[];

/** The mark a creator wraps a word in. */
const EMPHASIS_MARK = "*";

/**
 * The colour an emphasised run draws in: Key Yellow, the brand.
 *
 * One home rather than a knob on every theme. Emphasis means the same thing in
 * every template, and a per template emphasis colour is just an invitation for
 * two templates to disagree about what the creator's mark meant.
 */
const EMPHASIS_COLOR = BRAND.accent;

/**
 * Splits the creator's text into plain and emphasised runs.
 *
 * `we built a *castle* here` gives three runs, the middle one emphasised, and
 * the asterisks themselves never reach the frame (**AC-189**).
 *
 * **An unmatched asterisk renders as an asterisk.** `a *castle` draws the
 * asterisk literally and emphasises nothing. This is the case worth being
 * careful about: a parser that swallowed the rest of the line on one stray
 * character would be worse than having no emphasis at all, because a creator
 * types the stray character while they are still typing the closing one, and
 * would watch their own line disappear as they wrote it.
 *
 * `**` is two literal asterisks for the same reason. An empty emphasised run has
 * nothing to colour, so treating it as a mark would eat two characters and show
 * nothing for them.
 */
export function parseRuns(text: string): TextRun[] {
  const runs: TextRun[] = [];
  let plain = "";

  const flush = () => {
    if (plain !== "") {
      runs.push({ text: plain, emphasis: false });
      plain = "";
    }
  };

  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (char !== EMPHASIS_MARK) {
      plain += char;
      index += 1;
      continue;
    }

    const close = text.indexOf(EMPHASIS_MARK, index + 1);
    // No closing mark, or nothing between the two: the mark is just a character
    // the creator typed. Emit it and carry on from the next one, so a second
    // mark later in the line still gets its chance to open a pair.
    if (close === -1 || close === index + 1) {
      plain += char;
      index += 1;
      continue;
    }

    flush();
    runs.push({ text: text.slice(index + 1, close), emphasis: true });
    index = close + 1;
  }

  flush();
  return runs;
}

/** The plain text of a line, with every mark already resolved away. */
export function runLineText(line: RunLine): string {
  return line.map((run) => run.text).join("");
}

/**
 * How wide a line draws.
 *
 * Measured run by run and summed, because that is exactly how {@link drawRunLine}
 * puts it on the frame: it advances the cursor by the width of what it has
 * already drawn. Measuring the joined string instead would be a slightly
 * different number on a real font, where the pair of characters either side of a
 * run boundary can kern, and wrapping would then disagree with drawing about
 * whether a line fits.
 */
export function measureRunLine(
  ctx: Pick<Render2DContext, "measureText">,
  line: RunLine
): number {
  return line.reduce((total, run) => total + ctx.measureText(run.text).width, 0);
}

/** A word, as the run pieces it is made of. A word never contains whitespace. */
type Word = TextRun[];

function wordsFromRuns(runs: TextRun[]): Word[] {
  const words: Word[] = [];
  let current: Word = [];

  const endWord = () => {
    if (current.length > 0) {
      words.push(current);
      current = [];
    }
  };

  for (const run of runs) {
    // Split keeping nothing: the separators are collapsed to one space when the
    // line is rebuilt, which is what the old string wrapper did too.
    const pieces = run.text.split(/(\s+)/);
    for (const piece of pieces) {
      if (piece === "") continue;
      if (/^\s+$/.test(piece)) {
        endWord();
        continue;
      }
      current.push({ text: piece, emphasis: run.emphasis });
    }
  }

  endWord();
  return words;
}

function wordWidth(ctx: Pick<Render2DContext, "measureText">, word: Word): number {
  return word.reduce((total, piece) => total + ctx.measureText(piece.text).width, 0);
}

/**
 * Rebuilds one line's runs from its words, putting the spaces back.
 *
 * Adjacent pieces of the same emphasis merge, so a plain line comes out as the
 * single run it always was and draws in one `fillText` call.
 *
 * A space between two words is emphasised only when the words on **both** sides
 * of it are. Nothing about the frame depends on this, because a space carries no
 * ink and cannot show a colour, but it keeps an emphasised run tight around the
 * word the creator actually marked, which is what anyone reading these runs
 * later will expect them to hold.
 */
function lineFromWords(words: Word[]): RunLine {
  const line: RunLine = [];

  const append = (text: string, emphasis: boolean) => {
    const last = line[line.length - 1];
    if (last && last.emphasis === emphasis) {
      last.text += text;
      return;
    }
    line.push({ text, emphasis });
  };

  words.forEach((word, index) => {
    if (index > 0) {
      const before = words[index - 1];
      const joined = before[before.length - 1].emphasis && word[0].emphasis;
      append(" ", joined);
    }
    for (const piece of word) append(piece.text, piece.emphasis);
  });

  return line;
}

/**
 * Breaks runs into lines that fit `maxWidth`, keeping run boundaries intact.
 *
 * Greedy, the same rule the plain string wrapper always used, with one addition
 * below. A word longer than the whole line stays on its own line rather than
 * being split: these are the speaker's own words burned on screen, so an
 * overhang reads better than a hyphen and far better than losing what was said.
 *
 * Emphasis takes no part in any of this. Wrapping is a question about words, and
 * a creator marking one of them changes its colour, never where the line breaks.
 */
export function wrapRuns(
  ctx: Pick<Render2DContext, "measureText">,
  runs: TextRun[],
  maxWidth: number
): RunLine[] {
  const words = wordsFromRuns(runs);
  if (words.length === 0) return [];

  const spaceWidth = ctx.measureText(" ").width;
  const lines: Word[][] = [];
  let current: Word[] = [words[0]];
  let currentWidth = wordWidth(ctx, words[0]);

  for (const word of words.slice(1)) {
    const width = wordWidth(ctx, word);
    if (currentWidth + spaceWidth + width <= maxWidth) {
      current.push(word);
      currentWidth += spaceWidth + width;
    } else {
      lines.push(current);
      current = [word];
      currentWidth = width;
    }
  }
  lines.push(current);

  return pullOrphan(ctx, lines, maxWidth, spaceWidth).map(lineFromWords);
}

/**
 * Pulls a word down when the last line would hold a single one on its own
 * (**AC-192**).
 *
 * A last line of one word reads as a mistake rather than as a line. Greedy
 * wrapping produces them often, and the fix is to take the last word of the line
 * above and let it fall.
 *
 * **Only when the pulled line still fits.** The guard is the whole point: a
 * short orphan under a line that already holds one long word cannot be rescued,
 * because the two together overflow, and an overflowing line is a worse defect
 * than a short one. In that case the orphan is kept exactly as it is.
 *
 * Nothing is balanced beyond this one word. Full line balancing changes line
 * counts, and the shrink to fit loop keys off the line count, so type size and
 * line breaks would start moving together as the creator types.
 */
function pullOrphan(
  ctx: Pick<Render2DContext, "measureText">,
  lines: Word[][],
  maxWidth: number,
  spaceWidth: number
): Word[][] {
  if (lines.length < 2) return lines;

  const last = lines[lines.length - 1];
  const previous = lines[lines.length - 2];
  if (last.length !== 1 || previous.length < 2) return lines;

  const pulled = [previous[previous.length - 1], ...last];
  const width =
    pulled.reduce((total, word) => total + wordWidth(ctx, word), 0) +
    spaceWidth * (pulled.length - 1);
  if (width > maxWidth) return lines;

  return [...lines.slice(0, -2), previous.slice(0, -1), pulled];
}

/**
 * Where the ink of a line actually sits, above and below the baseline.
 *
 * `textBaseline` alignment centres on the font's **declared** box, which is a
 * property of the face rather than of the string: a line of capitals has no
 * descender, so centring it that way reserves room under it for one that is not
 * there and the block reads low in the frame (**AC-191**).
 *
 * Both metrics are optional on the context, so both have a fallback. A browser
 * may omit them for a face it had to synthesise, and the structural recorder in
 * the tests supplies its own. The fallbacks are an ordinary sans serif's cap
 * height and descender, which is close enough that a missing metric shifts the
 * block slightly rather than collapsing it to the baseline.
 */
export function inkMetrics(
  ctx: Pick<Render2DContext, "measureText">,
  text: string,
  size: number
): { ascent: number; descent: number } {
  const measured = ctx.measureText(text);
  return {
    ascent: measured.actualBoundingBoxAscent ?? size * 0.72,
    descent: measured.actualBoundingBoxDescent ?? size * 0.2,
  };
}

/**
 * The baseline of the first line of a block centred optically on `centerY`.
 *
 * Measured off the real ink of the block's own first and last lines, so a block
 * of capitals and a block with descenders both sit where the eye expects. Draw
 * with `textBaseline = "alphabetic"` and step down by `lineHeight` per line.
 */
export function centeredFirstBaseline(
  ctx: Pick<Render2DContext, "measureText">,
  lines: RunLine[],
  options: { centerY: number; lineHeight: number; size: number }
): number {
  const { centerY, lineHeight, size } = options;
  if (lines.length === 0) return centerY;

  const { ascent } = inkMetrics(ctx, runLineText(lines[0]), size);
  const { descent } = inkMetrics(ctx, runLineText(lines[lines.length - 1]), size);

  const inkHeight = ascent + (lines.length - 1) * lineHeight + descent;
  return centerY - inkHeight / 2 + ascent;
}

/**
 * The baseline of the last line of a block whose ink should rest on `bottomY`.
 *
 * The bottom aligned counterpart of {@link centeredFirstBaseline}, for the
 * compositions that set their words across the bottom of the frame. Sitting the
 * declared box on the margin instead leaves a gap under a line of capitals and
 * none under a line with a descender in it, so the margin looks like it changes
 * between scenes.
 */
export function bottomBaseline(
  ctx: Pick<Render2DContext, "measureText">,
  lastLine: RunLine,
  options: { bottomY: number; size: number }
): number {
  const { descent } = inkMetrics(ctx, runLineText(lastLine), options.size);
  return options.bottomY - descent;
}

/**
 * Draws one line, left to right from `x`, in the colours its runs call for.
 *
 * The caller owns the font, the alpha and the baseline, and must leave
 * `textAlign` at `left`: a run cannot be drawn centred, because each one starts
 * where the previous one ended. A centred line is drawn by handing this the left
 * edge the caller worked out from {@link measureRunLine}.
 */
export function drawRunLine(
  ctx: Pick<Render2DContext, "measureText" | "fillText" | "fillStyle">,
  line: RunLine,
  x: number,
  y: number,
  color: string
): void {
  let cursor = x;
  for (const run of line) {
    if (run.text === "") continue;
    ctx.fillStyle = run.emphasis ? EMPHASIS_COLOR : color;
    ctx.fillText(run.text, cursor, y);
    cursor += ctx.measureText(run.text).width;
  }
}
