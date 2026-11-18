# 安装与设置 — 简体中文

**dsh-blender-live** 用于把 DeepSeek Harness（DSH）连接到 Blender，并在 DSH 的
Web 界面里显示一个类似视频剪辑软件的 **参考图 | 实时视口** 双画面监看窗口。

整套只包含 **两个需要安装的东西**，并且都在同一个仓库里：

| 序号 | 内容 | 运行位置 |
|---|---|---|
| 1 | **Blender 连接器**（一个小型附加组件） | Blender 内部 |
| 2 | **DSH 插件包**（插件本体） | DSH 内部 |

除此之外不需要任何东西：不用额外下载、不用 npm 包、不开第二个端口、不依赖任何外部服务。

---

## 0 · 前置条件

- **Blender 4.2 或更高版本**（本插件在 5.3 上开发并验证）。
- **DeepSeek Harness**，并带有可以打开 `http://127.0.0.1:3080` 的 Web 配置（profile）。
- 两者必须运行在 **同一台机器** 上，因为桥接只通过本机回环地址通信。

---

## 1 · 安装 Blender 连接器

连接器就是仓库里的文件夹 `blender/dsh_blender_live/`（里面是 `__init__.py` 和
`blender_manifest.toml`）。下面两种方式 **任选其一**。

### 方式 A —— 打包成 zip 安装（推荐）

1. 打开克隆下来的仓库，进入 `blender/` 目录。
2. 制作一个 zip，要求 **zip 的根目录直接包含** `__init__.py` 与 `blender_manifest.toml`
   （也就是把 `dsh_blender_live/` 文件夹里的内容打包，而不是打包文件夹本身）。

   PowerShell：

   ```powershell
   cd <仓库路径>\blender\dsh_blender_live
   Compress-Archive -Path * -DestinationPath ..\dsh_blender_live.zip -Force
   ```

   macOS / Linux：

   ```bash
   cd <仓库路径>/blender/dsh_blender_live
   zip -r ../dsh_blender_live.zip . -x '__pycache__/*'
   ```

3. 在 Blender 中打开 **编辑 → 偏好设置 → 获取扩展 → 右上角 ⌄ → 从磁盘安装…**
4. 选择 `dsh_blender_live.zip` 并确认。
5. 打开 **偏好设置 → 插件**，搜索 `DSH`，勾选 **“DSH Blender Live Connector”**。

### 方式 B —— 直接复制文件夹（无需压缩）

1. 按 `Win + R`，输入 `%APPDATA%\Blender Foundation\Blender`，回车。
2. 打开与你 Blender 版本对应的文件夹（例如 `5.3`），再进入 `extensions\user_default`；
   如果不存在 `user_default`，就自己新建一个。
3. 把整个 `dsh_blender_live` 文件夹复制进去，最终结构应为：

   ```
   …\Blender\5.3\extensions\user_default\dsh_blender_live\blender_manifest.toml
   …\Blender\5.3\extensions\user_default\dsh_blender_live\__init__.py
   ```

4. **重启 Blender**，然后打开 **偏好设置 → 插件 → 搜索 `DSH` → 勾选**。

### 确认连接器已在监听

在 3D 视口按 `N`，打开 **DSH** 标签页，应当看到：

```
Listening on 127.0.0.1:9876     [Stop]
```

DSH 默认连接 **9876** 端口。如果 9876 已被占用（例如旧版 `blender_mcp` 插件正在使用），
连接器会自动依次尝试 9877–9881，并在面板上显示实际使用的端口。若它用的不是 9876，
请在启动 DSH 之前把环境变量 `DSH_BLENDER_LIVE_PORT` 设为该端口。

> 连接器会在 Blender 启动时自动开启。可以在
> **偏好设置 → 插件 → DSH Blender Live Connector → 偏好设置** 中关闭
> “Start when Blender loads”，或修改首选端口。

---

## 2 · 安装 DSH 插件包

1. 把克隆的仓库放在一个 **不会移动** 的固定目录（DSH 会链接到这个目录，移动或删除都会让插件失效）。
2. 在 DSH 对话里对助手说：

   > install the bundle at `D:\你的路径\仓库目录`

   助手会调用插件管理器，把这个目录链接进你的 DSH 配置并启用插件包。
3. **重启 Harness** —— 主机端代码和 Web 界面资源只有在重启后才会重新加载。
   关闭正在运行 `dsh web` 的终端窗口，再重新启动。
4. 对话记录不会丢失，从侧边栏重新打开即可。

---

## 3 · 验证是否工作

1. **主机接口** —— 在浏览器打开，或在 PowerShell 中执行：

   ```powershell
   (Invoke-WebRequest http://127.0.0.1:3080/x-blender-live/status).Content
   ```

   应返回类似 JSON（数值会不同）：

   ```json
   {"ok":true,"port":9876,"blend":"my_scene.blend","engine":"CYCLES","objects":741,"frame":450,...}
   ```

