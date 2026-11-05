import test from "node:test";
import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { arcPath, donutSlices, linePath, linearScale, niceMax, thinLabels } from "./chart-geometry.ts";

test("linearScale maps ends", () => {
  const s = linearScale([0, 100], [10, 210]);
  strictEqual(s(0), 10);
  strictEqual(s(100), 210);
  strictEqual(s(50), 110);
});

test("linearScale with zero-width domain maps to range start", () => {
  strictEqual(linearScale([5, 5], [0, 100])(5), 0);
});

test("niceMax rounds up to a clean number", () => {
  strictEqual(niceMax([37]), 40);
  strictEqual(niceMax([0.8]), 1);
  strictEqual(niceMax([120, null]), 200);
  strictEqual(niceMax([2.2]), 2.5);
  strictEqual(niceMax([null, null]), 1);
});

test("niceMax percent caps at 100", () => {
  strictEqual(niceMax([37, 64], { percent: true }), 100);
});

test("arcPath 0→90 ends at 3 o'clock", () => {
  const d = arcPath(50, 50, 40, 0, 90);
  strictEqual(d.startsWith("M 50 10"), true);
  strictEqual(d.endsWith("90 50"), true);
});

test("donutSlices pct sums to 100 and zero-sum gives []", () => {
  const slices = donutSlices([{ label: "a", value: 1 }, { label: "b", value: 3 }]);
  deepStrictEqual(slices.map((s) => [s.start, s.end, s.pct]), [[0, 90, 25], [90, 360, 75]]);
  deepStrictEqual(donutSlices([{ label: "a", value: 0 }]), []);
});

test("linePath breaks at null", () => {
  const d = linePath([{ x: 0, y: 1 }, { x: 1, y: 2 }, { x: 2, y: null }, { x: 3, y: 4 }, { x: 4, y: 5 }]);
  strictEqual((d.match(/M/g) ?? []).length, 2);
  strictEqual(d, "M 0 1 L 1 2 M 3 4 L 4 5");
});

test("thinLabels keeps at most n evenly spaced, always the last", () => {
  deepStrictEqual(thinLabels(20, 8).length <= 8, true);
  strictEqual(thinLabels(20, 8).at(-1), 19);
  deepStrictEqual(thinLabels(3, 8), [0, 1, 2]);
});
