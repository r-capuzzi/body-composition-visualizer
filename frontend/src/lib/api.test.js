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
