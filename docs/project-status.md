# ShangMethod 项目阶段性交接文档

> 最后核对日期：2026-08-14  
> 本文依据当前代码仓库、CloudBase migration、课程清单和已有验收记录整理。无法从仓库或已有记录证明的事项统一标记为“未确认”。

## 项目背景

### 产品目标

ShangMethod 是面向英语学习者的精听训练网站。产品围绕同一份音频材料建立从选材、听写、对照精学到熟练背诵的完整学习循环，同时提供查词、生词本、复习中心和学习记录。

课程内容目前继续以静态文件维护，不存入用户数据库。用户未登录时仍可使用浏览器本地存储；登录后，已实现的用户数据可同步到 CloudBase PostgreSQL。

### 用户流程

1. **Step 1 · 选择材料**：按音频时长筛选并选择课程。
2. **Step 2 · 反复听写**：播放材料音频、输入听写、使用 `[?]` 标记听不清的内容并保存草稿。
3. **Step 3 · 对照精学**：对照标准原文与听写结果，查看差异、逐句播放、查词、收藏生词并查看中文翻译。
4. **Step 4 · 熟练背诵**：查看或隐藏原文、参考原音、录制背诵并根据与原音的时长差获得节奏反馈。

辅助入口包括复习中心、学习记录以及登录/注册页面。

## 技术架构

### Web 应用

- Next.js `16.2.12`，App Router。
- React `19.2.4`。
- TypeScript。
- 主页面和现有 Step 1–4 主要位于 `app/page.tsx`。
- 全局样式位于 `app/globals.css`。
- 标准生产命令为 `next build` 和 `next start`。

### 课程与词典

- 课程清单位于 `public/lessons/lessons.json`。
- 当前清单包含 **79 门课程**。
- 每门课程目录位于 `public/lessons/{lesson-id}/`，包含音频和 transcript。
- 当前 78 门课程由 manifest 指向 `transcript-v2.json`，VOA Listening 001 仍指向 `transcript.json`。
- transcript-v2 的逐句 `start` / `end` 时间用于 Step 3 逐句播放和高亮。
- 全局英汉词典位于 `public/dictionary.json`。
- 课程素材生成、音文对齐、校验和 manifest 生成工具位于 `scripts/course-import/`。

### CloudBase Auth

- 浏览器客户端使用 `@cloudbase/js-sdk`。
- 客户端初始化位于 `lib/cloudbase/client.ts`。
- 当前需要：
  - `NEXT_PUBLIC_CLOUDBASE_ENV_ID`
  - `NEXT_PUBLIC_CLOUDBASE_REGION`
- `AuthProvider` 位于 `components/auth/auth-provider.tsx`，负责读取 Session、监听认证状态和退出登录。
- 登录/注册 UI 位于 `app/auth/page.tsx` 和 `components/auth/auth-form.tsx`。
- 当前注册流程为：用户名、邮箱、密码 → `signUp` → 邮箱 OTP → `verifyOtp` → 建立 Session。
- 用户 ID 在前端始终按 `String(user.id)` 处理，避免 CloudBase `bigint` 用户 ID 的 JavaScript 精度损失。

### CloudBase RDB

- 使用 CloudBase PostgreSQL。
- 独立 migration 位于 `cloudbase/migrations/202608130001_create_user_data_tables.sql`。
- 真实环境已确认的身份类型关系：
  - `auth.users.id` 为 `bigint`；
  - `auth.uid()` 返回 `text`；
  - RLS 使用 `(select auth.uid())::bigint` 与业务表用户字段比较。
- 浏览器通过 CloudBase RDB 客户端访问数据库，数据所有权由 PostgreSQL RLS 约束。

### localStorage

游客模式继续保留，本地数据始终先写入：

- 生词本：`shangmethod:vocabulary`
- 学习记录：`shangmethod:learning-records`
- 听写草稿：`shangmethod:dictation:{lessonId}`

localStorage 不按账号隔离，而是按浏览器 Origin 隔离。不同域名、端口或协议拥有不同的本地数据；同一 Origin 切换账号则仍能看到同一份本地数据。页面展示本地数据不等于云端越权读取。

### 数据同步架构

- localStorage 是即时数据源，云端失败不阻塞学习流程。
- 登录后的首次导入由 `CloudBaseSyncOrchestrator` 串行编排：

  ```text
  vocabulary → learning_records → dictation_drafts
  ```

