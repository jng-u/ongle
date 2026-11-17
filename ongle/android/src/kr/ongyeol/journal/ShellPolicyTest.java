package kr.ongyeol.journal;

/** Standalone JVM regression checks; no Android runtime or test dependency needed. */
final class ShellPolicyTest {
    private static int checks;
    private static void check(boolean value) {
        checks++;
        if (!value) throw new AssertionError("Policy check " + checks);
    }
    public static void main(String[] args) throws Exception {
        String origin = ShellPolicy.ORIGIN;
        check("web/index.html".equals(ShellPolicy.assetPath(origin + "/")));
        check("web/assets/main.js".equals(ShellPolicy.assetPath(origin + "/assets/main.js")));
        check("web/assets/main.js".equals(ShellPolicy.assetPath(origin + "/assets/main.js?v=1")));
        check(ShellPolicy.assetPath(origin + "/../secret") == null);
        check(ShellPolicy.assetPath(origin + "/%2e%2e/secret") == null);
        check(ShellPolicy.assetPath(origin + "/assets/%2e%2e/secret") == null);
        check(ShellPolicy.assetPath(origin + "/assets//main.js") == null);
        check(ShellPolicy.assetPath(origin + "/assets/%5csecret") == null);
        check(ShellPolicy.assetPath(origin + "/%00") == null);
        check(ShellPolicy.assetPath("file:///assets/main.js") == null);
        check(!ShellPolicy.trusted(origin + ".evil/"));
        check(!ShellPolicy.trusted("https://appassets.androidplatform.net@evil/"));
        check(!ShellPolicy.trusted("https://appassets.androidplatform.net:444/"));
        check(ShellPolicy.externalHttps("https://www.testcatalog.org/show/CRP"));
        check(!ShellPolicy.externalHttps("javascript:alert(1)"));
        check(!ShellPolicy.externalHttps("http://example.com"));
        check(!ShellPolicy.externalHttps("content://documents/1"));
        check(!ShellPolicy.externalHttps("https://user:pass@example.com/"));
        check(!ShellPolicy.externalHttps(origin + "/"));
        check("https://www.testcatalog.org/show/CRP".equals(ShellPolicy.mayoUrl("id=mayo-crp")));
        check("https://www.testcatalog.org/show/CALPR".equals(ShellPolicy.mayoUrl("id=mayo-calprotectin")));
        check(ShellPolicy.mayoUrl("id=mayo-crp&patient=private") == null);
        check(ShellPolicy.mayoUrl("url=https://evil/") == null);
        check(ShellPolicy.mayoUrl("id=mayo-crp&id=mayo-calprotectin") == null);
        check(ShellPolicy.rxNorm("https://rxnav.nlm.nih.gov/REST/drugs.json?name=aspirin"));
        check(!ShellPolicy.rxNorm("https://rxnav.nlm.nih.gov/REST/drugs.json?name=a&patient=private"));
        check(!ShellPolicy.rxNorm("https://rxnav.nlm.nih.gov/REST/other.json?name=a"));
        check(!ShellPolicy.rxNorm("https://rxnav.nlm.nih.gov.evil/REST/drugs.json?name=a"));
        check(ShellPolicy.CSP.contains("connect-src 'self' blob:"));
        check(ShellPolicy.CSP.contains("frame-src 'none'"));
        check(ShellPolicy.CSP.contains("script-src 'self';"));
        if (args.length == 1) java.nio.file.Files.write(java.nio.file.Paths.get(args[0]),
                ShellScript.INSTALL.getBytes(java.nio.charset.StandardCharsets.UTF_8));
        System.out.println("PASS: " + checks + " shell policy checks");
    }
}
