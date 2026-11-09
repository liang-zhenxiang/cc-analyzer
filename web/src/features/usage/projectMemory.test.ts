import { describe, expect, it } from "vitest";
import type { SessionRecord, SessionUsage } from "../sessions/types";
import type { UsageSessionInput } from "./usageAggregations";
import { buildProjectMemories, normalizeCommand } from "./projectMemory";

/**
 * 夹具全部手造，期望值按夹具手算写死在断言里——不从函数读回来当期望。
 * 时间一律用 `new Date(年, 月-1, 日, 时, 分)` 构造**本地时间**，本地日窗口
 * 才有意义；`now` 固定注入，模型层不读当前时钟。
 */

let seq = 0;

function tool(
  at: number,
  toolName: string,
  patch: Partial<SessionRecord> = {}
): SessionRecord {
  seq += 1;
  return {
    id: `r${seq}`,
    fullId: `r${seq}`,
    kind: "tool",
    timestamp: at,
    durationMs: 0,
    text: "",
    isError: false,
    toolName,
    raw: {},
    ...patch
  };
}

function usage(input: number, output = 0, cacheCreation = 0, cacheRead = 0): SessionUsage {
  return {
    inputTokens: input,
    outputTokens: output,
    cacheCreationTokens: cacheCreation,
    cacheReadTokens: cacheRead
  };
}

/** 2026 年本地时间。 */
function at(month: number, dayOfMonth: number, hour: number, minute = 0): number {
  return new Date(2026, month - 1, dayOfMonth, hour, minute).getTime();
}

const NOW = at(11, 10, 12, 0);

const ALPHA_LABEL = "-Users-liangzhenxiang-Desktop-work-alpha";
const ALPHA_PATH = "/Users/liangzhenxiang/Desktop/work/alpha";
const BETA_LABEL = "-home-dev-beta";
const BETA_PATH = "/home/dev/beta";

function editResult(filePath: string) {
  return {
    toolName: "Edit" as const,
    filePath,
    oldString: "",
    newString: "",
    replaceAll: false,
    structuredPatch: null
  };
}

function alphaInputs(): UsageSessionInput[] {
  const first: UsageSessionInput = {
    projectLabel: ALPHA_LABEL,
    projectPath: ALPHA_PATH,
    records: [
      // 10:00 失败的 build：命令归一后并入 `npm run build`，同时留下 ENOENT 坑。
      tool(at(11, 10, 10, 0), "Bash", {
        toolInput: { command: "npm run build --x" },
        isError: true,
        toolResult: "ENOENT: no such file, open '/repo/alpha/x.ts'"
      }),
      // 10:01 第二次失败：同一个归一命令，另一个坑（超时）。
      tool(at(11, 10, 10, 1), "Bash", {
        toolInput: { command: "npm run build --prod" },
        isError: true,
        toolResult: "Command failed: timeout after 30000ms"
      }),
      // 10:05 带环境变量前缀与查询串的命令：值必须整段消失。
      tool(at(11, 10, 10, 5), "Bash", {
        toolInput: { command: "API_KEY=xxx curl https://api.example.com/v1?token=abc" }
      }),
      // 10:10 成功：把两个 Bash 坑都标成已恢复。
      tool(at(11, 10, 10, 10), "Bash", {
        toolInput: { command: "npm run build --x" },
        usage: usage(100, 10)
      }),
      // 10:12 读文件（路径只从 toolInput 兜底取）。
      tool(at(11, 10, 10, 12), "Read", {
        toolInput: { file_path: "/repo/alpha/src/index.ts" }
      }),
      // 10:13 写文件（结构化结果带路径）。
      tool(at(11, 10, 10, 13), "Edit", {
        structuredResult: editResult("/repo/alpha/src/index.ts"),
        usage: usage(200, 20, 5, 15)
      }),
      // 10:14 Edit 失败：此后没有成功的 Edit，坑保持未恢复。
      tool(at(11, 10, 10, 14), "Edit", {
        toolInput: {},
        isError: true,
        toolResult: "Error: file has changed"
      }),
      // 10:15 Write。
      tool(at(11, 10, 10, 15), "Write", {
        structuredResult: { toolName: "Write", filePath: "/repo/alpha/docs/readme.md", created: true }
      }),
      // 10:20 引号内容（提交信息）必须整段消失。
      tool(at(11, 10, 10, 20), "Bash", {
        toolInput: { command: 'git commit -m "fix: leak token=abc"' }
      }),
      // 10:25 前导环境变量 + --token：只保留命令名 `gh`。
      tool(at(11, 10, 10, 25), "Bash", {
        toolInput: { command: "GITHUB_TOKEN=ghp_abc gh pr list --token abc" }
      }),
      // 10:30 纯空白命令：跳过，不能产生空条目。
      tool(at(11, 10, 10, 30), "Bash", {
        toolInput: { command: "   " }
      })
    ]
  };

  // 同一项目的第二个会话：会话数按输入计，而不是按项目去重。
  const second: UsageSessionInput = {
    projectLabel: ALPHA_LABEL,
    projectPath: ALPHA_PATH,
    records: [
      tool(at(11, 10, 9, 30), "Bash", {
        toolInput: { command: "npm run build" }
      })
    ]
  };

  // 窗口外的输入：一条记录都不进窗口，整个会话不可见。
  const outside: UsageSessionInput = {
    projectLabel: ALPHA_LABEL,
    projectPath: ALPHA_PATH,
    records: [
      tool(at(11, 3, 23, 59), "Bash", {
        toolInput: { command: "pnpm deploy" }
      })
    ]
  };

  return [first, second, outside];
}

