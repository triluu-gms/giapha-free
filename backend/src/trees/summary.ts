// A person's few fields that the tree view and relative lists need: enough for a
// card, the layout and kinship terms. Everything else (bio, address, birthplace,
// photo, timestamps) is loaded only with that person's own details, when clicked.

export const SUMMARY_FIELDS = ['id', 'firstName', 'lastName', 'gender', 'birthDate', 'deathDate'] as const;

/** Cypher map projection of a person node's summary, e.g. personSummary('p') -> "p {.id, .firstName, …}". */
export const personSummary = (variable: string) => `${variable} {${SUMMARY_FIELDS.map((f) => `.${f}`).join(', ')}}`;
