// rooms.room_number is stored as text, so ORDER BY in Postgres sorts it
// alphabetically (1, 10, 11, ..., 2, 20). Sort in natural number order instead
// (1, 2, 3, ..., 10, 11), with non-numeric names like "H1" / "W2" kept in
// natural order after/among them.
const collator = new Intl.Collator('th', { numeric: true, sensitivity: 'base' });

export function compareRoomNumbers(a, b) {
  return collator.compare(String(a ?? ''), String(b ?? ''));
}

export function sortRooms(rooms, key = 'room_number') {
  return [...(rooms || [])].sort((x, y) => compareRoomNumbers(x?.[key], y?.[key]));
}
