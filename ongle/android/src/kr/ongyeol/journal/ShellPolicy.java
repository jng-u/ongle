package kr.ongyeol.journal;

import java.net.URI;

/** Small, JVM-testable URL boundary. No caller-supplied URL is used for Mayo I/O. */
final class ShellPolicy {
    static final String ORIGIN = "https://appassets.androidplatform.net";
    static final int MAX_EXPORT = 8 * 1024 * 1024;
    static final int MAX_REFERENCE = 1500000;
    static final String CSP = "default-src 'none'; script-src 'self'; "
            + "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; "
            + "connect-src 'self' blob: https://rxnav.nlm.nih.gov/REST/drugs.json; "
            + "worker-src 'self' blob:; frame-src 'none'; child-src 'none'; "
            + "object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

    static boolean trusted(String url) {
        try {
            URI u = new URI(url);
            return "https".equals(u.getScheme())
                    && "appassets.androidplatform.net".equals(u.getRawAuthority());
        } catch (Exception e) { return false; }
    }

    static boolean externalHttps(String url) {
        try {
            URI u = new URI(url);
            return "https".equals(u.getScheme()) && u.getHost() != null
                    && u.getRawUserInfo() == null && (u.getPort() == -1 || u.getPort() == 443)
                    && !trusted(url);
        } catch (Exception e) { return false; }
    }

    static String assetPath(String url) {
        if (!trusted(url)) return null;
        try {
            String path = new URI(url).getPath();
            if (path == null || path.equals("/")) return "web/index.html";
            if (!path.startsWith("/") || path.contains("\\") || path.indexOf('\0') >= 0) return null;
            for (String part : path.substring(1).split("/", -1)) {
                if (part.equals(".") || part.equals("..") || part.isEmpty()) return null;
            }
            return "web" + path;
        } catch (Exception e) { return null; }
    }

    static String mayoUrl(String rawQuery) {
        if ("id=mayo-crp".equals(rawQuery)) return "https://www.testcatalog.org/show/CRP";
        if ("id=mayo-calprotectin".equals(rawQuery)) return "https://www.testcatalog.org/show/CALPR";
        return null;
    }

    static boolean rxNorm(String url) {
        try {
            URI u = new URI(url);
            String query = u.getRawQuery();
            return "https".equals(u.getScheme()) && "rxnav.nlm.nih.gov".equals(u.getRawAuthority())
                    && "/REST/drugs.json".equals(u.getRawPath()) && u.getRawFragment() == null
                    && query != null && query.startsWith("name=") && query.length() <= 600
                    && query.length() > 5 && query.indexOf('&') < 0 && query.indexOf(';') < 0;
        } catch (Exception e) { return false; }
    }

    private ShellPolicy() { }
}
