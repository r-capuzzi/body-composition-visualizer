import { describeValidationError } from "./api";

// Real payloads copied from FastAPI's 422 responses, so these stay honest about
// the shape the backend actually sends rather than one we imagined.

describe("describeValidationError", () => {
  test("labels a field error in human terms", () => {
    expect(
      describeValidationError({
        loc: ["body", "body_fat_pct"],
        msg: "Input should be less than or equal to 60",
      })
    ).toBe("Body fat %: must be less than or equal to 60");
  });

  test("a cross-field error drops the meaningless 'body' prefix", () => {
    // Pydantic model_validator errors report loc ["body"] and prefix the
    // message with "Value error, " - rendered raw, that read as
    // "body: Value error, Height and weight combine to...".
    expect(
      describeValidationError({
        loc: ["body"],
        msg: "Value error, Height and weight combine to an implausible BMI of 5 - please double-check them",
      })
    ).toBe(
      "Height and weight combine to an implausible BMI of 5 - please double-check them"
    );
  });

  test("states a weight bound in both units, since the bound is metric but the user may not be", () => {
    // An imperial user who clears the field to retype it sees this; "30" alone
    // reads as 30 lb, when the real floor is 30 kg.
    expect(
      describeValidationError({ loc: ["body", "weight_kg"], msg: "Input should be greater than 30" })
    ).toBe("Weight: must be greater than 30 kg (66 lb)");
  });

  test("states a height bound in both units", () => {
    expect(
      describeValidationError({ loc: ["body", "height_cm"], msg: "Input should be less than 250" })
    ).toBe("Height: must be less than 250 cm (8 ft 2 in)");
  });

  test("falls back to the raw field name when it has no friendly label", () => {
    expect(
      describeValidationError({ loc: ["body", "some_new_field"], msg: "Input should be a number" })
    ).toBe("some_new_field: must be a number");
  });

  test("returns empty string for a malformed entry rather than 'undefined'", () => {
    expect(describeValidationError({})).toBe("");
    expect(describeValidationError(null)).toBe("");
  });
});
