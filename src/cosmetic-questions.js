'use strict';
// Cosmetic-condition questions for phones, added after the original questionnaire.
//
// Adjustments are PERCENT of the device's base buy price, not flat dirhams, so a cracked
// back on an AED 1,500 iPhone and a cracked back on an AED 650 iPhone both cost the
// seller a proportionate amount. adjValue is basis points: -200 = -2%.
//
// Shared by the database seed (fresh installs) and POST /api/admin/questions (live sites),
// so the two can never drift apart.
module.exports = [
  {
    code: 'frame',
    label: 'Frame and edges',
    section: 'cosmetic',
    sort: 9,
    options: [
      { code: 'mint', label: 'Flawless — no marks', adjKind: 'pct', adjValue: 0, grade: null },
      { code: 'scuffs', label: 'Light scuffs on the edges', adjKind: 'pct', adjValue: -200, grade: null },
      { code: 'dents', label: 'Dents or deep scratches', adjKind: 'pct', adjValue: -500, grade: 'C' },
      { code: 'bent', label: 'Bent or twisted frame', adjKind: 'pct', adjValue: -1000, grade: 'D' },
    ],
  },
  {
    code: 'backglass',
    label: 'Back glass / rear panel',
    section: 'cosmetic',
    sort: 10,
    options: [
      { code: 'intact', label: 'Intact', adjKind: 'pct', adjValue: 0, grade: null },
      { code: 'scratched', label: 'Scratched', adjKind: 'pct', adjValue: -200, grade: null },
      { code: 'cracked', label: 'Cracked', adjKind: 'pct', adjValue: -600, grade: 'C' },
    ],
  },
];
