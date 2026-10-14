import { randomUUID } from 'node:crypto';
import { HttpError } from '../errors';
import { query } from '../db';
import { runImport, type ImportPlan, type ImportSummary } from './importPeople';

// A sample Vietnamese family, five generations deep, for trying the app out.
// Used by "Load sample family" on an empty tree and by `npm run db:seed`.

type SamplePerson = {
  key: string;
  firstName: string;
  lastName: string;
  gender: 'male' | 'female';
  birthDate?: string;
  deathDate?: string;
  birthPlace?: string;
};

// lastName is the family name (Họ); firstName is the middle and given name.
// Wives keep their own family name, as is the custom in Vietnam.
const people: SamplePerson[] = [
  // Generation 1: cụ
  { key: 'phuc', firstName: 'Văn Phúc', lastName: 'Nguyễn', gender: 'male', birthDate: '1905', deathDate: '1975-03-14', birthPlace: 'Hà Nam' },
  { key: 'lan', firstName: 'Thị Lan', lastName: 'Trần', gender: 'female', birthDate: '1908', deathDate: '1980-11-02', birthPlace: 'Hà Nam' },

  // Generation 2: ông bà
  { key: 'thanh', firstName: 'Văn Thành', lastName: 'Nguyễn', gender: 'male', birthDate: '1930-04-12', deathDate: '2005-08-21', birthPlace: 'Hà Nam' },
  { key: 'hoa', firstName: 'Thị Hoa', lastName: 'Lê', gender: 'female', birthDate: '1933-09-30', deathDate: '2012-01-19', birthPlace: 'Nam Định' },
  { key: 'mai', firstName: 'Thị Mai', lastName: 'Nguyễn', gender: 'female', birthDate: '1935-02-08', deathDate: '2018-06-05', birthPlace: 'Hà Nam' },
  { key: 'binh', firstName: 'Văn Bình', lastName: 'Phạm', gender: 'male', birthDate: '1932', deathDate: '2008', birthPlace: 'Thái Bình' },
  { key: 'duc', firstName: 'Văn Đức', lastName: 'Nguyễn', gender: 'male', birthDate: '1938-12-01', birthPlace: 'Hà Nam' },
  { key: 'hang', firstName: 'Thị Hằng', lastName: 'Vũ', gender: 'female', birthDate: '1941-05-17', birthPlace: 'Hải Dương' },

  // Generation 3: bố mẹ
  { key: 'hung', firstName: 'Văn Hùng', lastName: 'Nguyễn', gender: 'male', birthDate: '1955-02-03', birthPlace: 'Hà Nội' },
  { key: 'thu', firstName: 'Thị Thu', lastName: 'Đỗ', gender: 'female', birthDate: '1958-10-20', birthPlace: 'Hà Nội' },
  { key: 'minh', firstName: 'Văn Minh', lastName: 'Nguyễn', gender: 'male', birthDate: '1960-07-15', birthPlace: 'Hà Nội' },
  { key: 'nga', firstName: 'Thị Nga', lastName: 'Hoàng', gender: 'female', birthDate: '1963-03-08', birthPlace: 'Hải Phòng' },
  { key: 'hanh', firstName: 'Thị Hạnh', lastName: 'Nguyễn', gender: 'female', birthDate: '1963-11-25', birthPlace: 'Hà Nội' },
  { key: 'tuan', firstName: 'Văn Tuấn', lastName: 'Bùi', gender: 'male', birthDate: '1960' },
  { key: 'long', firstName: 'Văn Long', lastName: 'Phạm', gender: 'male', birthDate: '1958-04-30', birthPlace: 'Thái Bình' },
  { key: 'quang', firstName: 'Văn Quang', lastName: 'Nguyễn', gender: 'male', birthDate: '1966-01-09', birthPlace: 'Hà Nam' },

  // Generation 4: con
  { key: 'an', firstName: 'Văn An', lastName: 'Nguyễn', gender: 'male', birthDate: '1980-03-09', birthPlace: 'Hà Nội' },
  { key: 'linh', firstName: 'Thị Linh', lastName: 'Ngô', gender: 'female', birthDate: '1983-12-01', birthPlace: 'Bắc Ninh' },
  { key: 'huong', firstName: 'Thị Hương', lastName: 'Nguyễn', gender: 'female', birthDate: '1984-07-27', birthPlace: 'Hà Nội' },
  { key: 'nam', firstName: 'Đức Nam', lastName: 'Nguyễn', gender: 'male', birthDate: '1987-09-02', birthPlace: 'Hà Nội' },
  { key: 'ngoc', firstName: 'Thị Ngọc', lastName: 'Bùi', gender: 'female', birthDate: '1986-05-05', birthPlace: 'TP. Hồ Chí Minh' },
  { key: 'khoa', firstName: 'Văn Khoa', lastName: 'Bùi', gender: 'male', birthDate: '1990-08-19', birthPlace: 'TP. Hồ Chí Minh' },

  // Generation 5: cháu
  { key: 'khoi', firstName: 'Minh Khôi', lastName: 'Nguyễn', gender: 'male', birthDate: '2008-10-10', birthPlace: 'Hà Nội' },
  { key: 'ngocanh', firstName: 'Ngọc Anh', lastName: 'Nguyễn', gender: 'female', birthDate: '2012-06-01', birthPlace: 'Hà Nội' },
];

