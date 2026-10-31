/**
 * Length of a 2D vector. Math.hypot isn't inlined by V8: its builtin boxes
 * both arguments and allocates on every call, which made it the largest
 * source of garbage in the sim's per-step loops. Math.sqrt of the sum of
 * squares inlines, allocates nothing and is bit-identical across engines.
 */
export function len2(x: number, z: number): number {
  return Math.sqrt(x * x + z * z);
}
