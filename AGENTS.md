# 维护约定

- 只维护本仓库作为分发来源。保留 `opencode-agnes-auth` 包名、`agnes` provider、`icon.png` 和 MIT 许可。
- 保持 ESM 和零运行依赖，优先使用 Magpie 现有能力；不增加额外服务、中间件或后台进程。
- 使用模拟请求验证功能，不使用真实 API key，不发起真实生成或付费请求，不读取或修改用户的 Magpie 账号配置。
- `/v1/models` 是公共目录，不能用于确认 key 有效。密钥状态通过 `/v1/dashboard/billing/subscription` 验证；无官方证据时不宣称余额、价格或促销。
- 图片选择器使用 `gpt-image-agnes-*` 别名，实际请求还原为 `agnes-image-*`。图片编辑按 Agnes 协议使用嵌套的 `extra_body` 字段。
- 视频任务标识必须携带真实 `video_id` 和模型，重启后仍能轮询。下载不得携带 provider 密钥、Cookie 或跟随重定向。
- 视频需要 Magpie 0.1.2077+；保留 Flash 的 720P、4 到 12 秒限制。参考素材限公开 URL，不宣称支持本地文件上传或 Data URI 参考。
- 提交前运行 `npm test`、`npm run check`、`npm pack --dry-run --ignore-scripts`，核对打包文件与 README。模拟测试通过不等于生产环境实测。
