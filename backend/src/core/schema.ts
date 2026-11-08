export const SCHEMA_VERSION = 1;

const PROVENANCE = `
  catalog_key TEXT UNIQUE NULL,
  catalog_rev TEXT NULL,
  catalog_version TEXT NULL,
  edited_at TEXT NULL`;

function taxonomyTable(name: string, extra: string): string {
  return `CREATE TABLE ${name} (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  folded_name TEXT NOT NULL UNIQUE,${extra}${PROVENANCE},
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);`;
}

const TABLES = `
CREATE TABLE schema_meta (
  id INTEGER PRIMARY KEY,
  version INTEGER NOT NULL,
  applied_at TEXT NOT NULL
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE members (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  folded_name TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL,
  password_hash TEXT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  avatar_image_id INTEGER NULL REFERENCES images(id) ON DELETE SET NULL,
  preferred_unit TEXT NOT NULL DEFAULT 'oz',
  theme TEXT NOT NULL DEFAULT 'system',
  default_visibility TEXT NOT NULL DEFAULT 'household',
  show_prices INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  via TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT NOT NULL
);

CREATE TABLE api_tokens (
  id INTEGER PRIMARY KEY,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  prefix TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  last_used_at TEXT NULL,
  revoked_at TEXT NULL
);

CREATE TABLE images (
  id INTEGER PRIMARY KEY,
  file_name TEXT NOT NULL UNIQUE,
  media_type TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  width INTEGER NULL,
  height INTEGER NULL,
  thumbhash TEXT NULL,
  purpose TEXT NOT NULL,
  uploaded_by INTEGER NULL REFERENCES members(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);

${taxonomyTable(
  'glasses',
  `
  description TEXT NOT NULL DEFAULT '',
  volume_ml REAL NULL,`,
)}

${taxonomyTable(
  'methods',
  `
  dilution_percent REAL NOT NULL,`,
)}

${taxonomyTable(
  'utensils',
  `
  description TEXT NOT NULL DEFAULT '',`,
)}

${taxonomyTable('tags', '')}

${taxonomyTable('taste_descriptors', '')}

CREATE TABLE calculators (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  inputs_json TEXT NOT NULL,
  outputs_json TEXT NOT NULL,
  created_by INTEGER NULL REFERENCES members(id) ON DELETE SET NULL,${PROVENANCE},
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE ingredients (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  folded_name TEXT NOT NULL,
  parent_id INTEGER NULL REFERENCES ingredients(id) ON DELETE SET NULL,
  strength REAL NOT NULL DEFAULT 0,
  description TEXT NOT NULL DEFAULT '',
  color TEXT NULL,
  origin TEXT NULL,
  default_unit TEXT NULL,
  image_id INTEGER NULL REFERENCES images(id) ON DELETE SET NULL,
  on_hand INTEGER NOT NULL DEFAULT 0,
  on_hand_set_by INTEGER NULL,
  on_hand_set_at TEXT NULL,
  created_by INTEGER NULL,${PROVENANCE},
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX ingredients_parent_id ON ingredients(parent_id);
CREATE INDEX ingredients_folded_name ON ingredients(folded_name);
CREATE INDEX ingredients_on_hand ON ingredients(on_hand);

CREATE TABLE ingredient_parts (
  ingredient_id INTEGER NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  part_ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
  amount REAL NULL,
  unit TEXT NULL,
  PRIMARY KEY (ingredient_id, position)
);

CREATE TABLE recipes (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  folded_name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  instructions TEXT NOT NULL,
  garnish TEXT NOT NULL DEFAULT '',
  glass_id INTEGER NULL REFERENCES glasses(id) ON DELETE SET NULL,
  method_id INTEGER NULL REFERENCES methods(id) ON DELETE SET NULL,
  year INTEGER NULL,
  source TEXT NOT NULL DEFAULT '',
  parent_recipe_id INTEGER NULL REFERENCES recipes(id) ON DELETE SET NULL,
  created_by INTEGER NULL,${PROVENANCE},
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX recipes_folded_name ON recipes(folded_name);
CREATE INDEX recipes_created_at ON recipes(created_at);

CREATE TABLE recipe_lines (
  id INTEGER PRIMARY KEY,
  recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
  amount REAL NULL,
  amount_max REAL NULL,
  unit TEXT NULL,
  optional INTEGER NOT NULL DEFAULT 0,
  specified INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX recipe_lines_recipe_id_position ON recipe_lines(recipe_id, position);
CREATE INDEX recipe_lines_ingredient_id ON recipe_lines(ingredient_id);

CREATE TABLE recipe_line_substitutes (
  line_id INTEGER NOT NULL REFERENCES recipe_lines(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
  amount REAL NULL,
  amount_max REAL NULL,
  unit TEXT NULL,
  PRIMARY KEY (line_id, position)
);
CREATE INDEX recipe_line_substitutes_ingredient_id ON recipe_line_substitutes(ingredient_id);

CREATE TABLE recipe_images (
  recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  image_id INTEGER NOT NULL REFERENCES images(id),
  position INTEGER NOT NULL,
  PRIMARY KEY (recipe_id, position)
);

CREATE TABLE recipe_tags (
  recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (recipe_id, tag_id)
);

CREATE TABLE recipe_utensils (
  recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  utensil_id INTEGER NOT NULL REFERENCES utensils(id) ON DELETE CASCADE,
  PRIMARY KEY (recipe_id, utensil_id)
);

CREATE TABLE catalog_deletions (
  type TEXT NOT NULL,
  key TEXT NOT NULL,
  deleted_at TEXT NOT NULL,
  PRIMARY KEY (type, key)
);

CREATE TABLE catalog_loads (
  version TEXT PRIMARY KEY,
  loaded_at TEXT NOT NULL,
  counts_json TEXT NOT NULL
);

CREATE TABLE bottles (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
  labeled_size TEXT NOT NULL,
  volume_ml REAL NULL,
  abv REAL NULL,
  price_paid_minor INTEGER NULL,
  purchased_on TEXT NULL,
  opened_on TEXT NULL,
  finished_on TEXT NULL,
  status TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  image_id INTEGER NULL REFERENCES images(id) ON DELETE SET NULL,
  created_by INTEGER NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX bottles_ingredient_id_status ON bottles(ingredient_id, status);
CREATE INDEX bottles_status_finished_on ON bottles(status, finished_on);

CREATE TABLE household_substitutions (
  id INTEGER PRIMARY KEY,
  on_hand_ingredient_id INTEGER NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
  for_ingredient_id INTEGER NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
  effect TEXT NOT NULL,
  created_by INTEGER NULL,
  created_at TEXT NOT NULL,
  UNIQUE (on_hand_ingredient_id, for_ingredient_id)
);

CREATE TABLE shopping_items (
  id INTEGER PRIMARY KEY,
  ingredient_id INTEGER NOT NULL UNIQUE REFERENCES ingredients(id) ON DELETE CASCADE,
  count INTEGER NOT NULL DEFAULT 1,
  added_by INTEGER NULL REFERENCES members(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE wishlist_items (
  id INTEGER PRIMARY KEY,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  name TEXT NOT NULL,
  ingredient_id INTEGER NULL REFERENCES ingredients(id) ON DELETE SET NULL,
  note TEXT NOT NULL DEFAULT '',
  url TEXT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE ratings (
  id INTEGER PRIMARY KEY,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL,
  target_id INTEGER NOT NULL,
  value REAL NOT NULL,
  visibility TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (member_id, target_type, target_id)
);
CREATE INDEX ratings_target_type_target_id_visibility ON ratings(target_type, target_id, visibility);

CREATE TABLE notes (
  id INTEGER PRIMARY KEY,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL,
  target_id INTEGER NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  tasted_on TEXT NOT NULL,
  verdict TEXT NULL,
  visibility TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX notes_target_type_target_id_created_at ON notes(target_type, target_id, created_at);

CREATE TABLE note_descriptors (
  note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  descriptor_id INTEGER NOT NULL REFERENCES taste_descriptors(id) ON DELETE CASCADE,
  PRIMARY KEY (note_id, descriptor_id)
);

CREATE TABLE favorites (
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (member_id, recipe_id)
);

CREATE TABLE made_it (
  id INTEGER PRIMARY KEY,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  made_at TEXT NOT NULL
);
CREATE INDEX made_it_recipe_id_made_at ON made_it(recipe_id, made_at);

CREATE TABLE collections (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_by INTEGER NULL REFERENCES members(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE collection_recipes (
  collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  PRIMARY KEY (collection_id, recipe_id)
);

CREATE TABLE menus (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  date TEXT NOT NULL,
  is_live INTEGER NOT NULL DEFAULT 0,
  token TEXT NULL UNIQUE,
  live_since TEXT NULL,
  created_by INTEGER NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE menu_sections (
  id INTEGER PRIMARY KEY,
  menu_id INTEGER NOT NULL REFERENCES menus(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  name TEXT NOT NULL
);

CREATE TABLE menu_items (
  id INTEGER PRIMARY KEY,
  section_id INTEGER NOT NULL REFERENCES menu_sections(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  kind TEXT NOT NULL,
  recipe_id INTEGER NULL REFERENCES recipes(id) ON DELETE CASCADE,
  ingredient_id INTEGER NULL REFERENCES ingredients(id) ON DELETE CASCADE,
  host_note TEXT NOT NULL DEFAULT '',
  hide_when_unavailable INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE notifications (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,
  version TEXT NULL,
  message TEXT NULL,
  created_at TEXT NOT NULL,
  dismissed_at TEXT NULL
);
`;

