import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

test('APK upgrade selection uses metadata, explicit baselines and rejects incompatible upgrades', () => {
  const result = spawnSync('python3', ['-B', '-c', `
import importlib.util
spec = importlib.util.spec_from_file_location('upgrade', 'scripts/apk-upgrade.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
line = "package: name='kr.ongyeol.journal' versionCode='12' versionName='2.7 beta' platformBuildVersionCode='36'"
assert m.parse_badging(line) == {'package':'kr.ongyeol.journal', 'versionCode':12, 'versionName':'2.7 beta'}
final = dict(m.parse_badging(line), path='/final.apk', certificate='same')
def apk(code, path, certificate='same', package='kr.ongyeol.journal'):
 return dict(final, versionCode=code, path=path, certificate=certificate, package=package)
candidates = [apk(2, '/old.apk'), apk(11, '/recent.apk'), apk(13, '/future.apk'), apk(12, '/equal.apk'), apk(10, '/foreign.apk', package='other'), apk(9, '/unsigned.apk', certificate='different')]
assert m.select_baseline(final, candidates)['path'] == '/recent.apk'
assert m.select_baseline(final, candidates, '/old.apk')['versionCode'] == 2
for path in ['/equal.apk', '/future.apk', '/unsigned.apk', '/foreign.apk', '/missing.apk']:
 try: m.select_baseline(final, candidates, path)
 except ValueError: pass
 else: raise AssertionError('incompatible explicit baseline accepted: ' + path)
try: m.select_baseline(final, [apk(12, '/same.apk')])
except ValueError: pass
else: raise AssertionError('missing older baseline accepted')
try: m.parse_badging('invalid badging output')
except ValueError: pass
else: raise AssertionError('invalid metadata accepted')
`], {cwd:new URL('..', import.meta.url), encoding:'utf8'});
  assert.equal(result.status, 0, result.stderr);
});

test('unattended preflight freezes a metadata-selected baseline and rejects equal versions', async () => {
  const {mkdtemp, mkdir, writeFile, readFile, rm} = await import('node:fs/promises');
  const {join} = await import('node:path');
  const {tmpdir} = await import('node:os');
  const root = await mkdtemp(join(tmpdir(), 'ongyeol-upgrade-test-'));
  const evidence = [];
  try {
    const tools = join(root, 'sdk/build-tools/36.0.0');
    await mkdir(tools, {recursive:true});
    // Existing SDK tools are the boundary: no emulator or network in this test.
    await writeFile(join(tools, 'aapt2'), '#!/bin/sh\ncat "$3"\n', {mode:0o755});
    await writeFile(join(tools, 'apksigner'), '#!/bin/sh\necho "V3.0 Signer: certificate SHA-256 digest: abc123"\n', {mode:0o755});
    const apk = async (name, code, version) => {
      const path = join(root, name + '.apk');
      await writeFile(path, `package: name='kr.ongyeol.journal' versionCode='${code}' versionName='${version}'\n`);
      return path;
    };
    await apk('old', 4, '1.2');
    const recent = await apk('recent', 8, '2.5');
    const final = await apk('final', 10, '3.0 rc');
    const run = extra => {
      const result = spawnSync('bash', ['android/test-alarms.sh', final, '--non-interactive', '--check-apks', '--baseline-dir', root, ...extra], {
        cwd:new URL('..', import.meta.url), encoding:'utf8', env:{...process.env, BASELINE_APK:'', ANDROID_SDK_ROOT:join(root, 'sdk')},
      });
      const out = result.stdout.match(/Evidence: (.+)/)?.[1];
      if (out) evidence.push(out);
      return {...result, out};
    };
    const selected = run([]);
    assert.equal(selected.status, 0, selected.stdout + selected.stderr);
    assert.match(selected.stdout, /emulator not started/);
    const info = JSON.parse(await readFile(join(selected.out, 'apk-metadata.json'), 'utf8'));
    assert.equal(info.baseline.path, recent);
    assert.equal(info.final.versionName, '3.0 rc');
    assert.equal(await readFile(join(selected.out, 'final-under-test.apk'), 'utf8'), await readFile(final, 'utf8'));
    const equal = run(['--baseline', final]);
    assert.equal(equal.status, 1, equal.stdout + equal.stderr);
    assert.match(equal.stdout + equal.stderr, /No compatible older signed baseline/);
  } finally {
    await rm(root, {recursive:true, force:true});
    for (const dir of evidence) await rm(dir, {recursive:true, force:true});
  }
});
