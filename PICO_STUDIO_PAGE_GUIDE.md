# PICO 创作台页面逻辑（可修改说明）

## 目标

创作台只保留一个中心创作框。用户先选择 **对话 / 生图 / 视频**，再在同一个框中输入、上传素材并提交任务。模型目录、作品、钱包、API 和设置不占据主画布，只放在右侧收起功能栏中。

## 文件职责

| 文件 | 负责内容 | 修改建议 |
| --- | --- | --- |
| `apps/web/src/components/workbench/ModelWorkspace.tsx` | 创作台 React 结构、输入、提交、任务结果 | 改按钮文案、输入框布局、动物组件位置时改这里 |
| `apps/web/src/components/AppShell.tsx` | 选择模型、右侧功能栏、模式切换后打开模型目录 | 想隐藏或新增右侧功能时改这里 |
| `apps/web/src/app/globals.css` | 小动物像素奶油风的颜色、网格、尺寸和响应式样式 | 只想调整视觉时优先改这里 |
| `apps/web/src/components/PixelPet.tsx` | 小猫、小兔、小熊 SVG 像素形象 | 想换动物、耳朵、脸色或像素细节时改这里 |

## 页面状态与流程

```text
进入 /app/models/:modelCode
        ↓
ModelWorkspace 根据 model.category 判断当前模式
        ↓
对话(isChat) / 生图(isImage) / 视频(isVideo)
        ↓
点击模式按钮 → onOpenModelPicker("chat" | "image" | "video")
        ↓
AppShell 打开对应分类的模型目录 → 用户选中模型
        ↓
回到同一个 ModelWorkspace 输入框提交
        ↓
聊天写入 messages；图像/视频写入 taskStatus、taskOutput、taskImages、taskVideos
        ↓
有结果后，输入框回到底部，主区展示对话或任务结果
```

## 当前主界面的关键节点

`ModelWorkspace.tsx` 里的 `isEmptyStudio` 控制初始态：

```ts
const isEmptyStudio = messages.length === 0 && !taskOutput && !taskStatus;
```

- 初始态：`.pico-studio-empty` 让输入框垂直居中。
- 提交后：输入框回到页面底部，结果出现在中间滚动区。
- 三个模式按钮使用 `.pico-simple-mode-tabs` 和 `.pico-mode-chip`。
- 输入容器使用 `.pico-universal-composer` → `.pico-cream-composer-wrap` → `.soft-input`。
- 三只装饰小动物为 `pico-composer-pet-cat`、`pico-composer-pet-bunny`、`pico-composer-pet-bear`。

## 主页内切换（最新）

现在模型与工作流不需要进入模型目录或跳转 URL：

```text
输入框内“当前模型”按钮
        ↓
`.pico-inline-model-menu` 打开
        ↓
对话 / 生图 / 视频：调用 onSelectModel(code)
工作流：调用 onSelectWorkflow(code)
        ↓
AppShell 仅更新 React 状态（section、activeModelCode、activeAgentCode）
        ↓
同一个主页容器内替换当前工作区，不执行 router.push
```

`AppShell.tsx` 中的 `selectInlineModel` 与 `selectInlineWorkflow` 是这套行为的唯一入口。要改变“切换后做什么”，优先修改这两个函数。

公开首页的四个入口会带上 `?mode=chat|image|video` 或 `?section=workflows` 进入 `/app`；`AppShell.tsx` 读取这些参数并直接打开对应的能力。

## 只改视觉时改什么

在 `globals.css` 最后的 **PICO cream pet studio** 区块中修改即可：

| 想改的内容 | CSS 选择器 |
| --- | --- |
| 页面奶油背景与像素网格 | `.pico-pixel-shell:has(.pico-studio-simple)`、`.pico-studio-main` |
| 右侧功能栏 | `.pico-utility-rail`、`.pico-utility-tool` |
| 三个模式按钮 | `.pico-simple-mode-tabs`、`.pico-mode-chip` |
| 对话输入框 | `.pico-studio-simple .soft-input` |
| 小动物位置 | `.pico-composer-pet-cat/bunny/bear` |
| 手机端位置 | 文件末尾的 `@media (max-width: 640px)` |

建议只改这个区块的颜色值，不要修改上方用于模型调用、上传、价格估算和任务轮询的 TypeScript 逻辑。

## 常用改法

### 1. 彻底隐藏右侧功能栏

在 `AppShell.tsx` 中，把桌面 `<aside>` 的渲染条件改为你需要的权限条件；仅靠 CSS 可先加：

```css
.pico-pixel-shell:has(.pico-studio-simple) .pico-utility-rail {
  display: none !important;
}
```

### 2. 把三个切换按钮改成三个独立卡片

保留每个按钮的 `onClick={() => onOpenModelPicker("...")}` 不变，只改 `.pico-simple-mode-tabs` 的 `display` 为 `grid`，并给 `.pico-mode-chip` 更高的 `height`。

### 3. 新增第四种能力

需要先在后端/模型配置中存在该 `category`，再增加一个模式按钮和 `onOpenModelPicker("新分类")`。不要只加前端按钮，否则无法选择可执行模型。

### 4. 更换动物

在 `PixelPet.tsx` 中补充 `PixelPetKind` 和 SVG 分支；然后在 `ModelWorkspace.tsx` 引入新的 `kind`。纯视觉替换不影响模型请求。

## 不要轻易删除的逻辑

- `onOpenModelPicker`：它连接模式切换与模型目录。
- `messages` / `taskOutput` / `taskStatus`：它们区分空白创作态、聊天结果和异步视频/图片任务。
- 输入框内的上传、`SchemaForm`、`VideoTopControls`：不同模型的参数和素材能力由这里决定。
- 提交和轮询函数：负责将请求发给已配置的 StarAI/Sub2API 网关。

这些保持不动时，你可以自由地改奶油风、动物、组件尺寸和排版，而不会影响调用模型的功能。