const children = (father: string, mother: string | null, kids: string[]): [string, string][] =>
  kids.flatMap((kid) => [[father, kid], ...(mother ? [[mother, kid]] : [])] as [string, string][]);

const parentOf: [string, string][] = [
  ...children('phuc', 'lan', ['thanh', 'mai', 'duc']),
  ...children('thanh', 'hoa', ['hung', 'minh', 'hanh']),
  ...children('binh', 'mai', ['long']),
  ...children('duc', 'hang', ['quang']),
  ...children('hung', 'thu', ['an', 'huong']),
  ...children('minh', 'nga', ['nam']),
  ...children('tuan', 'hanh', ['ngoc', 'khoa']),
  ...children('an', 'linh', ['khoi', 'ngocanh']),
];

const spouses: [string, string][] = [
  ['phuc', 'lan'],
  ['thanh', 'hoa'],
  ['binh', 'mai'],
  ['duc', 'hang'],
  ['hung', 'thu'],
  ['minh', 'nga'],
  ['tuan', 'hanh'],
  ['an', 'linh'],
];

/**
 * `key` only links people within this file and is never stored: each person gets a
 * fresh UUID every time, so the family can be added to any number of trees.
 */
function samplePlan(): ImportPlan {
  const ids = new Map(people.map((p) => [p.key, randomUUID()]));
  // Catch mistakes in the data above: a repeated key, or a link to a key that doesn't exist.
  if (ids.size !== people.length) throw new Error('Sample family: duplicate key');
  for (const key of [...parentOf, ...spouses].flat()) {
    if (!ids.has(key)) throw new Error(`Sample family: unknown key "${key}"`);
  }
  const nodes = people.map(({ key, ...props }) => ({ id: ids.get(key)!, props }));
  const parents = parentOf.map(([from, to]) => ({ from: ids.get(from)!, to: ids.get(to)! }));
  const pairs = spouses.map(([a, b]) => ({ a: ids.get(a)!, b: ids.get(b)! }));
  return {
    nodes,
    parents,
    spouses: pairs,
    people: nodes.length,
    matched: 0,
    parentLinks: parents.length,
    spouseLinks: pairs.length,
  };
}

export async function countPeople(treeId: string): Promise<number> {
  const [{ count }] = await query<{ count: number }>('MATCH (p:Person {treeId: $treeId}) RETURN count(p) AS count', {
    treeId,
  });
  return count;
}

/** Adds the sample family to a tree in one transaction. Unless `force`, the tree must be empty. */
export async function addSampleFamily(treeId: string, { force = false } = {}): Promise<ImportSummary> {
  if (!force && (await countPeople(treeId)) > 0) {
    throw new HttpError(409, 'The sample family can only be added to an empty tree');
  }
  return runImport(treeId, samplePlan());
}