const FTS_OPTIONS = "tokenize = 'unicode61 remove_diacritics 2', prefix = '2 3'";

function refreshRecipes(ids: string): string {
  return `
  DELETE FROM recipes_fts WHERE rowid IN ${ids};
  INSERT INTO recipes_fts(rowid, recipe_id, name, tags, ingredients)
  SELECT r.id, r.id, r.name,
    COALESCE((SELECT group_concat(t.name, ' ') FROM recipe_tags rt JOIN tags t ON t.id = rt.tag_id WHERE rt.recipe_id = r.id), ''),
    COALESCE((SELECT group_concat(i.name, ' ') FROM recipe_lines l JOIN ingredients i ON i.id = l.ingredient_id WHERE l.recipe_id = r.id), '')
  FROM recipes r WHERE r.id IN ${ids};`;
}

function ingredientAndDescendants(id: string): string {
  return `(SELECT id FROM (WITH RECURSIVE down(id) AS (SELECT ${id} UNION SELECT c.id FROM ingredients c JOIN down ON c.parent_id = down.id) SELECT id FROM down))`;
}

function refreshIngredients(ids: string): string {
  return `
  DELETE FROM ingredients_fts WHERE rowid IN ${ids};
  INSERT INTO ingredients_fts(rowid, ingredient_id, name, ancestors)
  SELECT i.id, i.id, i.name,
    COALESCE((SELECT group_concat(name, ' ') FROM (WITH RECURSIVE up(id, depth) AS (SELECT i.parent_id, 0 UNION ALL SELECT p.parent_id, up.depth + 1 FROM ingredients p JOIN up ON p.id = up.id WHERE up.depth < 10) SELECT a.name FROM up JOIN ingredients a ON a.id = up.id)), '')
  FROM ingredients i WHERE i.id IN ${ids};`;
}

