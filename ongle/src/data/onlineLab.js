import { labReferences } from './labRefs.js';

// Server-only I/O entry point. Call from the same-origin middleware/Worker.
// Never accept a URL, query text, numeric result, or patient data from the caller.
export const onlineLabIds = Object.freeze(['mayo-crp', 'mayo-calprotectin']);
const boilerplate = 'Describes reference intervals and additional information for interpretation of test results. May include intervals based on age and sex when appropriate. Intervals are Mayo-derived, unless otherwise designated. If an interpretive report is provided, the reference value field will state this.';
const sourceUrls = new Map([
  ['mayo-crp', ['https://www.mayocliniclabs.com/test-catalog/Overview/9731', 'https://www.testcatalog.org/show/CRP']],
  ['mayo-calprotectin', ['https://www.mayocliniclabs.com/test-catalog/Overview/63016', 'https://www.testcatalog.org/show/CALPR']],
]);
const expected = new Map([
  ['mayo-crp', { title: 'C-Reactive Protein (CRP), Serum', method: 'Immunoturbidimetric', section: '<5.0 mg/L Reference values apply to all ages.' }],
  ['mayo-calprotectin', { title: 'Calprotectin, Feces', method: 'Enzyme-Linked Immunosorbent Assay (ELISA)', section: '<50.0 mcg/g (Normal) 50.0-120 mcg/g (Borderline) >120 mcg/g (Abnormal) Reference values apply to all ages.' }],
]);
const fail = () => new Error('공식 출처의 참고범위를 확인하지 못했어요. 저장된 자료나 결과지를 이용해 주세요.');
const normalize = text => text.replace(/\s+/g, ' ').trim();
function decode(text) {
  const entities = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'", nbsp: ' ' };
  return text.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos|nbsp);/gi, (match, entity) => {
    if (entity[0] !== '#') return entities[entity.toLowerCase()];
    const number = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    return number > 0 && number <= 0x10ffff ? String.fromCodePoint(number) : match;
  });
}
const plain = html => normalize(decode(html.replace(/<[^>]*>/g, ' ')));

/** Fail-closed parser: only the exact, independently verified section is accepted.
 * Fixtures below mirror the official heading/paragraph structure, not a full page.
 * A layout/reference change must be reviewed against the official source first.
 */
export function parseOnlineLabReference(id, html, checkedAt = new Date().toISOString()) {
  const spec = expected.get(id);
  const ref = labReferences.find(item => item.id === id);
  if (!spec || !ref || typeof html !== 'string' || html.length > 1500000) throw fail();
  const document = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  const headings = [...document.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi)];
  const methodIndices = headings.map((heading, index) => ['Method Name', 'Method Name A short description of the method used to perform the test'].includes(plain(heading[2])) ? index : -1).filter(index => index >= 0);
  if (methodIndices.length !== 1) throw fail();
  const methodHeading = headings[methodIndices[0]], afterMethod = headings[methodIndices[0] + 1];
  if (!afterMethod || plain(document.slice(methodHeading.index + methodHeading[0].length, afterMethod.index)) !== spec.method) throw fail();
  const indices = headings.map((heading, index) => ['Reference Values', `Reference Values ${boilerplate}`].includes(plain(heading[2])) ? index : -1).filter(index => index >= 0);
  if (indices.length !== 1 || !headings.some(heading => plain(heading[2]) === spec.title || [`Test ID ${id === 'mayo-crp' ? 'CRP' : 'CALPR'} ${spec.title}`, `Test ID: ${id === 'mayo-crp' ? 'CRP' : 'CALPR'} ${spec.title}`].includes(plain(heading[2])))) throw fail();
  const index = indices[0], heading = headings[index], next = headings[index + 1];
  if (!next || !['Interpretation', 'Interpretation Provides information to assist in interpretation of the test results', 'Day(s) Performed'].includes(plain(next[2]))) throw fail();
  const section = plain(document.slice(heading.index + heading[0].length, next.index));
  // Accept only known official boilerplate + exact reference section (or the same
  // section without boilerplate). No searching for numbers elsewhere in the page.
  if (section !== spec.section && section !== `${boilerplate} ${spec.section}`) throw fail();
  if (!Number.isFinite(Date.parse(checkedAt))) throw fail();
  return { ...ref, lowInclusive: ref.lowInclusive !== false, highInclusive: ref.highInclusive !== false, mode: 'online', checkedAt, referenceVersion: ref.syncedAt, resolvedUrl: ref.url };
}

async function readHtml(response) {
  const limit = 1500000;
  if (Number(response.headers?.get('content-length')) > limit) throw fail();
  if (!response.body?.getReader) {
    const text = await response.text();
    if (text.length > limit) throw fail();
    return text;
  }
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let bytes = 0, text = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) throw fail();
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally { await reader.cancel().catch(() => {}); }
}

export async function getOnlineLabReference(id, fetcher = fetch) {
  if (!expected.has(id)) throw fail();
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(fail()); }, 8000);
  });
  try {
    return await Promise.race([timeout, (async () => {
      for (const url of sourceUrls.get(id)) {
        if (controller.signal.aborted) throw fail();
        try {
          const response = await fetcher(url, { signal: controller.signal, redirect: 'error', headers: { Accept: 'text/html' } });
          if (!response.ok || (response.url && response.url !== url) || !response.headers?.get('content-type')?.toLowerCase().includes('text/html')) throw fail();
          const html = await readHtml(response);
          return { ...parseOnlineLabReference(id, html), resolvedUrl: url };
        } catch { if (controller.signal.aborted) throw fail(); }
      }
      throw fail();
    })()]);
  } catch { throw fail(); }
  finally { clearTimeout(timer); controller.abort(); }
}

// Client-side contract guard: reject malformed, mixed-unit or stale-version JSON.
// The endpoint returns a direct object on success, a non-200 on every failure.
export function isOnlineLabReference(value, id) {
  const ref = labReferences.find(item => item.id === id);
  return !!(expected.has(id) && ref && value && value.id === id && value.mode === 'online'
    && Number.isFinite(Date.parse(value.checkedAt)) && value.url === ref.url && sourceUrls.get(id).includes(value.resolvedUrl)
    && value.name === ref.name && value.unit === ref.unit && value.low === ref.low && value.high === ref.high
    && value.lowInclusive === (ref.lowInclusive !== false) && value.highInclusive === (ref.highInclusive !== false)
    && value.population === ref.population && value.publisher === ref.publisher && value.caveat === ref.caveat
    && value.bands === ref.bands && value.referenceVersion === ref.syncedAt);
}
