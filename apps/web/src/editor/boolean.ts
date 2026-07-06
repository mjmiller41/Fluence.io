import {
  createPath,
  flattenPath,
  type LayerId,
  type Shape,
  shapeGeometry,
  subpathFromPoints,
} from 'scene';
import { createGeometryClient, type Polygons } from 'geometry-wasm';

export type BooleanMode = 'union' | 'difference' | 'intersection' | 'weld';

function toPolygons(shape: Shape): Polygons {
  return flattenPath(shapeGeometry(shape), 0.05).map((poly) =>
    poly.map((p): [number, number] => [p.x, p.y]),
  );
}

function toPathShape(result: Polygons, layerId: LayerId): Shape {
  const subpaths = result.map((ring) =>
    subpathFromPoints(
      ring.map(([x, y]) => ({ x, y })),
      true,
    ),
  );
  return createPath(subpaths, { layerId });
}

/**
 * Run a boolean/weld over the selected shapes in the geometry worker and return
 * the merged result as a single path shape. union/weld combine all; difference
 * is first minus the rest; intersection is first ∩ the rest.
 */
export async function booleanShapes(
  mode: BooleanMode,
  shapes: Shape[],
  layerId: LayerId,
): Promise<Shape> {
  const client = createGeometryClient();
  try {
    const polys = shapes.map(toPolygons);
    let result: Polygons;
    if (mode === 'union' || mode === 'weld') {
      result = await client.api.weld(polys);
    } else {
      const [first, ...rest] = polys;
      const restMerged = rest.length > 0 ? await client.api.weld(rest) : first;
      result =
        mode === 'difference'
          ? await client.api.difference(first, rest.length > 0 ? restMerged : [])
          : await client.api.intersection(first, restMerged);
    }
    return toPathShape(result, layerId);
  } finally {
    client.terminate();
  }
}
