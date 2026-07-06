import { type Rect, unionRect } from '../geom/rect';
import { type Shape, shapeBounds } from './shape';
import { translatedShape } from './transform';

export type AlignMode = 'left' | 'right' | 'hcenter' | 'top' | 'bottom' | 'vcenter';
export type DistributeMode = 'horizontal' | 'vertical';

interface Measured {
  shape: Shape;
  bounds: Rect | null;
}

function measure(shapes: readonly Shape[]): Measured[] {
  return shapes.map((shape) => ({ shape, bounds: shapeBounds(shape) }));
}

/** Align shapes to the bounding box of the whole selection (Y-up: top = max Y). */
export function align(shapes: readonly Shape[], mode: AlignMode): Shape[] {
  const measured = measure(shapes);
  let selection: Rect | null = null;
  for (const m of measured) selection = unionRect(selection, m.bounds);
  if (!selection) return [...shapes];
  const sel = selection;

  return measured.map(({ shape, bounds }) => {
    if (!bounds) return shape;
    let dx = 0;
    let dy = 0;
    switch (mode) {
      case 'left':
        dx = sel.x - bounds.x;
        break;
      case 'right':
        dx = sel.x + sel.width - (bounds.x + bounds.width);
        break;
      case 'hcenter':
        dx = sel.x + sel.width / 2 - (bounds.x + bounds.width / 2);
        break;
      case 'bottom':
        dy = sel.y - bounds.y;
        break;
      case 'top':
        dy = sel.y + sel.height - (bounds.y + bounds.height);
        break;
      case 'vcenter':
        dy = sel.y + sel.height / 2 - (bounds.y + bounds.height / 2);
        break;
    }
    return dx === 0 && dy === 0 ? shape : translatedShape(shape, dx, dy);
  });
}

/** Distribute shape centres evenly between the two outermost shapes. */
export function distribute(shapes: readonly Shape[], mode: DistributeMode): Shape[] {
  const measured = measure(shapes).filter(
    (m): m is Measured & { bounds: Rect } => m.bounds !== null,
  );
  if (measured.length < 3) return [...shapes];

  const axis = mode === 'horizontal' ? 'x' : 'y';
  const size = mode === 'horizontal' ? 'width' : 'height';
  const centerOf = (b: Rect): number => b[axis] + b[size] / 2;

  const sorted = [...measured].sort((a, b) => centerOf(a.bounds) - centerOf(b.bounds));
  const first = centerOf(sorted[0].bounds);
  const last = centerOf(sorted[sorted.length - 1].bounds);
  const step = (last - first) / (sorted.length - 1);

  const deltas = new Map<string, number>();
  sorted.forEach((m, i) => {
    const target = first + step * i;
    deltas.set(m.shape.id, target - centerOf(m.bounds));
  });

  return shapes.map((shape) => {
    const delta = deltas.get(shape.id);
    if (!delta) return shape;
    return mode === 'horizontal' ? translatedShape(shape, delta, 0) : translatedShape(shape, 0, delta);
  });
}
