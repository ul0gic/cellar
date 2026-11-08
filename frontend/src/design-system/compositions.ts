import View from '@lightstart/light';
import { clBulb } from './cl-bulb.ts';
import { clFigure } from './cl-figure.ts';
import { clHaveBar } from './cl-have-bar.ts';
import { clImageField, registerImageField } from './cl-image-field.ts';
import { clIngredientLine } from './cl-ingredient-line.ts';
import { clLiveCard } from './cl-live-card.ts';
import { clPlate } from './cl-plate.ts';
import { clQr } from './cl-qr.ts';
import { clRecipeCard } from './cl-recipe-card.ts';
import { clRecipeRow } from './cl-recipe-row.ts';
import { clStackedBar } from './cl-stacked-bar.ts';
import { clStatusPill } from './cl-status-pill.ts';
import { clTypedConfirm } from './cl-typed-confirm.ts';

export function defineCompositions(): void {
  View.define(clBulb);
  View.define(clHaveBar);
  View.define(clStatusPill);
  View.define(clPlate);
  View.define(clFigure);
  View.define(clRecipeCard);
  View.define(clRecipeRow);
  View.define(clIngredientLine);
  View.define(clQr);
  View.define(clLiveCard);
  View.define(clStackedBar);
  View.define(clTypedConfirm);
  View.define(clImageField);
  registerImageField();
}
