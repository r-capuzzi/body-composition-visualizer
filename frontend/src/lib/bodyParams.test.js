import { bodyParamsFromStats, clamp01, ffmi } from "./bodyParams";

test("ffmi is lean mass over height squared (kg/m^2)", () => {
  // 64 kg lean, 1.8 m -> 64 / 3.24 ≈ 19.75
  expect(ffmi(64, 180)).toBeCloseTo(19.75, 2);
  // taller frame, same lean mass -> lower FFMI
  expect(ffmi(64, 195)).toBeLessThan(ffmi(64, 180));
});

test("clamp01 keeps values inside [0, 1]", () => {
  expect(clamp01(-3)).toBe(0);
  expect(clamp01(0.4)).toBe(0.4);
  expect(clamp01(9)).toBe(1);
});

test("bodyParamsFromStats returns muscle and fat in [0, 1]", () => {
  const point = { lean_mass_kg: 62, fat_mass_kg: 16, body_fat_pct: 20 };
  const { muscle, fat } = bodyParamsFromStats(point, 178);
  for (const v of [muscle, fat]) {
    expect(typeof v).toBe("number");
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(1);
  }
});

test("leaner and more muscular points read as lower fat / higher muscle", () => {
  const soft = bodyParamsFromStats(
    { lean_mass_kg: 55, fat_mass_kg: 25, body_fat_pct: 31 },
    178
  );
  const shredded = bodyParamsFromStats(
    { lean_mass_kg: 72, fat_mass_kg: 8, body_fat_pct: 10 },
    178
  );
  expect(shredded.fat).toBeLessThan(soft.fat);
  expect(shredded.muscle).toBeGreaterThan(soft.muscle);
});

test("clamps extremes to the [0, 1] ends", () => {
  const huge = bodyParamsFromStats(
    { lean_mass_kg: 120, fat_mass_kg: 2, body_fat_pct: 3 },
    170
  );
  expect(huge.muscle).toBe(1);
  expect(huge.fat).toBe(0);
});