- 同一时间只展示一个首次同步提示。
- 三个模块分别记录首次导入完成时间，互不复用状态字段。
- 登录状态下的新数据通过独立服务函数异步写入 CloudBase。
- CloudBase 业务访问集中在：
  - `lib/cloudbase/vocabulary.ts`
  - `lib/cloudbase/learning-records.ts`
  - `lib/cloudbase/dictation-drafts.ts`

## 已完成模块

### 学习产品

- Step 1 课程选择和时长筛选。
- Step 2 音频控制、听写、自动保存和 `[?]` 标记。
- Step 3 双栏对照、差异标红、逐句播放、高亮、查词、生词收藏和中文翻译。
- Step 4 原文隐藏/显示、原音参考、录音暂停/继续/结束/回听以及时长差反馈。
- 复习中心和学习记录。
- 静态课程清单加载和按需 transcript 加载。
- 批量课程生产、音文对齐、v2 生成、发布校验和 manifest 生成流程。
- 全局词典架构及离线词典生成流程。

### 用户登录注册

- CloudBase 用户名密码登录。
- 邮箱参与注册。
- `signUp → verifyOtp` OTP 验证码闭环代码。
- 登录 Session 获取和认证状态监听。
- 刷新后的 Session 恢复逻辑。
- 顶部导航登录状态和退出登录。

### Vocabulary 迁移

- 游客生词继续写入 localStorage。
- 首次登录可将本地生词批量 upsert 到 `vocabulary_entries`。
- 登录状态新增生词会异步写入 CloudBase。
- 删除生词会同步删除对应云端记录。
- 唯一键为 `(user_id, lesson_id, normalized_word)`。
- 原有本地数据不会在同步后删除。

已知边界：`local_import_completed_at` 一旦写入，首次同步弹窗不会再次出现。在首次导入完成后退出登录、以游客身份新增的数据，不会由“首次导入”自动补传；登录状态下新增的数据才会走持续同步。当前页面对持续同步失败采用静默降级，localStorage 仍保留数据。

### Learning records 迁移

- 首次导入和登录后的单条持续同步已实现。
- 合并规则：
  - `completed` 优先于 `in-progress`；
  - `recitationCompleted = true` 不被 `false` 覆盖；
  - `lastStudiedAt` 取最新；
  - `proficiency` 取最新记录；
  - `lessonTitle` 使用最新非空值。
- 主键为 `(user_id, lesson_id)`。

### Dictation 迁移

- 扫描全部 `shangmethod:dictation:*` 本地草稿。
- 首次同步支持本地上传、云端保留、相同内容自动完成和不同内容人工选择。
- 持续同步使用服务层统一防抖，当前延迟为 1 秒。
- Step 2 与 Step 3 使用同一同步入口。
- 冲突未解决时暂停该用户的持续上传，解决后恢复。
- 主键为 `(user_id, lesson_id)`。

### 同步编排

- 三个首次同步组件已改为串行执行。
- 游客状态不会渲染同步提示。
- 登录账号变化时从 vocabulary 阶段重新检查。

### RLS

- 五张用户数据表均开启 RLS。
- `anon` 被撤销五张表的权限。
- `authenticated` 获得 SELECT、INSERT、UPDATE、DELETE 权限。
- 每张表分别具有 SELECT、INSERT、UPDATE、DELETE Policy，共 20 条。
- 所有 Policy 按当前 CloudBase 用户 ID 检查数据所有权。

## 数据库状态

CloudBase PostgreSQL migration 定义并已报告部署验证以下结构：

| 表 | 主键/唯一约束 | 用途 |
| --- | --- | --- |
| `profiles` | `id bigint` 主键，外键到 `auth.users(id)` | 用户展示资料预留 |
| `vocabulary_entries` | `id uuid` 主键；`(user_id, lesson_id, normalized_word)` 唯一 | 生词本 |
| `learning_records` | `(user_id, lesson_id)` 联合主键 | 学习状态和背诵结果 |
| `dictation_drafts` | `(user_id, lesson_id)` 联合主键 | 听写草稿 |
| `user_sync_state` | `user_id` 主键 | 三模块首次导入状态和最近同步时间 |

共同约束和行为：

