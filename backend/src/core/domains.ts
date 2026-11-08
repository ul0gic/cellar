import { register as registerAuth } from '../auth/routes.ts';
import { register as registerHousehold } from '../household/routes.ts';
import { register as registerMedia } from '../media/routes.ts';
import { register as registerShelf } from '../shelf/routes.ts';
import { register as registerRecipes } from '../recipes/routes.ts';
import { register as registerSearch } from '../search/routes.ts';
import { register as registerMenus } from '../menus/routes.ts';
import { register as registerWishlists } from '../wishlists/routes.ts';
import { register as registerHomeStats } from '../home-stats/routes.ts';
import { register as registerCalculators } from '../calculators/routes.ts';
import { register as registerImportExport } from '../import-export/routes.ts';
import { register as registerBackup } from '../backup/routes.ts';
import { register as registerCatalog } from '../catalog/routes.ts';
import { register as registerAi } from '../ai/routes.ts';
import type { RouteModule } from './route.ts';

export const domains: readonly RouteModule[] = [
  { register: registerAuth },
  { register: registerHousehold },
  { register: registerMedia },
  { register: registerShelf },
  { register: registerRecipes },
  { register: registerSearch },
  { register: registerMenus },
  { register: registerWishlists },
  { register: registerHomeStats },
  { register: registerCalculators },
  { register: registerImportExport },
  { register: registerBackup },
  { register: registerCatalog },
  { register: registerAi },
];
