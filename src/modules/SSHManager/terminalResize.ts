export interface TerminalResizeDimensions {
  cols: number;
  rows: number;
}

const MIN_VISIBLE_COLS = 2;
const MIN_VISIBLE_ROWS = 2;

function hasUsableDimensions(dimensions: TerminalResizeDimensions): boolean {
  return Number.isFinite(dimensions.cols)
    && Number.isFinite(dimensions.rows)
    && dimensions.cols >= MIN_VISIBLE_COLS
    && dimensions.rows >= MIN_VISIBLE_ROWS;
}

function sameDimensions(left: TerminalResizeDimensions | null, right: TerminalResizeDimensions): boolean {
  return !!left && left.cols === right.cols && left.rows === right.rows;
}

export function shouldPublishTerminalResize({
  visible,
  next,
  last,
}: {
  visible: boolean;
  next: TerminalResizeDimensions;
  last: TerminalResizeDimensions | null;
}): boolean {
  return visible && hasUsableDimensions(next) && !sameDimensions(last, next);
}
