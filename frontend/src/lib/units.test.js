import {
  cmToFeetInches,
  feetInchesToCm,
  kgToLb,
  lbToKg,
} from "./units";

test("feetInchesToCm matches known heights", () => {
  expect(feetInchesToCm(5, 10)).toBeCloseTo(177.8, 1);
  expect(feetInchesToCm(6, 0)).toBeCloseTo(182.88, 2);
  expect(feetInchesToCm(0, 70)).toBeCloseTo(177.8, 1); // inches-only
});

test("weight conversions round-trip", () => {
  expect(lbToKg(kgToLb(80))).toBeCloseTo(80, 6);
  expect(kgToLb(100)).toBeCloseTo(220.462, 2);
});

test("cmToFeetInches splits correctly and round-trips", () => {
  const { feet, inches } = cmToFeetInches(177.8);
  expect(feet).toBe(5);
  expect(inches).toBeCloseTo(10, 1);
  expect(feetInchesToCm(feet, inches)).toBeCloseTo(177.8, 1);
});
