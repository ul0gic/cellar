import type { Recipe, RecipeInput } from '@cellar/contract';

export function recipeInputOf(recipe: Recipe): RecipeInput {
  return {
    name: recipe.name,
    description: recipe.description,
    instructions: recipe.instructions,
    garnish: recipe.garnish,
    source: recipe.source,
    year: recipe.year,
    glassId: recipe.glass?.id ?? null,
    methodId: recipe.method?.id ?? null,
    utensilIds: recipe.utensils.map((utensil) => utensil.id),
    tags: recipe.tags.map((tag) => tag.name),
    imageIds: recipe.images.map((image) => image.id),
    parentId: recipe.parent?.id ?? null,
    lines: recipe.lines.map((line) => ({
      ingredientId: line.ingredient.id,
      amount: line.amount,
      amountMax: line.amountMax,
      unit: line.unit,
      optional: line.optional,
      specified: line.specified,
      note: line.note,
      substitutes: line.substitutes.map((substitute) => ({
        ingredientId: substitute.ingredient.id,
        amount: substitute.amount,
        amountMax: substitute.amountMax,
        unit: substitute.unit,
      })),
    })),
  };
}