- 所有用户外键引用 `auth.users(id)` 并使用 `ON DELETE CASCADE`。
- `learning_records.status` 只允许 `in-progress` 或 `completed`。
- 五张表都有 `created_at`、`updated_at`；五个 trigger 维护 `updated_at`。
- `vocabulary_entries.id` 使用已在目标环境确认可用的 `gen_random_uuid()`。
- `user_sync_state` 包含：
  - `local_import_completed_at`
  - `learning_records_import_completed_at`
  - `dictation_import_completed_at`
  - `last_sync_at`
- 前端传入用户 ID 时使用字符串；PostgreSQL/API 层按目标表的 `bigint` 类型处理。

真实数据库的既有报告状态：五张表、主外键、CHECK、UNIQUE、ON DELETE CASCADE、五个 trigger、RLS 和 20 条 Policy 均已验证存在。仓库本身不能持续证明远程数据库此刻没有被后续修改。

## 测试验收记录

### 已通过或已有明确结果

- CloudBase Auth Web PoC：登录身份链路通过。
- Web SDK `user.id` 与 JWT `sub` 一致，已记录为同一数字身份。
- CloudBase Auth + PostgreSQL 身份 RPC / profiles RLS PoC 已完成验证。
- Vocabulary PoC：联合唯一键 upsert 已验证。
- 双账号 PoC：RLS 隔离已报告通过。
- CloudBase migration：表、约束、trigger、授权、RLS 和 Policy 已报告部署验证通过。
- 主项目 Vocabulary 同步已报告通过。
- 主项目 Learning records 同步已报告通过。
- 主项目 Dictation 首次同步和持续同步已报告通过。
- 同步编排的实现已完成静态检查。
- 未发现 CloudBase 用户 ID 被 `Number`、`parseInt` 或数学运算转换。
- 三个 CloudBase 服务未使用管理员 SecretKey，不绕过 RLS。
- TypeScript 检查、`npm run build` 和 `git diff --check` 在迁移验收阶段均有通过记录。

### 尚未形成可核对的完整验收记录

- `docs/cloudbase-e2e-test.md` 仍是未勾选的测试清单，没有保存具体测试日期、账号 ID 和逐项结果。
- 主项目新用户注册页面的“邮箱收信 → OTP 确认 → 自动进入首页 → 刷新保持 → 退出后重新登录”没有在仓库文档中形成完整结果记录。代码已实现，不等同于生产域名实测。
- Dictation 两个冲突选择分支及“冲突期间绝不上传”的完整人工结果没有形成书面记录。
- 正式部署域名下的 Auth、Session、RDB、音频 Range 请求和三模块同步尚未测试，因为生产部署尚未确认。
- 本轮项目状态文档没有连接远程数据库，因此不能确认测试账号/测试数据是否已清理。

## 部署状态

### 已确认完成

- Git 仓库已配置远端：`https://github.com/jenjenup/ShangMethod.git`。
- 项目具有标准 Next.js `build` 和 `start` 命令。
- 本地 `.env.local` 已配置两个 CloudBase 公共环境变量，具体值不写入本文。
- `.env*` 已被 `.gitignore` 忽略，当前没有环境文件被 Git 跟踪。
- CloudBase PostgreSQL 环境和业务表已报告创建、部署并验证。
- CloudBase 环境地域为上海，代码对应 `ap-shanghai`。

### 未确认或尚未完成

- **生产部署：未发现 Vercel、CloudBase Hosting、Docker、云服务器或 CI/CD 部署配置；不能确认网站已经上线。**
- **生产域名：未确认。** 仓库没有正式域名配置或说明。
- **ICP 备案：未确认。** 仓库没有备案信息，是否需要及是否完成取决于最终中国大陆托管与域名方案。
- **生产环境变量：未确认。** 只能确认本地变量存在，不能确认部署平台已经配置。
- **CloudBase 正式安全来源：未确认。** 正式 Web 域名需要加入 CloudBase 安全来源列表。
- **HTTPS、DNS、CDN 和音频流量方案：未确认。**
- **远程 GitHub 是否包含当前本地全部改动：未确认。** 当前工作区存在大量未提交的新文件和修改。

当前 `public/lessons` 约 685 MB，含 79 个 MP3，单文件最大约 22 MB。最终部署平台必须验证构建包、静态资源、Range 请求、带宽成本和中国大陆访问表现。

## 当前风险

