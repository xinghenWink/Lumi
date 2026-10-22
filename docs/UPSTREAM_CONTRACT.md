# 上游实例契约

当前状态：**已完成模型列表、文本 SSE、单张生图和单参考图改图实测；vision 和边界参数未实测**。用户于 2026-10-22 提供实例连接信息，并授权生成一张拉布拉多仰望星空的测试图，随后授权额外一次移除月亮的改图。凭据仅注入探测子进程，未写入本文件或 Git。

| 项目            | 观察                                                                                                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 模型列表        | `GET /v1/models`，200，`application/json`，`data[].id`；实际返回 12 个模型                                                                                               |
| 聊天            | `gpt-5-3-mini`，`POST /v1/chat/completions`，system + user messages，`stream=true`；200，`text/event-stream; charset=utf-8`，约 10.17 秒，2 个 JSON chunk 后 `[DONE]`    |
| 生图            | `gpt-image-2`，`POST /v1/images/generations`，`quality=low`、`size=1024x1024`、`n=1`、`response_format=b64_json`；200，约 37.55 秒，1 个结果                             |
| 图像结果        | 存在 `b64_json` 和 `url` 字段；已解码 b64_json 为 PNG，2,327,146 字节，实际像素 **1254×1254**，与请求尺寸不同。URL 字段未验证是否非空或可下载                            |
| 改图            | `POST /v1/images/edits`，multipart/form-data，`image` 单 PNG 文件 + model / prompt / quality / size / n / response_format；200，约 31.70 秒，1 个结果。JSON 与多图未验证 |
| system / vision | system 消息随请求被接受，不能仅以 200 推断语义遵循；vision 尚未测试                                                                                                      |
| 限流            | 实际 429 / Retry-After 未观察；不主动制造限流，异常在 mock 中验证                                                                                                        |

实测时间：2026-10-22 15:09:06 起（Asia/Shanghai）。脱敏观察位于忽略的 `.tools/m3-proxy-observed.json`；测试 PNG 为 `.tools/m3-labrador.png`。本地产物不进入 Git。首次直连读取模型成功，后续直连失败；失败重测的 trace 显示未连接、未写出请求。使用本机显式配置的 HTTP 代理完成成功探测，不依赖隐式代理。

改图于 15:16:11 起实测：使用上一张 PNG、同一模型和 low / 1024×1024 / n=1，移除月亮及倒影。返回 PNG 2,443,707 字节，实际仍为 1254×1254，已目视复核保留拉布拉多与星空。观察为 `.tools/m3-edit-observed.json`，结果为 `.tools/m3-labrador-edited.png`。仅生成了用户授权的 1 张生图与 1 张改图。

实际模型 ID：`auto`、`gpt-5-3-mini`、`gpt-5-6`、`gpt-5-6-mini`、`gpt-5-6-t-mini`、`gpt-5-6-t-mini-mini`、`gpt-6`、`gpt-6-mini`、`gpt-6-t-mini`、`gpt-6-t-mini-mini`、`research`、`gpt-image-2`。不能仅按 ID 推断能力；用户目录仅返回平台别名和平台 UUID。

SSE 实际顶层字段：`choices`、`created`、`id`、`model`、`object`。适配器只抽取增量内容、结束原因和可选 usage，不把真实模型名透传到用户响应。

实例公开 schema 对生图声明 `n=1..4`，默认模型 `gpt-image-2`、默认 quality `auto`、默认 response_format `b64_json`，size 可为空；这些为 **schema 声明**，此次只验证上述一组参数，不宣称所有尺寸、质量和 n 上限均已通过。

## 实施影响

- M5 读取实际文件像素并记录请求 / 结果尺寸，不能把请求 size 当作实际尺寸或静默重写结果。
- 模型导入先停用，运营者依据已观察的能力配置后启用；未确认的编辑与 vision 默认关闭。
- 调用记录只含受控错误码、状态、耗时和请求 ID，不含密钥、原始供应商错误、图片数据和聊天正文。
- mock 使用同一模型列表 / SSE / 图像 data 容器结构；超时、401、429、5xx、部分结果和流中断是可控场景，不是实例实测结论。
