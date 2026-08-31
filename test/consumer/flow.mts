import { January, FoodPortion, FoodPortionError, type JanuaryUserClient, type FoodPortionOptions, type FoodSearchResults, type PartnerUserContext, type PredictGlucoseRequest } from '@january-ai/server';

export async function flow(baseUrl: string) {
  const client = new January({ secretKey: 'sk-local-only', baseUrl });
  const context: PartnerUserContext = { endUserId: 'installed-consumer', endUserTimezone: 'America/New_York' };
  const user: JanuaryUserClient = client.forUser(context);
  const foods: FoodSearchResults = await user.foods.search({ query: 'banana' });
  if (!foods.items.length) throw new Error('Expected a food result');
  const options: FoodPortionOptions = { quantity: 2 };
  const portion = FoodPortion.from(foods.items[0]!, options);
  if (portion.selection.serving.quantity !== 2) throw new Error('Portion calculation failed');
  const predictionFoods: PredictGlucoseRequest['foods'] = [portion.selection];
  void predictionFoods;
  try {
    FoodPortion.from(foods.items[0]!, { quantity: 0 });
    throw new Error('Invalid portion was accepted');
  } catch (error) {
    if (!(error instanceof FoodPortionError) || error.code !== 'invalid_quantity') throw error;
  }
  const token = await client.mintClientToken({ endUserId: context.endUserId, ttlSeconds: 1800 });
  if (!token.token || token.$metadata.status !== 201) throw new Error('Token operation failed');
  const analysis = await user.foodAnalysis.analyzeDescription({ query: 'banana' });
  if (!analysis.detections.length) throw new Error('Analysis operation failed');
  const log = await user.foodLogs.create({ foods: [portion.selection] });
  if (!log.id) throw new Error('Log operation failed');
  const revoked = await client.revokeClientTokens({ endUserId: context.endUserId });
  if (revoked.revokedCount !== '3' || revoked.$metadata.status !== 204) throw new Error('Revocation metadata missing');
  const credits = await client.credits();
  if (typeof credits.usedCredits !== 'number') throw new Error('Credits operation failed');
  return 6;
}

// Compile-only negative surface tests.
function typesOnly(client: January) {
  const user: JanuaryUserClient = client.forUser('test');
  user.foodLogs.list({ start: '2026-08-29T00:00:00Z', end: '2026-08-30T00:00:00Z' });
  // Explicit generic arguments remain supported for existing consumers.
  const scoped: JanuaryUserClient<true> = user;
  const unscoped: JanuaryUserClient<false> = client;
  scoped.foodLogs.list({ start: '2026-08-29T00:00:00Z', end: '2026-08-30T00:00:00Z' });
  unscoped.foodLogs.list({ endUserId: 'test', start: '2026-08-29T00:00:00Z', end: '2026-08-30T00:00:00Z' });
  // @ts-expect-error An unscoped client still requires an explicit identity.
  unscoped.foodLogs.list({ start: '2026-08-29T00:00:00Z', end: '2026-08-30T00:00:00Z' });
  // @ts-expect-error Privileged operation is not available on a scoped view.
  user.mintClientToken({ endUserId: 'test' });
  // @ts-expect-error Identity cannot be overridden on the scoped type.
  user.foods.search({ query: 'banana', endUserId: 'other' });
  // @ts-expect-error Existing barcode input is upc, not barcode.
  client.foods.lookupBarcode({ barcode: '00123456' });
  // @ts-expect-error Existing description input is query, not description.
  client.foodAnalysis.analyzeDescription({ description: 'banana' });
}
void typesOnly;