function betaInputs(): UsageSessionInput[] {
  return [
    {
      projectLabel: BETA_LABEL,
      projectPath: BETA_PATH,
      records: [
        tool(at(11, 9, 9, 0), "Bash", {
          toolInput: { command: "pnpm test --run" }
        }),
        tool(at(11, 9, 9, 5), "Bash", {
          toolInput: { command: "pnpm test --run --watch" },
          isError: true,
          toolResult: "Command failed: timeout after 45000ms"
        }),
        tool(at(11, 9, 9, 10), "Read", {
          toolInput: { file_path: "/home/dev/beta/src/main.ts" },
          usage: usage(100)
        }),
        tool(at(11, 9, 9, 12), "Edit", {
          structuredResult: editResult("/home/dev/beta/src/main.ts"),
          usage: usage(50)
        })
      ]
    }
  ];
}

describe("normalizeCommand", () => {
  it("只留前 3 个 token，丢掉尾部参数", () => {
    expect(normalizeCommand("npm run build --x")).toBe("npm run build");
  });

  it("丢掉前导环境变量赋值，命令名才是第一个 token", () => {
    expect(normalizeCommand("API_KEY=xxx curl")).toBe("curl");
  });

  it("命中密钥样式时只留命令名", () => {
    expect(normalizeCommand("GITHUB_TOKEN=ghp_abc gh pr list --token abc")).toBe("gh");
  });

  it("删除引号内容", () => {
    expect(normalizeCommand('git commit -m "fix: leak token=abc"')).toBe("git commit -m");
  });

  it("只取首行并折叠空白", () => {
    expect(normalizeCommand("  npm   test \n rm -rf / ")).toBe("npm test");
  });

  it("超长命令按码点截断到 80 个字符再加省略号", () => {
    const result = normalizeCommand("a".repeat(100));
    expect(Array.from(result)).toHaveLength(81);
    expect(result.endsWith("…")).toBe(true);
  });

  it("空命令与纯赋值返回空串", () => {
    expect(normalizeCommand("   ")).toBe("");
    expect(normalizeCommand("FOO=bar")).toBe("");
  });
});

