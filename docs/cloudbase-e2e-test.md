# ShangMethod CloudBase 端到端验收清单

本文用于验收主项目 CloudBase Auth、PostgreSQL RLS 与用户数据同步。测试环境应使用主项目，而不是 `cloudbase-poc`。

## 测试前准备

- 确认主项目 `.env.local` 已配置 `NEXT_PUBLIC_CLOUDBASE_ENV_ID` 和 `NEXT_PUBLIC_CLOUDBASE_REGION`。
- 确认 CloudBase 身份认证已开启用户名密码登录和邮箱验证码注册。
- 准备两个从未使用过的测试账号 A、B，并使用两个相互隔离的浏览器会话（普通窗口与无痕窗口，或两个不同浏览器）。
- 不要发送或记录密码、验证码、Access Token、Refresh Token。
- 测试前记录浏览器类型、项目版本与测试时间。

| 项目 | 记录 |
| --- | --- |
| 测试日期 |  |
| 测试人员 |  |
| 主项目地址 |  |
| CloudBase 环境 |  |
| 账号 A 用户 ID |  |
| 账号 B 用户 ID |  |

## A. 新用户注册与 Session

1. 使用无痕浏览器打开主项目 `/auth`。
2. 选择“注册”。
3. 输入新的用户名、可接收邮件的邮箱和密码。
4. 点击“创建账号”。
5. 确认页面显示邮箱验证码输入框。
6. 从邮箱获取验证码并点击“确认注册”。
7. 确认自动进入首页，顶部显示当前用户名或邮箱。
8. 记录该用户的 CloudBase 用户 ID。可在 CloudBase 用户管理中核对，不要把 ID 转成 JavaScript Number。
9. 刷新页面，确认仍为登录状态。
10. 退出登录，再用用户名和密码登录一次。

验收记录：

- [ ] 注册请求成功
- [ ] 收到邮箱验证码
- [ ] 验证码确认成功
- [ ] 注册完成后建立 Session
- [ ] 刷新后 Session 保持
- [ ] 退出登录成功
- [ ] 用户名密码重新登录成功
- 用户 ID：
- 实际错误信息（如有）：
- 结论：通过 / 不通过

## B. Vocabulary 生词本

### B1. 游客本地保存

1. 退出登录。
2. 进入任意课程 Step 3。
3. 点击英文单词并加入生词本。
4. 在浏览器开发工具中确认 `shangmethod:vocabulary` 已写入该词。
5. 打开复习中心，确认生词显示正常。

- [ ] 游客可以添加生词
- [ ] localStorage 即时写入
- [ ] 未登录时没有 CloudBase 用户数据写入

### B2. 首次导入和持续同步

1. 保留刚才的本地生词并登录测试账号。
2. 确认第一个出现的是“生词本云同步”提示。
3. 点击“同步到账号”。
4. 确认同步成功提示，然后进入下一同步阶段。
5. 登录状态下再收藏一个新词，确认持续 upsert。
6. 重复收藏同一课程同一单词，确认不会产生重复记录。

在 CloudBase PostgreSQL SQL 编辑器中进行管理员视角核对：

```sql
select *
from public.vocabulary_entries
order by created_at desc
limit 20;
```

检查：

- [ ] `user_id` 等于当前测试账号数字 ID
- [ ] `word` 正确
- [ ] `normalized_word` 正确
- [ ] `lesson_id` 正确
- [ ] `meaning` 和 `example` 正确
- [ ] `(user_id, lesson_id, normalized_word)` 没有重复
- [ ] `user_sync_state.local_import_completed_at` 已填写
- 结论：通过 / 不通过

## C. Learning records 学习记录

1. 游客或登录用户选择一门课程开始学习。
2. 确认 `shangmethod:learning-records` 已出现该课程，状态为 `in-progress`。
3. 登录后按编排顺序进入“学习记录云同步”。
4. 点击“同步到账号”。
5. 完成 Step 4，确认该课程更新为 `completed`，并记录背诵结果。
6. 等待云端持续同步完成。

数据库核对：

```sql
select *
from public.learning_records
order by created_at desc
limit 20;
```

检查：

- [ ] `user_id` 正确
- [ ] `lesson_id`、`lesson_title` 正确
- [ ] `status` 为 `in-progress` 或 `completed`
- [ ] 完成课程后 `status = 'completed'`
- [ ] `last_studied_at` 为最近学习时间
- [ ] `recitation_completed` 正确
- [ ] `proficiency` 正确
- [ ] 同一用户同一课程只有一条记录
- [ ] `user_sync_state.learning_records_import_completed_at` 已填写
- 结论：通过 / 不通过

## D. Dictation drafts 听写草稿

1. 进入课程 Step 2。
2. 输入一段可辨识的测试文字。
3. 确认 `shangmethod:dictation:{lessonId}` 立即保存。
4. 停止输入并等待至少 2 秒，让防抖同步执行。
5. 进入 Step 3 修改听写，再等待至少 2 秒。
6. 确认 Step 2 与 Step 3 更新的是同一条云端草稿。

