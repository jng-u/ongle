import {searchDrugs} from './drugSearch.js';

// Only the public search term crosses this boundary, never the journal or notes.
self.onmessage = ({data}) => {
  const {requestId, query} = data;
  try {
    const results = searchDrugs(query);
    self.postMessage({requestId, results});
  } catch {
    self.postMessage({requestId, error: '약 목록을 열지 못했어요. 직접 입력하거나 다시 검색해 주세요.'});
  }
};
