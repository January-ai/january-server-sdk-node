import assert from 'node:assert/strict';
import test from 'node:test';
import { FoodPortion, FoodPortionError } from '../dist/index.js';

const food = {
  id: '42', name: 'Test food',
  calories: 100, protein: 10, carbohydrates: 20, netCarbohydrates: 18,
  totalFat: 5, saturatedFat: 2, fiber: 2, totalSugars: 3, addedSugars: 1,
  sodium: 200, potassium: 300, cholesterol: 4,
  nutrients: { calories: { value: 100, unit: 'cal' }, protein: { value: 10, unit: 'g' } },
  glycemicIndex: 50, glycemicLoad: 8,
  servings: [
    { id: '1', quantity: 1, unit: 'slice', scalingFactor: 1, weightGrams: 50, isPrimary: true },
    { id: '2', quantity: 2, unit: 'pieces', scalingFactor: 3, weightGrams: 120, isPrimary: false },
  ],
};
const errorWithCode = code => error => error instanceof FoodPortionError
  && error instanceof TypeError && error.code === code;

test('FoodPortion defaults to primary serving and builds a request-ready selection', () => {
  const portion = FoodPortion.from({ ...food, servings: [...food.servings].reverse() });
  assert.equal(portion.foodId, '42');
  assert.equal(portion.serving.id, '1');
  assert.equal(portion.quantity, 1);
  assert.equal(portion.nutrition.calories.value, 100);
  assert.deepEqual(portion.selection, { foodId: '42', servingId: '1', quantity: 1 });
});

test('FoodPortion falls back to first serving and its listed quantity', () => {
  const portion = FoodPortion.from({ ...food, servings: [food.servings[1]] });
  assert.equal(portion.serving.id, '2');
  assert.equal(portion.quantity, 2);
  assert.equal(portion.nutrition.calories.value, 300);
});

test('FoodPortion matches client alternate-serving math without mutating input', () => {
  const source = structuredClone(food);
  const portion = FoodPortion.from(source, { servingId: '2', quantity: 4 });
  assert.equal(portion.nutrition.calories.value, 600);
  assert.equal(portion.nutrition.protein.value, 60);
  assert.equal(portion.totalWeightGrams, 240);
  assert.equal(portion.glycemicIndex, 50);
  assert.equal(portion.glycemicLoad, 48);
  assert.deepEqual(portion.selection, { foodId: '42', servingId: '2', quantity: 4 });
  assert.deepEqual(source, food);
  portion.nutrition.calories.value = 999;
  portion.serving.quantity = 999;
  assert.deepEqual(source, food);
});

test('FoodPortion scales all 16 nutrients while retaining their units', () => {
  const names = ['calories', 'protein', 'carbohydrates', 'netCarbohydrates', 'totalFat',
    'transFat', 'saturatedFat', 'fiber', 'totalSugars', 'addedSugars', 'cholesterol',
    'calcium', 'iron', 'potassium', 'sodium', 'vitaminD'];
  const nutrients = Object.fromEntries(names.map((name, i) => [name, { value: i + 1, unit: `unit-${i}` }]));
  const portion = FoodPortion.from({ ...food, nutrients }, { quantity: 0.5 });
  assert.deepEqual(portion.nutrition, Object.fromEntries(names.map((name, i) => [name, { value: (i + 1) / 2, unit: `unit-${i}` }])));
});

test('FoodPortion preserves omitted nutrients and measured zeros without legacy backfill', () => {
  const portion = FoodPortion.from({ ...food, nutrients: { protein: { value: 0, unit: 'g' } } }, { quantity: 2 });
  assert.deepEqual(portion.nutrition, { protein: { value: 0, unit: 'g' } });
  assert.equal(Object.hasOwn(portion.nutrition, 'calories'), false);
  assert.deepEqual(FoodPortion.from({ ...food, nutrients: {} }).nutrition, {});
});

test('FoodPortion retains client legacy fallback and its nutrient units', () => {
  const portion = FoodPortion.from({ ...food, nutrients: undefined, protein: null }, { quantity: 2 });
  assert.deepEqual(portion.nutrition.calories, { value: 200, unit: 'cal' });
  assert.deepEqual(portion.nutrition.sodium, { value: 400, unit: 'mg' });
  assert.deepEqual(portion.nutrition.totalFat, { value: 10, unit: 'g' });
  assert.equal(Object.hasOwn(portion.nutrition, 'protein'), false);
});

test('FoodPortion preserves unknown weight and glycemic values, and real zero values', () => {
  const source = { ...food, glycemicIndex: undefined, glycemicLoad: undefined,
    servings: [{ ...food.servings[0], weightGrams: null }] };
  const portion = FoodPortion.from(source);
  assert.equal(portion.totalWeightGrams, null);
  assert.equal(portion.glycemicIndex, null);
  assert.equal(portion.glycemicLoad, null);
  const zero = FoodPortion.from({ ...source, glycemicIndex: 0, glycemicLoad: 0,
    servings: [{ ...food.servings[0], weightGrams: 0 }] });
  assert.equal(zero.totalWeightGrams, 0);
  assert.equal(zero.glycemicIndex, 0);
  assert.equal(zero.glycemicLoad, 0);
});

test('FoodPortion rejects missing servings and unknown serving IDs', () => {
  assert.throws(() => FoodPortion.from({ ...food, servings: [] }), errorWithCode('no_servings'));
  assert.throws(() => FoodPortion.from(food, { servingId: '999' }), errorWithCode('serving_not_found'));
});

for (const quantity of [0, -1, NaN, Infinity, -Infinity, 10_000.01]) {
  test(`FoodPortion rejects quantity ${quantity}`, () => {
    assert.throws(() => FoodPortion.from(food, { quantity }), errorWithCode('invalid_quantity'));
  });
}
test('FoodPortion accepts the inclusive quantity limit and validates default quantity', () => {
  assert.equal(FoodPortion.from(food, { quantity: 10_000 }).quantity, 10_000);
  assert.throws(() => FoodPortion.from({ ...food, servings: [{ ...food.servings[0], quantity: 10_001 }] }), errorWithCode('invalid_quantity'));
});
for (const field of ['quantity', 'scalingFactor']) {
  for (const value of [0, -1, NaN, Infinity, -Infinity]) {
    test(`FoodPortion rejects serving ${field} ${value}`, () => {
      const source = { ...food, servings: [{ ...food.servings[0], [field]: value }] };
      assert.throws(() => FoodPortion.from(source), errorWithCode('invalid_serving'));
    });
  }
}
