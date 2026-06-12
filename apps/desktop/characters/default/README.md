# 内置角色包 · default

VRM 模型二进制不入 git（见 `../.gitignore`）。本地开发时把 S3 下载的示例模型复制进来：

    cp apps/desktop/public/models/sample.vrm apps/desktop/characters/default/model.vrm

模型缺失时 Character 窗口自动降级为 DOM 情绪脸（行为通道契约不变），CI / e2e 不依赖模型。
manifest 字段定义见 `@desksoul/protocol` 的 `CharacterManifestSchema`；情绪/动作词表与
`persona-prompt-template.ts` 的 `DEFAULT_EMOTIONS` / `DEFAULT_ACTIONS` 对齐——模板教给
LLM 的标签必须全部可被运行时消费。
