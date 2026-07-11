# openpet 图标资产

品牌符号「耳朵气泡」：一个圆润对话气泡 + 两只耳尖，同时读出"AI 对话"与"桌面宠物"两层含义。

| 文件 | 用途 |
| --- | --- |
| `openpet-icon.svg` | 主图标源文件（渐变瓦片 `#F8697B → #FEA583` + 白色符号，圆角率 22.5%） |
| `openpet-tray.svg` | 纯白符号（无底板），托盘/暗色场景用 |
| `png/openpet-{16..256}.png` | 从 SVG 光栅化的各尺寸 PNG（含透明通道） |
| `preview.html` | 多尺寸预览页（本地起 http 服务打开，file:// 下 SVG 不加载） |

## 衍生产物（不在本目录）

- `apps/desktop/build/icon.ico` — 7 尺寸（16/24/32/48/64/128/256）合成的 Windows 图标，electron-builder `win.icon` 引用。
- `apps/desktop/resources/tray/{default,thinking,error}.png` — 32px 三态托盘图标：白符号 / 琥珀点（思考中）/ 红点（错误），角标带透明间隙。

## 改图标时如何重新生成

1. 改 `openpet-icon.svg` / `openpet-tray.svg`。
2. 用浏览器 canvas 把 SVG 画到各尺寸画布导出 PNG（保透明；本仓库无 sharp/resvg 依赖），存入 `png/`。
3. 用 Pillow 合成 ico：`imgs[256].save('icon.ico', format='ICO', append_images=[...], sizes=[(s,s) for s in sizes])`。
4. 托盘三态：32px 白符号；thinking/error 在 (23.5, 23.5) 处先挖 r=10 透明圆再画 r=7.5 色点（`#F5A623` / `#F04438`）。
