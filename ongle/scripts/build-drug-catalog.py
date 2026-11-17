#!/usr/bin/env python3
"""Rebuild the bundled HIRA name catalog using Python standard library only.

Network: python3 scripts/build-drug-catalog.py
Existing CSVs: python3 scripts/build-drug-catalog.py --products /tmp/ongle-products.csv --ingredients /tmp/ongle-ingredients.csv
No patient data, credentials, npm modules, strengths or treatment directions are used.
"""
import argparse
import csv
import hashlib
import html
import io
import json
from pathlib import Path
import re
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
SOURCES = {
    'products': {'dataset': '15067462', 'detail': 'uddi:8116acc9-2f07-4a1f-bec0-ddc8047bec3e', 'date': '2026-08-31'},
    'ingredients': {'dataset': '15067461', 'detail': 'uddi:fe5d37fb-bd8e-4eaf-a211-b35bbc2580e3', 'date': '2026-11-05'},
}

def get(url):
    with urllib.request.urlopen(url, timeout=60) as response:
        return response.read()

def download(source):
    query = urllib.parse.urlencode({'publicDataPk': source['dataset'], 'publicDataDetailPk': source['detail'], 'fileDetailSn': '1', 'publicDataTyCode': 'PR0051'})
    metadata = json.loads(get('https://www.data.go.kr/tcs/dss/selectFileDataDownload.do?' + query))
    if metadata.get('status') is not True:
        raise ValueError('Official portal did not return a public attachment')
    info = metadata['fileDataRegistVO']
    # Pin dataset vintages; do not silently label a newer attachment with the old date.
    expected = source['date'].replace('-', '')
    if expected not in info.get('dataNm', ''):
        raise ValueError('Dataset vintage changed; review SOURCES dates before refreshing')
    query = urllib.parse.urlencode({'atchFileId': metadata['atchFileId'], 'fileDetailSn': metadata['fileDetailSn']})
    url = 'https://www.data.go.kr/cmm/cmm/fileDownload.do?' + query
    return get(url), url

def parse_csv(raw, required):
    try:
        text = raw.decode('utf-8-sig')
    except UnicodeDecodeError:
        text = raw.decode('cp949')
    reader = csv.DictReader(io.StringIO(text))
    if not set(required).issubset(reader.fieldnames or []):
        raise ValueError('Unexpected CSV headers, refusing to overwrite catalog')
    return list(reader)

def build(products_raw, ingredients_raw):
    ingredients = parse_csv(ingredients_raw, ['일반명코드', '일반명'])
    by_code = {}
    for row in ingredients:
        by_code.setdefault(row['일반명코드'].strip(), set()).add(row['일반명'].strip())
    products = parse_csv(products_raw, ['한글상품명', '품목기준코드', '전문일반구분', '일반명코드(성분명코드)'])
    grouped = {}
    for row in products:
        if row['전문일반구분'].strip() not in {'전문의약품', '일반의약품', '전문,희귀'}:
            continue
        item = row['품목기준코드'].strip()
        name = html.unescape(row['한글상품명']).strip()
        if not re.fullmatch(r'\d{9}', item) or not name:
            continue
        names = grouped.setdefault((item, name), set())
        names.update(by_code.get(row['일반명코드(성분명코드)'].strip(), set()))
    rows = [[item, name, ' / '.join(sorted(names))] for (item, name), names in grouped.items()]
    rows.sort(key=lambda row: (row[1], row[0]))
    if len(rows) < 10000:
        raise ValueError('Unexpectedly small catalog, refusing to overwrite snapshot')
    return rows, {'productRows': len(products), 'ingredientRows': len(ingredients), 'catalogRows': len(rows)}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--products', type=Path)
    parser.add_argument('--ingredients', type=Path)
    args = parser.parse_args()
    raw = {}
    manifest = {'publisher': '건강보험심사평가원', 'license': '공공누리 제1유형 (출처표시)', 'licenseUrl': 'https://www.kogl.or.kr/info/licenseType1.do', 'retrieved': '2026-11-16', 'sources': {}, 'columns': ['itemSeq', 'name', 'ingredient'], 'scope': '전문·일반·희귀 의약품; 포장 중복을 품목기준코드+원문제품명으로 합침. 누적 자료로 현재 허가·판매·급여 여부를 나타내지 않음.'}
    for kind, source in SOURCES.items():
        local = getattr(args, kind)
        if local:
            raw[kind] = local.read_bytes()
            # Attachment IDs resolved from the source pages when the snapshot was retrieved.
            attachment = {'products': 'FILE_000000007666876', 'ingredients': 'FILE_000000007759104'}[kind]
            url = f'https://www.data.go.kr/cmm/cmm/fileDownload.do?atchFileId={attachment}&fileDetailSn=1'
        else:
            raw[kind], url = download(source)
        manifest['sources'][kind] = {'page': f"https://www.data.go.kr/data/{source['dataset']}/fileData.do", 'download': url, 'dataDate': source['date'], 'sha256': hashlib.sha256(raw[kind]).hexdigest(), 'bytes': len(raw[kind])}
    rows, stats = build(raw['products'], raw['ingredients'])
    manifest.update(stats)
    out = ROOT / 'src/data/korean-drugs.json'
    out.write_text(json.dumps(rows, ensure_ascii=False, separators=(',', ':')) + '\n')
    (ROOT / 'src/data/korean-drugs-source.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    print(f'Wrote {len(rows):,} names; {out.stat().st_size:,} bytes')

if __name__ == '__main__':
    main()
