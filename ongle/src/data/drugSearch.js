// Heavy catalog and pure search live exclusively in the worker in the browser.
import koreanRows from './korean-drugs.json' with {type: 'json'};
import {HIRA_SOURCE} from './drugs.js';

export const DRUG_CATALOG = koreanRows.map(([itemSeq, name, ingredient]) => ({
  id: `hira-${itemSeq}-${name}`, itemSeq, name, ingredient,
  sourceUrl: HIRA_SOURCE,
}));
export function normalizeDrugQuery(value) {
  return String(value ?? '').normalize('NFKC').toLocaleLowerCase('ko')
    .replace(/마이크로(?:그램|그람)/g, 'mcg').replace(/밀리(?:그램|그람)/g, 'mg')
    .replace(/(?:그램|그람)/g, 'g').replace(/[\s()[\]·,\-/]/g, '');
}
// Source text is sorted at generation time. Build a reusable bigram posting index
// only when the user first searches; never renormalize 90k names on every keypress.
let searchIndex;
function getSearchIndex() {
  if (searchIndex) return searchIndex;
  const texts = DRUG_CATALOG.map(drug => normalizeDrugQuery(`${drug.name} ${drug.ingredient} ${drug.itemSeq}`));
  const postings = new Map();
  texts.forEach((text, index) => {
    const grams = new Set();
    for (let i = 0; i < text.length - 1; i++) grams.add(text.slice(i, i + 2));
    for (const gram of grams) {
      if (!postings.has(gram)) postings.set(gram, []);
      postings.get(gram).push(index);
    }
  });
  searchIndex = {texts, postings};
  return searchIndex;
}
export function searchDrugs(query, limit = 30) {
  const q = normalizeDrugQuery(query);
  const count = Number.isFinite(limit) ? Math.max(0, Math.min(100, Math.floor(limit))) : 30;
  if (!q || !count) return [];
  const terms = String(query).trim().split(/\s+/).map(normalizeDrugQuery).filter(Boolean);
  const {texts, postings} = getSearchIndex();
  let candidates;
  for (const term of terms) {
    for (let i = 0; i < term.length - 1; i++) {
      const list = postings.get(term.slice(i, i + 2));
      if (!list) return [];
      if (!candidates || list.length < candidates.length) candidates = list;
    }
  }
  const matches = [];
  const prefix = [];
  for (const index of candidates || texts.keys()) {
    if (!terms.every(term => texts[index].includes(term))) continue;
    const drug = DRUG_CATALOG[index];
    if (normalizeDrugQuery(drug.name).startsWith(q)) prefix.push(drug);
    else matches.push(drug);
    if (prefix.length >= count) break;
  }
  return [...prefix, ...matches].slice(0, count);
}
