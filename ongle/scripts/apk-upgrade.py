#!/usr/bin/env python3
"""Read installed SDK metadata and select a signed, older upgrade baseline."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys


def parse_badging(text):
    match = re.search(r"^package: name='([^']+)' versionCode='(\d+)' versionName='([^']*)'", text, re.M)
    if not match:
        raise ValueError('APK package/version metadata unavailable')
    return dict(package=match[1], versionCode=int(match[2]), versionName=match[3])


def select_baseline(final, candidates, explicit=None):
    eligible = [item for item in candidates if item['package'] == final['package']
                and item['versionCode'] < final['versionCode']
                and item['certificate'] == final['certificate']]
    if explicit:
        eligible = [item for item in eligible if item['path'] == explicit]
    if not eligible:
        raise ValueError('No compatible older signed baseline; specify --baseline APK with the same package/signing certificate and a lower versionCode')
    return max(eligible, key=lambda item: (item['versionCode'], item['path']))


def sdk_tool(sdk, name):
    versions = sorted((sdk / 'build-tools').glob('*/' + name),
                      key=lambda p: tuple(int(n) for n in re.findall(r'\d+', p.parent.name)), reverse=True)
    if not versions:
        raise ValueError(f'Installed SDK tool unavailable: {name}')
    return str(versions[0])


def metadata(path, aapt, signer):
    path = path.resolve(strict=True)
    def run(*args):
        return subprocess.run(args, check=True, capture_output=True, text=True, timeout=30).stdout
    info = parse_badging(run(aapt, 'dump', 'badging', str(path)))
    signature = run(signer, 'verify', '--print-certs', str(path))
    certificates = sorted(set(re.findall(r'^(?:Signer #\d+|V\d+(?:\.\d+)* Signer(?: #\d+)?):? certificate SHA-256 digest: (\S+)', signature, re.M)))
    if not certificates:
        raise ValueError(f'Verified signing certificate unavailable: {path}')
    info.update(path=str(path), certificate=','.join(certificates), sha256=hashlib.sha256(path.read_bytes()).hexdigest())
    sidecar = Path(str(path) + '.sha256')
    if sidecar.exists() and sidecar.read_text().split()[0].lower() != info['sha256']:
        raise ValueError(f'APK checksum mismatch: {path}')
    return info


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sdk', type=Path, required=True)
    parser.add_argument('--final', type=Path, required=True)
    parser.add_argument('--baseline', type=Path)
    parser.add_argument('--baseline-dir', action='append', type=Path, default=[])
    args = parser.parse_args()
    aapt, signer = sdk_tool(args.sdk, 'aapt2'), sdk_tool(args.sdk, 'apksigner')
    final = metadata(args.final, aapt, signer)
    if final['package'] != 'kr.ongyeol.journal':
        raise ValueError('Expected kr.ongyeol.journal final APK')
    candidates = [args.baseline] if args.baseline else sorted({p for folder in args.baseline_dir for p in folder.glob('*.apk')})
    inspected = []
    for path in candidates:
        try:
            # Avoid signature verification for unrelated/current/future APKs.
            badging = subprocess.run([aapt, 'dump', 'badging', str(path)], check=True, capture_output=True, text=True, timeout=30)
            info = parse_badging(badging.stdout)
            if info['package'] == final['package'] and info['versionCode'] < final['versionCode']:
                inspected.append(metadata(path, aapt, signer))
        except (OSError, ValueError, subprocess.SubprocessError) as error:
            if args.baseline:
                raise ValueError(f'Cannot inspect explicit baseline {path}: {error}') from error
            print(f'SKIP candidate {path}: {error}', file=sys.stderr)
    baseline = select_baseline(final, inspected, str(args.baseline.resolve()) if args.baseline else None)
    print(json.dumps(dict(baseline=baseline, final=final), ensure_ascii=False, indent=2))


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        print(f'FAIL: {error}', file=sys.stderr)
        sys.exit(1)
