import { describe, expect, it } from "vitest";
import { firstMessagePreview, PREVIEW_MAX_CODEPOINTS } from "./firstMessagePreview";

/* ── I8 首条消息预览：脱敏规则表逐条 + 截断 + 空态 ───────────────
 * 每条规则至少一个命中与一个不命中（§5.2 验收断言全部落成测试）。
 */

describe("firstMessagePreview（I8 首条消息预览脱敏）", () => {
  it("null / 空串 → null；纯空白 trim 后空 → null", () => {
    expect(firstMessagePreview(null)).toBeNull();
    expect(firstMessagePreview("")).toBeNull();
    expect(firstMessagePreview("   \n\t  ")).toBeNull();
  });

  it("规则1 用户主目录：/Users/<name> 与 /home/<name> → ~；不含的原文不动", () => {
    const hit = firstMessagePreview("把 /Users/liang/Documents/work 里的日志收一下");
    expect(hit).not.toBeNull();
    expect(hit!.preview).not.toContain("liang");
    expect(hit!.preview).toContain("~");
    expect(hit!.redacted).toBe(true);

    const home = firstMessagePreview("看下 /home/deploy/服务状态");
    expect(home!.preview).not.toContain("deploy");
    expect(home!.preview).toContain("~");

    const miss = firstMessagePreview("把仓库里的日志收一下");
    expect(miss!.redacted).toBe(false);
    expect(miss!.preview).toBe("把仓库里的日志收一下");
  });

  it("规则2 常见仓库根：长于 24 的 /(repo|work|projects)/… 缩成 ~/…/<末段≤16>", () => {
    const long = firstMessagePreview("帮我修 /Users/liang/work/cc-analyzer/web/src 这个模块");
    // 规则 1 先把 /Users/liang 打成 ~，剩下 ~/work/cc-analyzer/web/src
    // 里的 /work/ 段由规则 2 缩：末段保留 ≤16。
    expect(long!.preview).toContain("~/…/");
    expect(long!.preview).not.toContain("cc-analyzer/web/src");

    // 短仓库根（≤24）不缩——误伤率比泄露风险高。
    const short = firstMessagePreview("看看 /repo/x.yml");
    expect(short!.preview).toContain("/repo/x.yml");
  });

  it("规则3 任意绝对路径（多级）→ <路径>；单级相对路径不动", () => {
    const hit = firstMessagePreview("打开 /etc/nginx/sites-enabled/default 看看");
    expect(hit!.preview).toContain("<路径>");
    expect(hit!.preview).not.toContain("nginx");

    const win = firstMessagePreview("编译 C:\\Users\\bob\\code\\app 用 MSVC");
    expect(win!.preview).toContain("<路径>");
    expect(win!.preview).not.toContain("bob");

    // 相对路径 src/x.ts 只有一级，不是绝对路径——不动。
    const miss = firstMessagePreview("改一下 src/index.ts 的导入");
    expect(miss!.redacted).toBe(false);
    expect(miss!.preview).toContain("src/index.ts");
  });

  it("规则4/5/6 密钥三连：sk-/gh*_ /AKIA 各自打码、保留可识别前缀", () => {
    const sk = firstMessagePreview("用 sk-ant-api03-XXXXXXXXXXXXXXXXXXXXXX 试一下");
    expect(sk!.preview).toContain("sk-…");
    expect(sk!.preview).not.toContain("XXXXXXXX");

    const gh = firstMessagePreview("token ghp_16C7e42F292c6912E7710c838347Ae178B4a");
    expect(gh!.preview).toContain("ghp_…");
    expect(gh!.preview).not.toContain("178B4a");

    const aws = firstMessagePreview("key 是 AKIAIOSFODNN7EXAMPLE");
    expect(aws!.preview).toContain("AKIA…");
    expect(aws!.preview).not.toContain("EXAMPLE");

    // 不够长的形状不打（sk- 后 <16 位是普通词）。
    const miss = firstMessagePreview("sk-短词 不该被打码");
    expect(miss!.preview).toContain("sk-短词");
  });

  it("规则7 长随机串（≥32）→ <已隐去>；普通长句不打", () => {
    const hit = firstMessagePreview("commit a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0 修好了");
    expect(hit!.preview).toContain("<已隐去>");
    expect(hit!.preview).not.toContain("a1b2c3d4");

    // 31 位不触发。
    const near = "a".repeat(31);
    const miss = firstMessagePreview(`${near} 是普通串`);
    expect(miss!.preview).toContain(near);
  });

  it("规则8/9/10 邮箱 / 内网 IP / URL 查询串", () => {
    const mail = firstMessagePreview("发到 someone@example.com 就行");
    expect(mail!.preview).toContain("<邮箱>");
    expect(mail!.preview).not.toContain("someone@");

    const ip = firstMessagePreview("服务在 192.168.1.23:8080");
    expect(ip!.preview).toContain("<内网地址>");
    expect(ip!.preview).not.toContain("192.168");

    const query = firstMessagePreview("见 https://x.dev/a?token=abcdef123456&page=2");
    expect(query!.preview).toContain("?…");
    expect(query!.preview).not.toContain("abcdef123456");
  });

  it("组合：一条消息里路径+密钥+IP 同时出现，全部打掉", () => {
    const combo = firstMessagePreview(
      "在 /Users/liang/work/big-repo-name-here/server 跑 sk-abcdefghijklmnopqrst，数据库是 10.0.4.12"
    );
    expect(combo!.preview).not.toContain("liang");
    expect(combo!.preview).not.toContain("abcdefghijklmnopqrst");
    expect(combo!.preview).not.toContain("10.0.4.12");
    expect(combo!.redacted).toBe(true);
  });

  it("截断：≤80 码位不动；>80 截到 80 加 …；emoji 不劈半", () => {
    // 夹具用汉字：纯字母长串会先撞规则 7（≥32 位随机串）被打成 <已隐去>，
    // 测不出截断几何本身。
    const short = firstMessagePreview("字".repeat(80));
    expect(short!.preview).toBe("字".repeat(80));
    expect(short!.preview.endsWith("…")).toBe(false);

    const long = firstMessagePreview("字".repeat(120));
    expect(Array.from(long!.preview).length).toBe(PREVIEW_MAX_CODEPOINTS + 1);
    expect(long!.preview.endsWith("…")).toBe(true);
    // 任意输入的预览都不超 80 码位 + 省略号。
    const wild = firstMessagePreview("字".repeat(500));
    expect(Array.from(wild!.preview).length).toBeLessThanOrEqual(PREVIEW_MAX_CODEPOINTS + 1);

    // 代理对：emoji 在 80 边界上不劈半（截在码位边界）。
    const emojiBoundary = firstMessagePreview("😀".repeat(81));
    expect(Array.from(emojiBoundary!.preview).length).toBe(PREVIEW_MAX_CODEPOINTS + 1);
    expect(emojiBoundary!.preview.endsWith("…")).toBe(true);
    // 截断后的每一段码位都还是完整 emoji（.length 检查不含孤立代理）。
    expect(Array.from(emojiBoundary!.preview).slice(0, -1).every((c) => c === "😀")).toBe(true);
  });

  it("空白折叠：换行与多空格折成一个空格，且计入 redacted", () => {
    const multiline = firstMessagePreview("第一行\n\n第二行   继续");
    expect(multiline!.preview).toBe("第一行 第二行 继续");
    expect(multiline!.redacted).toBe(true);
  });
});
