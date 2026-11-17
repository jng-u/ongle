import { isAndroidPackage } from './androidReference.js';

/** saved means native write AND close completed. A web download is only a request. */
export async function saveFile({ blob, name }, { native = globalThis.window?.ongyeolFiles,
  android = isAndroidPackage(), document = globalThis.document, url = globalThis.URL } = {}) {
  try {
    if (android) {
      if (!native?.save) return { status: 'failed' };
      const result = await native.save(blob, name);
      return ['saved', 'cancelled', 'failed'].includes(result?.status) ? result : { status: 'failed' };
    }
    const href = url.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = href; anchor.download = name;
    try { document.body.append(anchor); anchor.click(); }
    finally { anchor.remove(); setTimeout(() => url.revokeObjectURL(href), 60000); }
    return { status: 'requested' };
  } catch { return { status: 'failed' }; }
}
