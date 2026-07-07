/**
 * scene — the design domain model (document, shapes, layers) plus 2D geometry
 * and editor operations. Pure TS: no DOM, no WASM. Shared by the editor UI, CAM,
 * and file formats.
 */

// Geometry
export type { Vec2 } from './geom/vec';
export * as vecmath from './geom/vec';
export type { Mat2D, DecomposedTransform } from './geom/matrix';
export * as matrix from './geom/matrix';
export type { Rect } from './geom/rect';
export {
  boundsOfPoints,
  center as rectCenter,
  containsPoint,
  corners as rectCorners,
  rect,
  unionRect,
} from './geom/rect';
export type { Path, SubPath, Segment } from './geom/path';
export {
  cubicAt,
  flattenPath,
  flattenSubPath,
  pathBounds,
  pathLength,
  subpathFromPoints,
  transformPath,
  transformSubPath,
} from './geom/path';

// Model
export type {
  Shape,
  ShapeId,
  LayerId,
  CommonShape,
  RectShape,
  EllipseShape,
  RegularPolygonShape,
  PolylineShape,
  PathShape,
  ImageShape,
  GroupShape,
} from './model/shape';
export { isClosed, localPath, reassignIds, shapeBounds, shapeGeometry } from './model/shape';
export { nextId, resetIds } from './model/ids';
export type { ArtItem, ArtLibrary } from './model/art';
export {
  addArtItem,
  ART_LIBRARY_VERSION,
  artCategories,
  artItemsByCategory,
  deserializeArtLibrary,
  emptyArtLibrary,
  getArtItem,
  removeArtItem,
  serializeArtLibrary,
} from './model/art';
export type { Document, Layer, Units } from './model/document';
export {
  addLayer,
  addShape,
  createDocument,
  createLayer,
  documentBounds,
  findShape,
  forEachLeaf,
  getLayer,
  insertShape,
  leafGeometries,
  removeLayer,
  removeShape,
  replaceShape,
} from './model/document';
export { rotatedShape, scaledShape, translatedShape } from './model/transform';
export type { NodeRef, HandleSide } from './model/nodeedit';
export {
  deleteNode,
  insertNode,
  moveHandle,
  moveNode,
  nodeCount,
  nodePosition,
  setSegmentType,
  setSubpathClosed,
  subpathNodes,
  toEditablePath,
} from './model/nodeedit';
export type { AlignMode, DistributeMode } from './model/align';
export { align, distribute } from './model/align';
export type { SnapConfig, SnapResult } from './model/snapping';
export { fromMm, MM_PER_INCH, snapPoint, toMm } from './model/snapping';
export type { ShapeInit } from './model/factory';
export {
  createEllipse,
  createGroup,
  createImage,
  createPath,
  createPolygon,
  createPolyline,
  createRect,
} from './model/factory';
export type { LineBatch } from './render';
export { sceneToLineBatches } from './render';
export type { Command } from './history/history';
export { composite, History } from './history/history';
export {
  addLayerCommand,
  addShapeCommand,
  removeShapeCommand,
  updateLayerCommand,
  updateShapeCommand,
} from './history/commands';
