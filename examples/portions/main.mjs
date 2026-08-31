import assert from 'node:assert/strict';
import { FoodPortion } from '../../dist/index.js';

// Synthetic hydrated food. No credentials, environment files, or HTTP calls.
const food = {
  id: 42, name: 'Example food',
  nutrients: { calories: { value: 100, unit: 'cal' }, protein: { value: 10, unit: 'g' } },
  glycemicIndex: 50, glycemicLoad: 8,
  servings: [
    { id: 1, quantity: 1, unit: 'slice', scalingFactor: 1, weightGrams: 50, isPrimary: true },
    { id: 2, quantity: 2, unit: 'pieces', scalingFactor: 3, weightGrams: 120, isPrimary: false },
  ],
};
const portion = FoodPortion.from(food, { servingId: 2, quantity: 4 });
assert.equal(portion.nutrition.calories.value, 600);
assert.equal(portion.totalWeightGrams, 240);
assert.deepEqual(portion.selection, { id: 42, serving: { id: 2, quantity: 4 } });
console.log(JSON.stringify(portion, null, 2));
