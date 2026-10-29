# Changelog

## 0.2.0 - 2026-10-30

- 更新 Agnes 3.0 Flash、2.5 Flash 和 2.5 Pro Beta 的聊天、流式回复、工具调用、看图能力，以及 `none` / `high` 思考开关。
- 默认提供合计 8 个聊天、图片和视频模型；过滤已退役的 2.0 Flash 和 2.5 Pro Alpha。
- 图片选择器改用 `gpt-image-agnes-*` 别名，实际请求还原为 `agnes-image-*`；升级后需重新选择图片模型。
- 支持 multipart 与 JSON 图片编辑，将参考图和返回格式转换为 Agnes `/v1/images/generations` 所需的 `extra_body` 字段。
- 支持视频创建、轮询、下载，以及重启后可恢复的任务标识；支持公开 URL 参考素材。视频需 Magpie 0.1.2077+，Flash 限 720P、4 到 12 秒。
- 保留 `/v1/dashboard/billing/subscription` 密钥验证，公共模型目录仅用于发现模型；登录状态不推算余额。
- 保留包名 `opencode-agnes-auth`、provider `agnes`、原有 API key 登录方式和仓库图标；补充 Windows 安装入口与中文说明。
- 增加 Windows / Ubuntu、Node.js 22 / 24 的测试、检查和打包验证，无需安装运行依赖或使用真实 key。

本版本的生成协议通过模拟测试验证，未使用有效 key 完成生产环境生成验证。
本地 Node.js 26.12.1 与 Magpie 的 Bun 1.4.4 均通过 92 项测试；云端 CI 已配置，但本次因 GitHub Actions 不可用而未执行。
