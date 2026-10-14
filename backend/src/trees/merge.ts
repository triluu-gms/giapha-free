import { writeTransaction } from '../db';
import { HttpError } from '../errors';
import type { Person } from '../schemas';
import { releasePhotos } from './photos';
import { isTooYoungToBeParent, PARENT_AGE_CODES, PARENT_TOO_YOUNG_MESSAGE } from './rules';

/**
 * Merges two records of the same person: `removeId` into `keepId`, in one
 * transaction. The kept person gets `fields` (the values chosen for them) and
 * every relationship of the removed one: parents, children and spouses (without
 * doubling links they share), anniversary reminders, members' "This is me" links
 * and editors' branches starting from them. Then the removed person is deleted.
 *
 * Refused (and nothing changes) when the two are each other's parent, child or
 * spouse, or when the result would make someone their own ancestor or break the
 * parent age rule.
 */
export async function mergePeople(
  treeId: string,
  keepId: string,
  removeId: string,
  fields: Partial<Omit<Person, 'id'>>,
): Promise<Person> {
  if (keepId === removeId) throw new HttpError(400, 'Choose two different people');

  const result = await writeTransaction(async (run) => {
    const [pair] = await run<{ related: boolean; keepPhoto: string | null; removePhoto: string | null }>(
      `MATCH (keep:Person {id: $keepId, treeId: $treeId}), (gone:Person {id: $removeId, treeId: $treeId})
       RETURN EXISTS { (keep)-[:PARENT_OF|SPOUSE_OF]-(gone) } AS related,
              keep.photoUrl AS keepPhoto, gone.photoUrl AS removePhoto`,
      { treeId, keepId, removeId },
    );
    if (!pair) throw new HttpError(404, 'Person not found');
    if (pair.related) {
      throw new HttpError(409, 'These two are each other’s parent, child or spouse, so they can’t be the same person', 'mergeRelated');
    }

    const [row] = await run<{ person: Person }>(MERGE_CYPHER, { treeId, keepId, removeId, fields });

    // Check the merged person like any other change to the tree.
    const [check] = await run<{ cycle: boolean; birthDate: string | null; parentDates: string[]; childDates: string[] }>(
      MERGED_CHECK_CYPHER,
      { treeId, keepId },
    );
    if (check.cycle) {
      throw new HttpError(409, 'One of them is an ancestor of the other, so merging would make them their own ancestor', 'mergeCycle');
    }
    if (
      check.parentDates.some((d) => isTooYoungToBeParent(d, check.birthDate)) ||
      check.childDates.some((d) => isTooYoungToBeParent(check.birthDate, d))
    ) {
      throw new HttpError(409, `${PARENT_TOO_YOUNG_MESSAGE} (after merging)`, PARENT_AGE_CODES.link);
    }
    return { person: row.person, oldPhotos: [pair.keepPhoto, pair.removePhoto] };
  });

  // Uploaded photos neither of them uses any more.
  await releasePhotos(treeId, result.oldPhotos);
  return result.person;
}

/** Moves everything of `gone` onto `keep`, applies $fields, and deletes `gone`. */
export const MERGE_CYPHER = `MATCH (keep:Person {id: $keepId, treeId: $treeId}), (gone:Person {id: $removeId, treeId: $treeId})
       CALL (keep, gone) {
         MATCH (parent:Person)-[:PARENT_OF]->(gone) WHERE parent <> keep
         MERGE (parent)-[:PARENT_OF]->(keep)
       }
       CALL (keep, gone) {
         MATCH (gone)-[:PARENT_OF]->(child:Person) WHERE child <> keep
         MERGE (keep)-[:PARENT_OF]->(child)
       }
       CALL (keep, gone) {
         MATCH (gone)-[:SPOUSE_OF]-(spouse:Person) WHERE spouse <> keep
         MERGE (keep)-[:SPOUSE_OF]-(spouse)
       }
       CALL (keep, gone) {
         MATCH (u:User)-[r:REMINDS]->(gone)
         MERGE (u)-[kept:REMINDS]->(keep)
         ON CREATE SET kept.since = r.since, kept.lastSentFor = r.lastSentFor
       }
       CALL (keep, gone) {
         // "This is me": move the link, unless another member is already linked to the kept person.
         MATCH (:User)-[m:MEMBER_OF]->(:Tree {id: $treeId}) WHERE m.personId = gone.id
         SET m.personId = CASE
           WHEN EXISTS { (:User)-[:MEMBER_OF {personId: keep.id}]->(:Tree {id: $treeId}) } THEN null
           ELSE keep.id
         END
       }
       CALL (keep, gone) {
         MATCH (:User)-[m:MEMBER_OF]->(:Tree {id: $treeId}) WHERE m.scopeRootId = gone.id
         SET m.scopeRootId = keep.id
       }
       CALL (keep, gone) {
         MATCH (i:Invitation {treeId: $treeId}) WHERE i.scopeRootId = gone.id
         SET i.scopeRootId = keep.id
       }
       SET keep += $fields, keep.updatedAt = toString(datetime())
       DETACH DELETE gone
       RETURN keep {.*} AS person`;

/** Whether the merged person is now their own ancestor, and the dates for the parent age rule. */
export const MERGED_CHECK_CYPHER = `MATCH (keep:Person {id: $keepId, treeId: $treeId})
       RETURN EXISTS { (keep)-[:PARENT_OF*1..50]->(keep) } AS cycle, keep.birthDate AS birthDate,
              [(parent:Person)-[:PARENT_OF]->(keep) | parent.birthDate] AS parentDates,
              [(keep)-[:PARENT_OF]->(child:Person) | child.birthDate] AS childDates`;
