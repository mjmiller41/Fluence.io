/** A 2D point as an [x, y] tuple (millimetres in LaserKerf's world space). */
export type Point = readonly [x: number, y: number];
/** A polygon ring (implicitly closed; no duplicated final vertex). */
export type Ring = readonly Point[];
/** A set of rings (outer + holes, or several disjoint polygons). */
export type Polygons = readonly Ring[];

export type FillRuleName = 'evenodd' | 'nonzero' | 'positive' | 'negative';
export type BooleanOpKind = 'union' | 'difference' | 'intersection' | 'xor';
