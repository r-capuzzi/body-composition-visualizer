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

test("the muscle morph is calibrated per sex: a median man and a median woman read alike", () => {
  // Schutz 2002 adult medians: FFMI 18.9 men, 15.4 women. Same relative
  // standing should mean the same morph strength on each sex's own mesh.
  const leanFor = (target, heightCm) => target * (heightCm / 100) ** 2;
  const man = bodyParamsFromStats({ lean_mass_kg: leanFor(18.9, 178), body_fat_pct: 20 }, 178, "male");
  const woman = bodyParamsFromStats({ lean_mass_kg: leanFor(15.4, 165), body_fat_pct: 28 }, 165, "female");
  expect(woman.muscle).toBeCloseTo(man.muscle, 2);
  // and an elite natural woman (~22) saturates it; she only reached 0.63 before
  const elite = bodyParamsFromStats({ lean_mass_kg: leanFor(22, 165), body_fat_pct: 20 }, 165, "female");
  expect(elite.muscle).toBe(1);
});

test("sex defaults to male, so existing callers are unchanged", () => {
  const p = { lean_mass_kg: 62, body_fat_pct: 20 };
  expect(bodyParamsFromStats(p, 178)).toEqual(bodyParamsFromStats(p, 178, "male"));
});

test("clamps extremes to the [0, 1] ends", () => {
  const huge = bodyParamsFromStats(
    { lean_mass_kg: 120, fat_mass_kg: 2, body_fat_pct: 3 },
    170
  );
  expect(huge.muscle).toBe(1);
  expect(huge.fat).toBe(0);
});
