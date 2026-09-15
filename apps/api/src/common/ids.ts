import { v7 as uuidv7 } from 'uuid';

/** UUID v7 — time-sortable primary keys generated in the application layer (database.md D1). */
export function newId(): string {
  return uuidv7();
}
