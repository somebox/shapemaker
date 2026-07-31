/**
 * Group skeleton faces by side count for the compact face stepper.
 */

const LABELS = {
  3: "triangle",
  4: "quad",
  5: "pentagon",
  6: "hexagon",
};

/**
 * @param {number[][]} faces
 * @returns {{ sides: number, label: string, indices: number[] }[]}
 */
export function faceFamilies(faces) {
  /** @type {Map<number, number[]>} */
  const bySides = new Map();
  for (let i = 0; i < faces.length; i++) {
    const s = faces[i].length;
    let list = bySides.get(s);
    if (!list) {
      list = [];
      bySides.set(s, list);
    }
    list.push(i);
  }
  return [...bySides.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([sides, indices]) => ({
      sides,
      label: LABELS[sides] || `${sides}-gon`,
      indices,
    }));
}

/**
 * Locate faceIndex within families for stepper readout.
 * @param {{ sides: number, label: string, indices: number[] }[]} families
 * @param {number} faceIndex
 */
export function locateFace(families, faceIndex) {
  for (let fi = 0; fi < families.length; fi++) {
    const k = families[fi].indices.indexOf(faceIndex);
    if (k >= 0) {
      return {
        familyIndex: fi,
        indexInFamily: k,
        family: families[fi],
      };
    }
  }
  return {
    familyIndex: 0,
    indexInFamily: 0,
    family: families[0],
  };
}