### 上线阻塞风险

1. **尚无可确认的生产部署。** 没有正式 URL、平台配置或部署记录。
2. **正式域名和 CloudBase 安全来源未确认。** 未配置时 Web SDK 可能因非法来源或跨域限制失败。
3. **Git 工作区未整理。** 大量课程、认证、同步和文档文件尚未提交；基于远端仓库部署可能缺失当前成果。
4. **静态课程体积较大。** 685 MB 音频会影响 Git、部署包、CDN、带宽和大陆访问体验。
5. **旧 Supabase 回调仍可访问。** `app/auth/callback/route.ts` 仍执行 Supabase code exchange，但当前 CloudBase OTP 流程不需要该路由。

### 代码和数据风险

1. Supabase 依赖、client/server、三套旧同步组件和 migration 仍保留。旧同步组件未挂载，但增加维护混淆和依赖体积。
2. Vocabulary 首次导入是一次性标记；首次导入完成后产生的“游客新增数据”没有登录后补偿扫描。
3. 页面中的若干持续同步调用在失败时静默降级，用户不会看到云端同步错误。
4. localStorage 不区分账号。同一浏览器切换账号时页面仍可能显示游客或前一位使用者留下的本地数据，但 RLS 仍负责云端隔离。
5. Auth OTP 验证函数保存在组件内存状态；注册过程中刷新页面会丢失该步骤，需要重新发起注册。
6. 测试数据是否已从 CloudBase 清理尚未确认。
7. `profiles` 表已经建立，但当前产品没有完整资料管理流程。

### 维护风险

1. 根 README 仍是 `create-next-app` 默认内容，没有项目、环境变量和部署说明。
2. 没有 `.env.example` 展示主项目所需变量名。
3. `package.json` 没有固定 Node.js `engines`。
4. `cloudbase-poc/` 和正式项目同仓存在，需在长期维护中明确其归档策略。
5. E2E 验收文档没有填写实际结果，历史验证主要依赖阶段沟通记录。

## 下一步建议

### 上线前优先顺序

1. 确定最终部署平台和正式域名，并确认是否涉及 ICP 备案。
2. 验证部署平台能否承载约 685 MB 的静态课程音频，以及是否支持稳定的音频 Range 请求和大陆访问。
3. 在 CloudBase 控制台添加正式域名到安全来源列表。
4. 在部署平台配置：
   - `NEXT_PUBLIC_CLOUDBASE_ENV_ID`
   - `NEXT_PUBLIC_CLOUDBASE_REGION`
5. 移除或禁用已经无效的 Supabase `/auth/callback` 路由；其余 Supabase 文件可在稳定后集中清理。
6. 更新 README，并提供不含真实值的 `.env.example`。
7. 整理 Git 工作区，确认课程、词典、manifest、CloudBase migration 和正式代码全部进入预期提交。
8. 再执行 TypeScript、production build 和必要的数据清单校验。
9. 先部署预览环境，再用实际域名验证：
   - 首页和 79 门课程加载；
   - 音频播放与逐句播放；
   - 注册、OTP、登录、退出和刷新 Session；
   - Vocabulary、Learning records、Dictation 各一条真实同步；
   - CloudBase 安全来源和 RLS 请求无错误。
10. 确认测试账号和测试数据清理边界后再开放正式流量。

### 上线后优化

- 将 MP3 迁移到面向大陆访问的对象存储/CDN，并让课程 manifest 指向稳定资源地址。
- 删除 Supabase 依赖、旧 client/server、旧同步组件并归档旧 migration。
- 为后台同步增加非阻塞但可观察的状态和重试机制。
- 设计已完成首次导入后的游客数据补传策略。
- 明确多账号共用浏览器时 localStorage 的产品提示或账号分区方案。
- 把 CloudBase 验收结果、测试日期和生产冒烟结果写回长期文档。
- 增加自动化的课程清单校验、构建检查和部署流水线。

## 维护约定

- 本文只记录已被代码、仓库文件或明确验收结果支持的状态。
- 每次认证、数据库、课程格式、部署平台或同步策略发生变化后，应更新本文日期和对应章节。
- 生产环境中的域名、环境 ID、用户 ID、Token、Secret 和测试账号密码不得写入本文。
- “代码已实现”“本地已验证”“PoC 已验证”“生产已验证”必须分开记录，不应互相替代。
