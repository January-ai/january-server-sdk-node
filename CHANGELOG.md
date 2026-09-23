# Changelog

## Unreleased

## 0.2.0 - 2026-09-23

### Breaking changes

The v1.2 API changed the shape of analysis results, logged foods and scan
corrections. TypeScript code written against 0.1.0 may need these updates:

- `ServingDetails` is removed. `LoggedFood.serving` is now a `ServingSummary`, the
  same serving type analysis results use, including `weightGrams`.
- These fields are always present and never null, so their types are `string` or
  `number` instead of `... | null`: `DetectedFood.id` and `.quantity`,
  `ServingSummary.id` and `.quantity`, `ServingOption.id`, `AlternativeFood.id`,
  `RestaurantMenuItem.id` and `LoggedFood.foodId`. Strict comparisons of these
  fields with `null` no longer compile; remove them.
- `CorrectPhotoScanRequest.analysis` is a `CorrectionAnalysis` instead of a
  `FoodScan`. A `FoodScan` the SDK returned is still accepted as is.

### Added

- Water logs: `waterLogs.create`, `waterLogs.list` (one total per local day in the
  requested unit) and `waterLogs.delete` (deleting an unknown log also succeeds).
  Amounts are in `fl_oz`, `cup` or `ml`.
- Weight logs: `weightLogs.create` and `weightLogs.list` (latest weight per local
  day). The API has no weight-log deletion.
- The `water_logs:read`, `water_logs:write`, `weight_logs:read` and
  `weight_logs:write` client-token scopes.
- `CreditPlan`, `NutrientUnit` and `VolumeUnit` constants for the documented
  values; unknown values the API adds later are kept as returned.

### Changed

- Photo analysis uses the reasoning-based analyzer when `reasoning` is omitted,
  as the API now defaults to it. Pass `reasoning: { effort: 'none' }` for the
  standard analyzer. The SDK sends `reasoning` only when you set it.
- A water amount must be within its unit's range (1–811.5 `fl_oz`, 0.125–101.4
  `cup`, 30–24000 `ml`), a weight log within 10–1000 `lb` or 4.5–453.6 `kg`, a
  glucose profile's weight within 2–1500 `lb` or 1–700 `kg` and its height within
  20–108 `in` or 50–275 `cm`, and a food or serving quantity must be greater than
  zero. Food and serving IDs must be 1–10 digits without a leading zero. These
  throw `JanuaryValidationError` before any request.
- Token creation and food, water and weight-log creation are never replayed after
  an ambiguous failure (a timeout, lost response or 5xx reply). A 429
  `rate_limited` reply recorded nothing, so it is retried within `maxRetries`.
- `foodLogs.update` rejects an update that sets no field before sending it.

## 0.1.0 - 2026-09-16

Initial public release.
