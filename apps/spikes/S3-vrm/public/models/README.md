# 把 VRM 模型放这里

S3 spike 需要一个 VRM 模型文件，命名为 `sample.vrm`，放在本目录下：

```
apps/spikes/S3-vrm/public/models/sample.vrm
```

## 从哪里找免费模型

- **VRoid Hub**（https://hub.vroid.com）：筛选 **CC0** 或「允许二次创作」授权的模型下载。
- **VRoid Studio**：自己捏一个导出 `.vrm`。
- pixiv/three-vrm 官方示例模型：`VRM1_Constraint_Twist_Sample.vrm`（仓库 `packages/three-vrm/examples/models/` 下有）。

VRM 0.x 和 1.0 都支持。1.0 的 expression preset 名（`happy/angry/sad/relaxed/surprised`）能直接命中；
0.x 模型的 BlendShape 名大小写可能不同，渲染器里做了大小写兜底。

> 模型文件不进 git（见 `.gitignore`）。放好后 `pnpm --filter @desksoul/spike-s3 dev` 即可。
