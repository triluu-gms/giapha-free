// Vietnamese lunisolar calendar (âm lịch) <-> Gregorian, after Hồ Ngọc Đức's
// algorithm (https://www.informatik.uni-leipzig.de/~duc/amlich/). Months start on
// the day of the new moon and the year's leap month follows the solar terms, all
// computed for Vietnam's time zone (UTC+7), which is why some dates differ from
// the Chinese calendar (e.g. Tết 1985 is 21 January in Vietnam, 20 February in China).
//
// backend/src/lib/lunar.ts is a copy (for anniversary reminders); keep them in sync.

const TIME_ZONE = 7;
const INT = Math.floor;

function jdFromDate(dd: number, mm: number, yy: number): number {
  const a = INT((14 - mm) / 12);
  const y = yy + 4800 - a;
  const m = mm + 12 * a - 3;
  let jd = dd + INT((153 * m + 2) / 5) + 365 * y + INT(y / 4) - INT(y / 100) + INT(y / 400) - 32045;
  if (jd < 2299161) jd = dd + INT((153 * m + 2) / 5) + 365 * y + INT(y / 4) - 32083; // Julian calendar
  return jd;
}

function jdToDate(jd: number): [number, number, number] {
  let b: number;
  let c: number;
  if (jd > 2299160) {
    const a = jd + 32044;
    b = INT((4 * a + 3) / 146097);
    c = a - INT((b * 146097) / 4);
  } else {
    b = 0;
    c = jd + 32082;
  }
  const d = INT((4 * c + 3) / 1461);
  const e = c - INT((1461 * d) / 4);
  const m = INT((5 * e + 2) / 153);
  return [e - INT((153 * m + 2) / 5) + 1, m + 3 - 12 * INT(m / 10), b * 100 + d - 4800 + INT(m / 10)];
}

/** Julian day of the k-th new moon after 1900-01-01. */
function newMoon(k: number): number {
  const T = k / 1236.85;
  const T2 = T * T;
  const T3 = T2 * T;
  const dr = Math.PI / 180;
  let jd1 = 2415020.75933 + 29.53058868 * k + 0.0001178 * T2 - 0.000000155 * T3;
  jd1 += 0.00033 * Math.sin((166.56 + 132.87 * T - 0.009173 * T2) * dr);
  const M = 359.2242 + 29.10535608 * k - 0.0000333 * T2 - 0.00000347 * T3;
  const Mpr = 306.0253 + 385.81691806 * k + 0.0107306 * T2 + 0.00001236 * T3;
  const F = 21.2964 + 390.67050646 * k - 0.0016528 * T2 - 0.00000239 * T3;
  let C1 = (0.1734 - 0.000393 * T) * Math.sin(M * dr) + 0.0021 * Math.sin(2 * dr * M);
  C1 = C1 - 0.4068 * Math.sin(Mpr * dr) + 0.0161 * Math.sin(dr * 2 * Mpr);
  C1 = C1 - 0.0004 * Math.sin(dr * 3 * Mpr);
  C1 = C1 + 0.0104 * Math.sin(dr * 2 * F) - 0.0051 * Math.sin(dr * (M + Mpr));
  C1 = C1 - 0.0074 * Math.sin(dr * (M - Mpr)) + 0.0004 * Math.sin(dr * (2 * F + M));
  C1 = C1 - 0.0004 * Math.sin(dr * (2 * F - M)) - 0.0006 * Math.sin(dr * (2 * F + Mpr));
  C1 = C1 + 0.001 * Math.sin(dr * (2 * F - Mpr)) + 0.0005 * Math.sin(dr * (2 * Mpr + M));
  const deltaT =
    T < -11
      ? 0.001 + 0.000839 * T + 0.0002261 * T2 - 0.00000845 * T3 - 0.000000081 * T * T3
      : -0.000278 + 0.000265 * T + 0.000262 * T2;
  return jd1 + C1 - deltaT;
}

/** The sun's longitude at that day's start, as one of 12 sectors (0..11). */
function sunLongitudeSector(dayNumber: number): number {
  const T = (dayNumber - 0.5 - TIME_ZONE / 24 - 2451545.0) / 36525;
  const T2 = T * T;
  const dr = Math.PI / 180;
  const M = 357.5291 + 35999.0503 * T - 0.0001559 * T2 - 0.00000048 * T * T2;
  const L0 = 280.46645 + 36000.76983 * T + 0.0003032 * T2;
  let DL = (1.9146 - 0.004817 * T - 0.000014 * T2) * Math.sin(dr * M);
  DL += (0.019993 - 0.000101 * T) * Math.sin(dr * 2 * M) + 0.00029 * Math.sin(dr * 3 * M);
  let L = (L0 + DL) * dr;
  L -= Math.PI * 2 * INT(L / (Math.PI * 2));
  return INT((L / Math.PI) * 6);
}

const newMoonDay = (k: number) => INT(newMoon(k) + 0.5 + TIME_ZONE / 24);