数据库核对：

```sql
select *
from public.dictation_drafts
order by updated_at desc
limit 20;
```

检查：

- [ ] `user_id` 正确
- [ ] `lesson_id` 正确
- [ ] `content` 是停止输入后的最新全文
- [ ] 同一用户同一课程只有一条记录
- [ ] `updated_at` 随后续修改更新
- [ ] `user_sync_state.dictation_import_completed_at` 已填写
- 结论：通过 / 不通过

### D2. 冲突测试

1. 为同一账号、同一课程准备内容不同的本地草稿和云端草稿。
2. 确保 `dictation_import_completed_at` 尚未完成后重新登录。
3. 确认出现冲突弹窗，并同时显示两个版本。
4. 冲突未解决时继续输入，确认 localStorage 仍可更新。
5. 确认冲突期间云端没有被防抖同步提前覆盖。
6. 分别测试“使用本地”和“使用云端”。
7. 所有冲突处理完后，确认持续同步恢复。

- [ ] 冲突期间输入不受影响
- [ ] 冲突期间云端版本未被自动覆盖
- [ ] 使用本地会更新云端
- [ ] 使用云端会更新 localStorage
- [ ] 完成后写入 `dictation_import_completed_at`

## E. 双账号 RLS 隔离

### 重要说明

不要通过页面展示判断云端隔离。页面当前优先读取 localStorage，而同一浏览器的 localStorage 不区分账号。看到另一个账号留下的本地内容，不等于读取了其 CloudBase 数据。

CloudBase SQL 编辑器通常使用管理员数据库连接，可以查看所有用户的数据。SQL 编辑器适合确认记录是否存在，不适合单独证明 RLS。RLS 必须使用两个独立的普通用户 Session 验证，且不能使用管理员 SecretKey。

### E1. 账号 A 写入唯一数据

在账号 A 的普通 Web Session 下写入：

- Vocabulary：`lesson_id = 'rls-test-A'`，`word = 'rls-test-A'`，`normalized_word = 'rls-test-a'`
- Learning record：`lesson_id = 'rls-test-A'`
- Dictation：`lesson_id = 'rls-test-A'`，`content = 'rls-test-A'`

用 SQL 编辑器确认三条记录真实存在，并记录账号 A 的 `user_id`。

### E2. 账号 B 读取账号 A

必须在账号 B 的普通 CloudBase Web Session 中，通过 CloudBase RDB SDK 查询，故意传入账号 A 的 `user_id` 和 `lesson_id = 'rls-test-A'`。

三张表都应得到：

```text
error: null
data: []
```

SELECT 被 RLS 隐藏时通常返回 0 行，而不是权限错误。

### E3. 账号 B 伪造写入账号 A

在账号 B Session 下，以账号 A 的 `user_id` 对三张表执行 insert/upsert。

预期：

```text
写入返回 row-level security / policy violation 类错误
账号 A 原数据没有改变
```

### E4. 账号 B 删除账号 A

在账号 B Session 下，以账号 A 的 `user_id` 和测试 lesson ID 执行删除。

预期：

- 删除 0 行或返回空结果；
- 账号 A 重新查询时记录仍存在。

验收记录：

| 表 | B 查询 A | B 伪造写入 A | B 删除 A | 结论 |
| --- | --- | --- | --- | --- |
| `vocabulary_entries` |  |  |  |  |
| `learning_records` |  |  |  |  |
| `dictation_drafts` |  |  |  |  |

- 账号 A 用户 ID：
- 账号 B 用户 ID：
- 实际 SELECT 返回：
- 实际伪造写入错误：
- RLS 总结：通过 / 不通过

## F. 首次同步编排

准备一个同时包含生词、学习记录和听写草稿的游客浏览器，再登录尚未导入过这些数据的账号。

确认弹窗严格按以下顺序出现：

```text
Vocabulary → Learning records → Dictation
```

- [ ] 同一时间只出现一个弹窗
- [ ] 生词完成或跳过后才检查学习记录
- [ ] 学习记录完成或跳过后才检查听写
- [ ] “暂不处理”不会写入对应导入完成时间
- [ ] 退出登录后不再出现同步弹窗

## G. 最终验收结论

| 模块 | 结果 | 问题编号/备注 |
| --- | --- | --- |
| 新用户注册 | 通过 / 不通过 |  |
| Session 恢复 | 通过 / 不通过 |  |
| Vocabulary | 通过 / 不通过 |  |
| Learning records | 通过 / 不通过 |  |
| Dictation drafts | 通过 / 不通过 |  |
| 首次同步编排 | 通过 / 不通过 |  |
| 双账号 RLS | 通过 / 不通过 |  |

只有以上项目全部通过，才进入 Supabase 遗留代码清理和正式部署阶段。