function refreshBottle(id: string): string {
  return `
  DELETE FROM bottles_fts WHERE rowid = ${id};
  INSERT INTO bottles_fts(rowid, bottle_id, name) SELECT b.id, b.id, b.name FROM bottles b WHERE b.id = ${id} AND b.status <> 'finished';`;
}

const RECIPES_USING_INGREDIENT = '(SELECT recipe_id FROM recipe_lines WHERE ingredient_id = new.id)';

const SEARCH = `
CREATE VIRTUAL TABLE recipes_fts USING fts5(recipe_id UNINDEXED, name, tags, ingredients, ${FTS_OPTIONS});
CREATE VIRTUAL TABLE ingredients_fts USING fts5(ingredient_id UNINDEXED, name, ancestors, ${FTS_OPTIONS});
CREATE VIRTUAL TABLE bottles_fts USING fts5(bottle_id UNINDEXED, name, ${FTS_OPTIONS});
CREATE VIRTUAL TABLE recipes_fts_v USING fts5vocab(recipes_fts, 'row');
CREATE VIRTUAL TABLE ingredients_fts_v USING fts5vocab(ingredients_fts, 'row');
CREATE VIRTUAL TABLE bottles_fts_v USING fts5vocab(bottles_fts, 'row');

CREATE TRIGGER recipes_fts_insert AFTER INSERT ON recipes BEGIN${refreshRecipes('(new.id)')}
END;
CREATE TRIGGER recipes_fts_update AFTER UPDATE OF name ON recipes BEGIN${refreshRecipes('(new.id)')}
END;
CREATE TRIGGER recipes_fts_delete AFTER DELETE ON recipes BEGIN
  DELETE FROM recipes_fts WHERE rowid = old.id;
END;

CREATE TRIGGER recipe_lines_fts_insert AFTER INSERT ON recipe_lines BEGIN${refreshRecipes('(new.recipe_id)')}
END;
CREATE TRIGGER recipe_lines_fts_update AFTER UPDATE OF recipe_id, ingredient_id ON recipe_lines BEGIN${refreshRecipes('(old.recipe_id, new.recipe_id)')}
END;
CREATE TRIGGER recipe_lines_fts_delete AFTER DELETE ON recipe_lines BEGIN${refreshRecipes('(old.recipe_id)')}
END;

CREATE TRIGGER recipe_tags_fts_insert AFTER INSERT ON recipe_tags BEGIN${refreshRecipes('(new.recipe_id)')}
END;
CREATE TRIGGER recipe_tags_fts_update AFTER UPDATE ON recipe_tags BEGIN${refreshRecipes('(old.recipe_id, new.recipe_id)')}
END;
CREATE TRIGGER recipe_tags_fts_delete AFTER DELETE ON recipe_tags BEGIN${refreshRecipes('(old.recipe_id)')}
END;

CREATE TRIGGER tags_fts_update AFTER UPDATE OF name ON tags BEGIN${refreshRecipes('(SELECT recipe_id FROM recipe_tags WHERE tag_id = new.id)')}
END;

CREATE TRIGGER ingredients_fts_insert AFTER INSERT ON ingredients BEGIN${refreshIngredients('(new.id)')}
END;
CREATE TRIGGER ingredients_fts_update AFTER UPDATE OF name, parent_id ON ingredients BEGIN${refreshIngredients(
  ingredientAndDescendants('new.id'),
)}${refreshRecipes(RECIPES_USING_INGREDIENT)}
END;
CREATE TRIGGER ingredients_fts_delete AFTER DELETE ON ingredients BEGIN
  DELETE FROM ingredients_fts WHERE rowid = old.id;
END;

CREATE TRIGGER bottles_fts_insert AFTER INSERT ON bottles BEGIN${refreshBottle('new.id')}
END;
CREATE TRIGGER bottles_fts_update AFTER UPDATE OF name, status ON bottles BEGIN${refreshBottle('new.id')}
END;
CREATE TRIGGER bottles_fts_delete AFTER DELETE ON bottles BEGIN
  DELETE FROM bottles_fts WHERE rowid = old.id;
END;
`;

export const SCHEMA_V1_SQL = `${TABLES}${SEARCH}`;
