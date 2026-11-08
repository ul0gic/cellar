import type { HouseholdRating, Id, Note, Rating, RatingValue, TargetType } from '@cellar/contract';
import type { Database } from '../core/db.ts';
import { imageColumns, imageRowOrNull, num, oneOf, type Row, type ToImageRef, text, textOrNull } from './rows.ts';

export type { ToImageRef } from './rows.ts';

interface Target {
  readonly type: TargetType;
  readonly id: Id;
}

const VISIBLE = "(n.visibility = 'household' OR n.member_id = :viewer)";
const HOUSEHOLD_AVERAGE =
  "ROUND(AVG(value), 1) AS average FROM ratings WHERE visibility = 'household' AND target_type = ?";
const TARGET_TYPES = ['recipe', 'ingredient'] as const;
const VERDICTS = ['avoid', 'decent', 'recommend'] as const;
const VISIBILITIES = ['household', 'private'] as const;
const RATING_VALUES: readonly RatingValue[] = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];
const NOTE_SELECT = `SELECT n.id, n.member_id, n.target_type, n.target_id, n.text, n.tasted_on, n.verdict, n.visibility,
  n.created_at, n.updated_at, m.name AS author_name, ${imageColumns('a', 'avatar')}
  FROM notes n JOIN members m ON m.id = n.member_id LEFT JOIN images a ON a.id = m.avatar_image_id`;

function descriptorsOf(db: Database, noteIds: readonly Id[]): Map<Id, { id: Id; name: string }[]> {
  const byNote = new Map<Id, { id: Id; name: string }[]>();
  if (noteIds.length === 0) {
    return byNote;
  }
  const rows = db
    .prepare(
      `SELECT nd.note_id, d.id, d.name FROM note_descriptors nd JOIN taste_descriptors d ON d.id = nd.descriptor_id
       WHERE nd.note_id IN (SELECT value FROM json_each(?)) ORDER BY d.name, d.id`,
    )
    .all(JSON.stringify(noteIds));
  for (const row of rows) {
    const noteId = num(row, 'note_id');
    const list = byNote.get(noteId) ?? [];
    list.push({ id: num(row, 'id'), name: text(row, 'name') });
    byNote.set(noteId, list);
  }
  return byNote;
}

function notesOf(db: Database, rows: readonly Row[], viewer: Id, toImageRef: ToImageRef): Note[] {
  const descriptors = descriptorsOf(
    db,
    rows.map((row) => num(row, 'id')),
  );
  return rows.map((row) => {
    const id = num(row, 'id');
    const authorId = num(row, 'member_id');
    const avatar = imageRowOrNull(row, 'avatar');
    const verdict = textOrNull(row, 'verdict');
    return {
      id,
      target: { type: oneOf(row, 'target_type', TARGET_TYPES), id: num(row, 'target_id') },
      author: { id: authorId, name: text(row, 'author_name'), avatar: avatar === null ? null : toImageRef(avatar) },
      mine: authorId === viewer,
      text: text(row, 'text'),
      tastedOn: text(row, 'tasted_on'),
      descriptors: descriptors.get(id) ?? [],
      verdict: verdict === null ? null : oneOf(row, 'verdict', VERDICTS),
      visibility: oneOf(row, 'visibility', VISIBILITIES),
      createdAt: text(row, 'created_at'),
      updatedAt: text(row, 'updated_at'),
    };
  });
}

export function visibleNotes(db: Database, target: Target, viewer: Id, toImageRef: ToImageRef): Note[] {
  const rows = db
    .prepare(
      `${NOTE_SELECT} WHERE n.target_type = :type AND n.target_id = :id AND ${VISIBLE}
       ORDER BY n.tasted_on DESC, n.created_at DESC, n.id DESC`,
    )
    .all({ type: target.type, id: target.id, viewer });
  return notesOf(db, rows, viewer, toImageRef);
}

export function recentVisibleNotes(db: Database, viewer: Id, limit: number, toImageRef: ToImageRef): Note[] {
  const rows = db
    .prepare(`${NOTE_SELECT} WHERE ${VISIBLE} ORDER BY n.created_at DESC, n.id DESC LIMIT :limit`)
    .all({ viewer, limit });
  return notesOf(db, rows, viewer, toImageRef);
}

export function visibleNote(db: Database, noteId: Id, viewer: Id, toImageRef: ToImageRef): Note | null {
  const row = db.prepare(`${NOTE_SELECT} WHERE n.id = :noteId AND ${VISIBLE}`).get({ noteId, viewer });
  return row === undefined ? null : (notesOf(db, [row], viewer, toImageRef)[0] ?? null);
}

function ratingValue(row: Row): RatingValue {
  const value = num(row, 'value');
  const found = RATING_VALUES.find((candidate) => candidate === value);
  if (found === undefined) {
    throw new Error(`ratings row holds ${value}`);
  }
  return found;
}

export function householdRating(
  db: Database,
  target: Target,
  viewer: Id,
): { mine: Rating | null; household: HouseholdRating } {
  const own = db
    .prepare('SELECT value, visibility FROM ratings WHERE member_id = ? AND target_type = ? AND target_id = ?')
    .get(viewer, target.type, target.id);
  const totals = db
    .prepare(`SELECT COUNT(*) AS count, ${HOUSEHOLD_AVERAGE} AND target_id = ?`)
    .get(target.type, target.id);
  const count = totals === undefined ? 0 : num(totals, 'count');
  return {
    mine: own === undefined ? null : { value: ratingValue(own), visibility: oneOf(own, 'visibility', VISIBILITIES) },
    household: { average: count === 0 || totals === undefined ? null : num(totals, 'average'), count },
  };
}

export function householdAverages(db: Database, type: TargetType): Map<Id, number> {
  const rows = db.prepare(`SELECT target_id, ${HOUSEHOLD_AVERAGE} GROUP BY target_id`).all(type);
  return new Map(rows.map((row) => [num(row, 'target_id'), num(row, 'average')]));
}