2. **监看窗口** —— 在 DSH 对话里滚动到最底部：在 **输入框正上方** 会出现一条双画面条带，
   左侧是 **REFERENCE（参考图）**，右侧是 **LIVE PROGRAM（实时视口）**。

3. **Blender 工具** —— 对助手说：

   > what does blender_status say?

   它应当回报当前打开的 `.blend`、场景、渲染引擎和物体数量。

---

## 4 · 使用说明

### 监看窗口控件

| 控件 | 含义 |
|---|---|
| `❚❚ / ▶` | 暂停 / 恢复自动采集 |
| `⟳` | 立刻采集一帧 |
| 时间码 `00:01:23` | 该监看窗口已打开的时长 |
| `#07` | 已采集的帧数 |
| 进度条 | 采集节奏（提示下一帧即将到来） |
| `174 ms` | 上一帧的渲染耗时 |
| `1s 2s 4s 8s` | 采集间隔 —— 场景越重，选越慢越流畅 |
| `◀ ▶` | 上一张 / 下一张参考图（同一文件夹内） |
| `⏺` | 把当前实时画面固定为参考图（A/B 对比） |
| `⤢` | 打开全尺寸面板（实验性） |

当浏览器标签页切到后台时，采集会自动停止。

### 指定参考图

对助手说：

> set the reference to `D:\refs\nose_cutaway_side.png`

它实际会写入这个文件：

```
%TEMP%\dsh-blender-live\reference.json
```

```json
{ "path": "D:\\refs\\nose_cutaway_side.png", "label": "nose cutaway - side - 8 m" }
```

也可以手动编辑：按 `Win + R` 输入 `%TEMP%`，进入 `dsh-blender-live`，编辑
`reference.json`，几秒内监看窗口就会更新。支持 PNG、JPEG、WebP、GIF、BMP、TIFF。
`◀ ▶` 会遍历该文件所在文件夹里的所有图片，所以一个 `refs\` 文件夹就是一个可翻阅的参考图库。

### 让相机角度对齐参考图

> match the viewport angle to the reference

助手可以把视口设为正交侧视图、并对同一段机身取景，两个画面就会对齐。
插件不会强制锁定你的场景：你随时可以自己转动视口，实时画面会跟着变化。

### 可用的助手工具

| 工具 | 示例说法 |
|---|---|
| `blender_status` | “Blender 连上了吗？” |
| `blender_run` | “把客舱灯调亮 20%” |
| `blender_run_script` | “运行 `scripts/build_cockpit.py`” |
| `blender_snapshot` | “把当前相机渲染保存到 `out.png`” |

---

## 5 · 故障排查

| 现象 | 原因 / 解决办法 |
|---|---|
| 实时画面显示 **NO SIGNAL** | Blender 未打开，或连接器未启动。在 Blender 中按 `N` → **DSH** 标签 → **Start**。 |
| 参考图显示 **NO REFERENCE** | `reference.json` 不存在、指向的文件已被删除，或图片类型不受支持。 |
| 完全看不到监看窗口 | 安装后没有重启 Harness，或仓库目录被移动。重新安装插件包并重启 DSH。 |
| `/x-blender-live/...` 返回 **404** | 安装或升级后没有重启 Harness。 |
| `/status` 显示 `"error": "…did not answer within 30000 ms"` | Blender 正忙（长时间渲染）或被模态对话框阻塞。关掉对话框后重试。 |
| 连接器总是用 9877 | 9876 已被占用（例如旧版 `blender_mcp`）。可以继续用旧插件走 9876，或在启动 DSH 前设置 `DSH_BLENDER_LIVE_PORT=9877`。 |
| 建模时画面一卡一卡 | 把采集间隔调到 `4s` / `8s`，或拖动重物时按 `❚❚` 暂停。 |
| 升级后 DSH 界面空白或错乱 | 客户端资源是旧的：重启 Harness（在以链接方式安装时，仅刷新页面不够）。 |

---

## 6 · 它会在你的电脑上动什么

- **只读写** 你要求它改动的 Blender 状态，以及这些临时文件：

  ```
  %TEMP%\dsh-blender-live\frame.jpg              最新视口画面
  %TEMP%\dsh-blender-live\reference-pinned.jpg   固定下来的画面（使用 ⏺ 时）
  %TEMP%\dsh-blender-live\reference.json         参考图指针
  ```

- 每次采集都会 **还原** 它改动过的渲染设置（输出路径、格式、色彩模式、质量、分辨率、
  边框、覆盖写入），即使采集失败也会还原。
- 连接器 **只监听** `127.0.0.1:9876`，来自其他机器的请求会被拒绝。
- 连接器在 Blender 里执行 Python，**没有任何身份验证**。任何能访问该端口的人都能在你的
  Blender 会话里运行代码。请务必保持在回环地址上。

## 7 · 卸载

1. DSH：让助手移除该插件包，或在「插件」页面移除，然后重启 Harness。
2. Blender：**偏好设置 → 插件**，取消勾选 **DSH Blender Live Connector**（也可以顺手删除）。
3. 可选：删除 `%TEMP%\dsh-blender-live\` 目录。
