import { scopedPrisma, EXEMPT_MODELS } from "./tenant-extension.js";

export { EXEMPT_MODELS };

export function getScopedPrisma() {
  return scopedPrisma;
}
