'use strict';
// Accessories and paperwork — asked last, before the exact price is shown.
//
// These are small BONUSES, not penalties: a customer without the box is not a worse
// customer, but a complete set genuinely resells faster, so it is worth paying a little
// more for. Maximum upside is +3% of the base price.
//
// Percentage of base price, in basis points: 100 = +1%.
module.exports = [
  {
    code: 'invoice',
    label: 'Original invoice',
    section: 'extras',
    sort: 11,
    options: [
      { code: 'have', label: 'Yes, I have it', adjKind: 'pct', adjValue: 100, grade: null },
      { code: 'no', label: 'No invoice', adjKind: 'pct', adjValue: 0, grade: null },
    ],
  },
  {
    code: 'box',
    label: 'Original box',
    section: 'extras',
    sort: 12,
    options: [
      { code: 'have', label: 'Yes, with the box', adjKind: 'pct', adjValue: 100, grade: null },
      { code: 'no', label: 'No box', adjKind: 'pct', adjValue: 0, grade: null },
    ],
  },
  {
    code: 'charger',
    label: 'Charger',
    section: 'extras',
    sort: 13,
    options: [
      { code: 'original', label: 'Original charger', adjKind: 'pct', adjValue: 100, grade: null },
      { code: 'third_party', label: 'Another charger', adjKind: 'pct', adjValue: 0, grade: null },
      { code: 'none', label: 'No charger', adjKind: 'pct', adjValue: 0, grade: null },
    ],
  },
];