/** Day number of the start of the lunar month containing the winter solstice (month 11) of year yy. */
function lunarMonth11(yy: number): number {
  const k = INT((jdFromDate(31, 12, yy) - 2415021) / 29.530588853);
  const nm = newMoonDay(k);
  return sunLongitudeSector(nm) >= 9 ? newMoonDay(k - 1) : nm;
}

/** Months after month 11 (starting at a11) until the leap month of a 13-month year. */
function leapMonthOffset(a11: number): number {
  const k = INT((a11 - 2415021.076998695) / 29.530588853 + 0.5);
  let i = 1;
  let arc = sunLongitudeSector(newMoonDay(k + i));
  let last: number;
  do {
    last = arc;
    i++;
    arc = sunLongitudeSector(newMoonDay(k + i));
  } while (arc !== last && i < 14);
  return i - 1;
}

export interface LunarDate {
  day: number;
  month: number;
  year: number;
  /** The year's repeated (leap) month, tháng nhuận. */
  leap: boolean;
}

export function solarToLunar(dd: number, mm: number, yy: number): LunarDate {
  const dayNumber = jdFromDate(dd, mm, yy);
  // The mean lunation only estimates which new moon starts this month; step back
  // until it is on or before the day (rarely more than once).
  let k = INT((dayNumber - 2415021.076998695) / 29.530588853) + 1;
  let monthStart = newMoonDay(k);
  while (monthStart > dayNumber) monthStart = newMoonDay(--k);
  let a11 = lunarMonth11(yy);
  let b11 = a11;
  let year: number;
  if (a11 >= monthStart) {
    year = yy;
    a11 = lunarMonth11(yy - 1);
  } else {
    year = yy + 1;
    b11 = lunarMonth11(yy + 1);
  }
  const day = dayNumber - monthStart + 1;
  const diff = INT((monthStart - a11) / 29);
  let leap = false;
  let month = diff + 11;
  if (b11 - a11 > 365) {
    const leapDiff = leapMonthOffset(a11);
    if (diff >= leapDiff) {
      month = diff + 10;
      leap = diff === leapDiff;
    }
  }
  if (month > 12) month -= 12;
  if (month >= 11 && diff < 4) year -= 1;
  return { day, month, year, leap };
}

/** The solar date [day, month, year] of a lunar date, or null if that lunar date doesn't exist. */
export function lunarToSolar({ day, month, year, leap }: LunarDate): [number, number, number] | null {
  if (month < 1 || month > 12 || day < 1 || day > 30) return null;
  const [a11, b11] = month < 11 ? [lunarMonth11(year - 1), lunarMonth11(year)] : [lunarMonth11(year), lunarMonth11(year + 1)];
  const k = INT(0.5 + (a11 - 2415021.076998695) / 29.530588853);
  let off = month - 11;
  if (off < 0) off += 12;
  if (b11 - a11 > 365) {
    const leapOff = leapMonthOffset(a11);
    let leapMonth = leapOff - 2;
    if (leapMonth < 0) leapMonth += 12;
    if (leap && month !== leapMonth) return null;
    if (leap || off >= leapOff) off += 1;
  } else if (leap) {
    return null; // no leap month this year
  }
  const monthStart = newMoonDay(k + off);
  if (day > newMoonDay(k + off + 1) - monthStart) return null; // the month has only 29 days
  return jdToDate(monthStart + day - 1);
}

const CAN = ['Giáp', 'Ất', 'Bính', 'Đinh', 'Mậu', 'Kỷ', 'Canh', 'Tân', 'Nhâm', 'Quý'];
const CHI = ['Tý', 'Sửu', 'Dần', 'Mão', 'Thìn', 'Tỵ', 'Ngọ', 'Mùi', 'Thân', 'Dậu', 'Tuất', 'Hợi'];

/** The lunar year's name in the sexagenary cycle, e.g. 1964 -> "Giáp Thìn". */
export const canChi = (lunarYear: number) =>
  `${CAN[(((lunarYear + 6) % 10) + 10) % 10]} ${CHI[(((lunarYear + 8) % 12) + 12) % 12]}`;

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** The lunar date of a stored full date ("YYYY-MM-DD"); null for partial or malformed dates. */
export function lunarOf(value: string | null | undefined): LunarDate | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? '');
  return m ? solarToLunar(Number(m[3]), Number(m[2]), Number(m[1])) : null;
}

/** "YYYY-MM-DD" of a lunar date's solar day, or null if that lunar date doesn't exist. */
export function solarIsoOf(lunar: LunarDate): string | null {
  const solar = lunarToSolar(lunar);
  return solar && `${pad(solar[2], 4)}-${pad(solar[1])}-${pad(solar[0])}`;
}

/** A lunar date written like the stored ones, "YYYY-MM-DD" (lunar year, month and day). */
export const lunarIso = (lunar: LunarDate) => `${pad(lunar.year, 4)}-${pad(lunar.month)}-${pad(lunar.day)}`;
