import { onlineLabIds, parseOnlineLabReference, isOnlineLabReference } from './onlineLab.js';

export function isAndroidPackage(location = globalThis.location) {
  return location?.origin === 'https://appassets.androidplatform.net';
}

// MainActivity serves raw official HTML here; only a fixed public test ID leaves JS.
export async function getAndroidLabReference(id, signal, fetcher = fetch) {
  if (!onlineLabIds.includes(id)) throw new Error('Unsupported reference');
  const response = await fetcher(`/android-source?id=${encodeURIComponent(id)}`, {
    signal, headers: { Accept: 'text/html' },
  });
  if (!response.ok || !response.headers.get('content-type')?.toLowerCase().includes('text/html') ||
      Number(response.headers.get('content-length')) > 1500000) throw new Error('Invalid source response');
  const reference = {
    ...parseOnlineLabReference(id, await response.text()),
    resolvedUrl: response.headers.get('X-Resolved-Url'),
  };
  if (!isOnlineLabReference(reference, id)) throw new Error('Unverified source');
  return reference;
}
