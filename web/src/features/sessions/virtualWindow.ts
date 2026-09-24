export type VirtualWindowOptions = {
  count: number;
  rowHeight: number;
  scrollTop: number;
  viewportHeight: number;
  overscan?: number;
};

export type VirtualWindow = {
  start: number;
  end: number;
  padTop: number;
  padBottom: number;
};

/**
 * Index range to render for a fixed-height list, plus the spacer heights that
 * keep the scrollbar proportional to the full list.
 */
export function computeVirtualWindow({
  count,
  rowHeight,
  scrollTop,
  viewportHeight,
  overscan = 8
}: VirtualWindowOptions): VirtualWindow {
  if (count <= 0 || rowHeight <= 0) {
    return { start: 0, end: 0, padTop: 0, padBottom: 0 };
  }

  const firstVisible = Math.floor(Math.max(0, scrollTop) / rowHeight);
  const visibleCount = Math.ceil(Math.max(0, viewportHeight) / rowHeight) + 1;
  const start = Math.max(0, Math.min(count, firstVisible - overscan));
  const end = Math.max(start, Math.min(count, start + visibleCount + overscan * 2));

  return {
    start,
    end,
    padTop: start * rowHeight,
    padBottom: (count - end) * rowHeight
  };
}

/** Prefix sums for `sizes`, so `offsets[i]` is where row `i` starts. */
export function buildRowOffsets(sizes: number[]): number[] {
  const offsets = new Array<number>(sizes.length + 1);
  offsets[0] = 0;
  for (let index = 0; index < sizes.length; index += 1) {
    offsets[index + 1] = offsets[index] + Math.max(0, sizes[index]);
  }
  return offsets;
}

export type SizedWindowOptions = {
  /** Output of {@link buildRowOffsets}: `sizes.length + 1` prefix sums. */
  offsets: number[];
  scrollTop: number;
  viewportHeight: number;
  overscan?: number;
};

/** Greatest index whose offset is still at or above `position`. */
function rowAt(offsets: number[], position: number): number {
  let low = 0;
  let high = offsets.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (offsets[mid] <= position) low = mid;
    else high = mid - 1;
  }
  return low;
}

/**
 * Same contract as {@link computeVirtualWindow}, for lists whose rows have
 * different heights (e.g. session groups with collapsible headers).
 */
export function computeSizedWindow({
  offsets,
  scrollTop,
  viewportHeight,
  overscan = 6
}: SizedWindowOptions): VirtualWindow {
  const count = Math.max(0, offsets.length - 1);
  if (count === 0) {
    return { start: 0, end: 0, padTop: 0, padBottom: 0 };
  }

  const total = offsets[count];
  const top = Math.min(Math.max(0, scrollTop), Math.max(0, total - 1));
  const bottom = top + Math.max(1, viewportHeight);
  const first = Math.min(count - 1, rowAt(offsets, top));
  const last = Math.min(count - 1, rowAt(offsets, Math.max(top, bottom - 1)));

  const start = Math.max(0, first - overscan);
  const end = Math.max(start, Math.min(count, last + 1 + overscan));

  return {
    start,
    end,
    padTop: offsets[start],
    padBottom: total - offsets[end]
  };
}