describe("buildProjectMemories", () => {
  it("按项目汇总命令、文件与坑，恢复状态按 lastSeen 之后的成功判定", () => {
    const memories = buildProjectMemories([...alphaInputs(), ...betaInputs()], 7, NOW);

    expect(memories).toEqual([
      {
        project: "alpha",
        sessions: 2,
        tokens: 350,
        lastActive: at(11, 10, 10, 30),
        commands: [
          { command: "npm run build", count: 4, failures: 2, lastUsed: at(11, 10, 10, 10) },
          { command: "gh", count: 1, failures: 0, lastUsed: at(11, 10, 10, 25) },
          { command: "git commit -m", count: 1, failures: 0, lastUsed: at(11, 10, 10, 20) },
          { command: "curl", count: 1, failures: 0, lastUsed: at(11, 10, 10, 5) }
        ],
        files: [
          { name: "index.ts", touches: 2, edits: 1, lastTouched: at(11, 10, 10, 13) },
          { name: "readme.md", touches: 1, edits: 1, lastTouched: at(11, 10, 10, 15) }
        ],
        pitfalls: [
          {
            signature: "Error: file has changed",
            tool: "Edit",
            failures: 1,
            firstSeen: at(11, 10, 10, 14),
            lastSeen: at(11, 10, 10, 14),
            recovered: false
          },
          {
            signature: "Command failed: timeout after <n>ms",
            tool: "Bash",
            failures: 1,
            firstSeen: at(11, 10, 10, 1),
            lastSeen: at(11, 10, 10, 1),
            recovered: true
          },
          {
            signature: "ENOENT: no such file, open <…>",
            tool: "Bash",
            failures: 1,
            firstSeen: at(11, 10, 10, 0),
            lastSeen: at(11, 10, 10, 0),
            recovered: true
          }
        ]
      },
      {
        project: "beta",
        sessions: 1,
        tokens: 150,
        lastActive: at(11, 9, 9, 12),
        commands: [
          { command: "pnpm test --run", count: 2, failures: 1, lastUsed: at(11, 9, 9, 5) }
        ],
        files: [
          { name: "main.ts", touches: 2, edits: 1, lastTouched: at(11, 9, 9, 12) }
        ],
        pitfalls: [
          {
            signature: "Command failed: timeout after <n>ms",
            tool: "Bash",
            failures: 1,
            firstSeen: at(11, 9, 9, 5),
            lastSeen: at(11, 9, 9, 5),
            recovered: false
          }
        ]
      }
    ]);
  });

  it("窗口两端都按闭区间裁剪：起点当天计入，now 之后不计入", () => {
    const start = at(11, 4, 0, 0);
    const memories = buildProjectMemories(
      [
        {
          projectLabel: "gamma",
          projectPath: "/srv/gamma",
          records: [
            tool(at(11, 3, 23, 59), "Bash", { toolInput: { command: "echo before" } }),
            tool(start, "Bash", { toolInput: { command: "echo start" } }),
            tool(at(11, 10, 11, 59), "Bash", { toolInput: { command: "echo in" } }),
            tool(NOW, "Bash", { toolInput: { command: "echo now" } }),
            tool(NOW + 1, "Bash", { toolInput: { command: "echo after" } })
          ]
        }
      ],
      7,
      NOW
    );

    expect(memories).toHaveLength(1);
    expect(memories[0].commands).toEqual([
      { command: "echo now", count: 1, failures: 0, lastUsed: NOW },
      { command: "echo in", count: 1, failures: 0, lastUsed: at(11, 10, 11, 59) },
      { command: "echo start", count: 1, failures: 0, lastUsed: start }
    ]);
    expect(memories[0].lastActive).toBe(NOW);
  });

  it("项目按 tokens 降序截断，项目内列表各自按主键截断", () => {
    const memories = buildProjectMemories([...alphaInputs(), ...betaInputs()], 7, NOW, {
      maxProjects: 1,
      maxCommands: 2,
      maxFiles: 1,
      maxPitfalls: 1
    });

    expect(memories).toHaveLength(1);
    expect(memories[0].project).toBe("alpha");
    expect(memories[0].commands.map((command) => command.command)).toEqual([
      "npm run build",
      "gh"
    ]);
    expect(memories[0].files.map((file) => file.name)).toEqual(["index.ts"]);
    expect(memories[0].pitfalls.map((pitfall) => pitfall.signature)).toEqual([
      "Error: file has changed"
    ]);
  });

  it("空输入返回空数组", () => {
    expect(buildProjectMemories([], 7, NOW)).toEqual([]);
  });

  it("没有项目名时落到「未命名项目」", () => {
    const memories = buildProjectMemories(
      [
        {
          projectLabel: "",
          records: [tool(NOW - 1000, "Bash", { toolInput: { command: "ls -la" } })]
        }
      ],
      7,
      NOW
    );

    expect(memories).toHaveLength(1);
    expect(memories[0].project).toBe("未命名项目");
    expect(memories[0].tokens).toBe(0);
    expect(memories[0].commands).toEqual([
      { command: "ls -la", count: 1, failures: 0, lastUsed: NOW - 1000 }
    ]);
  });

  it("输出不含绝对路径、完整命令参数或凭据", () => {
    const serialized = JSON.stringify(buildProjectMemories([...alphaInputs(), ...betaInputs()], 7, NOW));

    expect(serialized).not.toContain("/Users/");
    expect(serialized).not.toContain("/home/");
    expect(serialized).not.toContain("API_KEY");
    expect(serialized).not.toContain("ghp_");
    expect(serialized).not.toContain("--token");
    expect(serialized).not.toContain("api.example.com");
    expect(serialized).not.toContain("fix: leak");
  });
});
