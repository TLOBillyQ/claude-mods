# claude-mods

三个 [Claude Code mod](https://claude.dev/blog/getting-started-with-claude-code-mods/)，打包成一个本地 marketplace `my-mods`。

| Mod | 作用 |
|---|---|
| [token-weather](token-weather) | 在输入框上方用“天气预报”显示上下文窗口用量 |
| [blast-radius](blast-radius) | 拦下有风险的 Bash 命令，先显示会影响什么，再等你选 Proceed 或 Cancel |
| [replay-theater](replay-theater) | 记录上一轮的文件编辑，逐个 diff 回放 |

需要 Claude Code **2.1.287 或更高版本**（`claude --version`）。

## 安装

```bash
git clone https://github.com/TLOBillyQ/claude-mods.git
claude plugin marketplace add ./claude-mods
claude plugin install token-weather@my-mods --scope user
claude plugin install blast-radius@my-mods --scope user
claude plugin install replay-theater@my-mods --scope user
```

装好后新开一个会话才会加载。

停用某一个：

```bash
claude plugin disable blast-radius@my-mods
```

拉取新版本后更新：

```bash
claude plugin marketplace update my-mods
```

只想临时试用、不安装：

```bash
claude --plugin-dir ./claude-mods/token-weather --plugin-dir ./claude-mods/blast-radius --plugin-dir ./claude-mods/replay-theater
```

## token-weather

每轮结束后读取上下文用量，在输入框上方画一行：天气图标、百分比、已用/总 token、最近 12 轮的迷你图，以及上一轮增加了多少。

| 用量 | 预报 |
|---|---|
| < 25% | ☀ Clear |
| 25–49% | ☁ Cloudy |
| 50–74% | ☂ Showers |
| 75–89% | ☇ Storm |
| ≥ 90% | ↯ Compact soon |

```
☀  Clear  18% of context  36.1k / 200k   last turns ▁▂▅  ▲ +12.4k last turn
```

## blast-radius

Claude 调用下面这些 Bash 命令时，mod 会先拦住，空跑一遍算出影响范围，再打开一个面板：

| 命令 | 怎么算影响范围 |
|---|---|
| `rm -r` / `rm -rf` | `find` + `du`：会删哪些文件、总大小 |
| `git reset --hard` | `git status --porcelain`：会丢掉哪些未提交改动 |
| `git clean` | `git clean -n`：会删哪些未跟踪文件 |
| 强推（`--force`、`--force-with-lease`、`+ref`） | `git log HEAD..<upstream>`：远端会丢哪些提交 |
| 数据库迁移（Django、Rails、Prisma、Alembic、Knex、Sequelize、Flyway） | Django 用 `showmigrations --plan` 列出待执行迁移，其他只做提示 |

按 `1` Proceed，命令照原样执行；按 `2` Cancel，Claude 会收到拒绝和原因。关掉面板或按 Esc 等于 Cancel。终端太窄放不下面板时，同样的内容会画在输入框上方。

> 它只读命令文本，`$(…)`、别名、调用 `rm` 的脚本都拦不住。它是安全网，不是权限系统；要硬性禁止请用权限规则。

## replay-theater

一轮对话里，mod 记录每次成功的 Edit、MultiEdit 和 Write（Write 会在写入前读取旧内容，所以 diff 是真实的）。回合结束后，输入框上方会出现提示：

```
↻ 3 edits across 2 files last turn  r: Replay  or /replay
```

运行 `/replay`（或聚焦提示条后按 `r`）打开回放面板：顶部是步骤条，下面是当前这一步的文件和 diff，`p` / `n` / `c` 对应 Prev / Next / Close，也可以点步骤条上的编号直接跳转。它只观察，不会阻止或修改任何编辑。

## 开发

每个 mod 的结构：

```
<mod>/
├── .claude-plugin/plugin.json   清单，types 指向类型契约
├── hooks/hooks.json             指向 hooks 模块
├── hooks/<mod>.mjs              导出 register(on)
├── types/index.d.ts             $.state 的类型契约
└── tests/<mod>.test.ts
```

校验和测试：

```bash
claude plugin validate ./blast-radius
claude plugin test ./blast-radius
```
