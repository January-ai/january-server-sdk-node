import type { FoodSearchItem, FoodSelection, NutritionFacts, ServingOption } from './generated/models.js';

export type FoodPortionErrorCode =
  | 'no_servings'
  | 'serving_not_found'
  | 'invalid_serving'
  | 'invalid_quantity';

export interface FoodPortionOptions {
  servingId?: number;
  quantity?: number;
}

/** A validated serving and quantity with locally calculated nutrition. No API call is made. */
export class FoodPortion {
  readonly foodId: number;
  readonly serving: ServingOption;
  readonly quantity: number;
  readonly nutrition: NutritionFacts;
  readonly totalWeightGrams: number | null;
  readonly glycemicIndex: number | null;
  readonly glycemicLoad: number | null;
  /** The exact selection accepted by food-log and glucose-prediction requests. */
  readonly selection: FoodSelection;

  private constructor(food: FoodSearchItem, serving: ServingOption, quantity: number) {
    const scale = quantity * serving.scalingFactor / serving.quantity;
    this.foodId = food.id;
    this.serving = { ...serving };
    this.quantity = quantity;
    this.nutrition = scaleNutrition(food.nutrients ?? legacyNutrition(food), scale);
    this.totalWeightGrams = serving.weightGrams == null
      ? null : serving.weightGrams * quantity / serving.quantity;
    this.glycemicIndex = food.glycemicIndex ?? null;
    this.glycemicLoad = food.glycemicLoad == null ? null : food.glycemicLoad * scale;
    this.selection = { id: food.id, serving: { id: serving.id, quantity } };
  }

  /** Defaults to the primary (or first) serving and that serving's listed quantity. */
  static from(food: FoodSearchItem, options: FoodPortionOptions = {}): FoodPortion {
    if (food.servings.length === 0) throw new FoodPortionError('no_servings');
    const serving = options.servingId === undefined
      ? food.servings.find(item => item.isPrimary) ?? food.servings[0]
      : food.servings.find(item => item.id === options.servingId);
    if (!serving) throw new FoodPortionError('serving_not_found');
    if (!Number.isFinite(serving.quantity) || serving.quantity <= 0
      || !Number.isFinite(serving.scalingFactor) || serving.scalingFactor <= 0) {
      throw new FoodPortionError('invalid_serving');
    }
    const quantity = options.quantity ?? serving.quantity;
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 10_000) {
      throw new FoodPortionError('invalid_quantity');
    }
    return new FoodPortion(food, serving, quantity);
  }
}

export class FoodPortionError extends TypeError {
  constructor(readonly code: FoodPortionErrorCode) {
    super(`Invalid food portion: ${code}`);
    this.name = 'FoodPortionError';
  }
}

const nutrientNames = [
  'calories', 'protein', 'carbohydrates', 'netCarbohydrates', 'totalFat', 'transFat',
  'saturatedFat', 'fiber', 'totalSugars', 'addedSugars', 'cholesterol', 'calcium',
  'iron', 'potassium', 'sodium', 'vitaminD',
] as const satisfies readonly (keyof NutritionFacts)[];

function scaleNutrition(nutrition: NutritionFacts, scale: number): NutritionFacts {
  const result: NutritionFacts = {};
  for (const name of nutrientNames) {
    const amount = nutrition[name];
    if (amount !== undefined) result[name] = { value: amount.value * scale, unit: amount.unit };
  }
  return result;
}

function legacyNutrition(food: FoodSearchItem): NutritionFacts {
  const result: NutritionFacts = {};
  const units = {
    calories: 'cal', protein: 'g', carbohydrates: 'g', netCarbohydrates: 'g',
    totalFat: 'g', saturatedFat: 'g', fiber: 'g', totalSugars: 'g', addedSugars: 'g',
    cholesterol: 'mg', potassium: 'mg', sodium: 'mg',
  } as const;
  for (const name of Object.keys(units) as (keyof typeof units)[]) {
    const value = food[name];
    if (value != null) result[name] = { value, unit: units[name] };
  }
  return result;
}
