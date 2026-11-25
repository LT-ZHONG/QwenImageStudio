# Qwen Image Studio — AI 图片生成与编辑平台

## 角色设定

你是一名资深全栈工程师、AI 图像生成系统工程师和优秀的 UI/UX 产品设计师。

请开发一个完整的 AI 图片生成与编辑 Web 应用。

项目名称为 Qwen Image Studio。

这不是一个简单的 ComfyUI API 测试界面，而是一个具有完整创作工作流、图片资产管理能力和良好交互体验的个人 AI 图片创作工具。

请以实际提供的 ComfyUI Workflow 为开发依据，不要凭空假设模型能力、节点结构和参数。

---

# 一、项目背景与现有环境

我已经完成了 ComfyUI 的本地部署，并且可以正常使用 Qwen Image 2.1 生成和编辑图片。

现有环境：

- 操作系统：Ubuntu Linux
- ComfyUI：本机运行
- ComfyUI 地址：http://127.0.0.1:8188
- 图片生成模型：Qwen Image 2.1
- Workflow：已经提供 API 格式 JSON
- 使用方式：个人单用户
- GPU 推理：由 ComfyUI 负责

当前 Workflow 文件：

`QwenImageStudio/backend/workflows/qwen_i2i_api.json`

必须直接读取并分析这个文件，理解节点之间的连接关系，再开发后端适配逻辑。

## 二、项目整体架构

采用轻量级前后端分离架构：

React + TypeScript
        |
        | HTTP REST API / WebSocket
        |
Python + FastAPI
        |
        ├── Workflow 管理
        ├── 任务队列
        ├── ComfyUI 客户端
        ├── 图片上传
        ├── 图片存储
        └── 历史记录
                |
                | HTTP / WebSocket
                |
             ComfyUI
                |
           Qwen Image 2.1
                |
             图片输出

技术选型：

### 前端

- React
- TypeScript
- Vite
- Tailwind CSS
- shadcn/ui
- Lucide Icons
- Zustand
- TanStack Query

### 后端

- Python 3.12.12
- FastAPI
- Pydantic
- SQLAlchemy 2.0
- SQLite
- Alembic
- httpx
- websockets
- Pillow

其中 Python 可通过 `pyenv shell 3.12.12` 命令使用。
 
### 基础设施

- ComfyUI：模型推理
- SQLite：业务数据
- 本地文件系统：图片存储
- asyncio.Queue：任务排队
- WebSocket：实时状态推送

初期不引入 Redis、Celery、Docker、Kubernetes 等复杂组件。

这是一个单用户、单 ComfyUI 实例的个人应用。

---

# 三、现有 Workflow 分析与适配

这是整个项目最重要的部分。

必须以 `QwenImageStudio/backend/workflows/qwen_i2i_api.json` 为唯一的初始 Workflow 依据。

## 1. 节点映射

当前 Workflow 包含以下节点：

| 节点 ID | 节点类型 | 用途 |
|---|---|---|
| 13 | ResolutionSelector | 图片比例和分辨率 |
| 461 | SaveImageAdvanced | 保存输出图片 |
| 470 | LoadImage | 加载输入图片 |
| 472 | ImageCompare | 图片对比 |
| 478 | UNETLoader | 加载扩散模型 |
| 479 | CLIPLoader | 加载 CLIP |
| 480 | VAELoader | 加载 VAE |
| 481 | EmptyLatentImage | 空 Latent |
| 482 | VAEDecode | VAE 解码 |
| 483 | KSampler | 采样 |
| 484 | ComfySwitchNode | Latent 切换 |
| 485 | QwenImage21Cache | 模型缓存 |
| 486 | TextEncodeQwenImage21 | 提示词及图片编码 |

## 2. 必须保留的模型配置

UNETLoader:

`qwen_image_2.1_int8_convrot.safetensors`

CLIPLoader:

`qwen3vl_8b_int8_convrot.safetensors`

VAELoader:

`qwen_image_2.1_vae_bf16.safetensors`

这些配置由 ComfyUI Workflow 管理，不要让普通前端用户修改模型文件名称。

## 3. 参数映射

建立独立的 Workflow 参数映射配置。

初始映射如下：

**节点 470：LoadImage**

- image

**节点 486：TextEncodeQwenImage21**

- prompt
- negative_prompt
- resolution
- images.image_1

以上参数必须以实际 Workflow 节点输入为准。

前端只展示经过后端确认支持的参数。

---

# 四、前端产品设计

整体定位：现代化、简洁、专业的 AI 图片创作工作台，不要设计成传统后台管理系统。

## 1. 整体布局

采用左侧导航 + 主工作区布局。

导航：

- 图片创作
- 创作历史
- 设置

底部显示 ComfyUI 服务连接状态，导航栏支持折叠，移动端使用抽屉式导航。

## 2. 图片创作页面

这是产品的核心页面。建议采用左右分栏布局：

左侧：创作控制面板。
右侧：图片展示区域。

### 2.1 输入图片

由于当前 Workflow 包含 LoadImage 节点，必须优先设计图片上传功能。

支持：

- 点击上传图片
- 拖拽上传
- 粘贴剪贴板图片
- 图片预览
- 替换图片
- 删除输入图片

支持 PNG、JPG、JPEG、WEBP

显示：

- 图片缩略图
- 图片尺寸
- 文件大小

限制文件大小和图片尺寸，并在上传前进行校验，没有输入图片时，第一版的图像编辑生成按钮应当禁用。

### 2.2 提示词编辑器

提供一个较大的多行输入框。

支持：

- 中英文提示词。
- 清空提示词。
- 历史提示词复用。
- 提示词示例。
- 字符数量显示。

默认示例：

"移除画面中的人物，保持背景环境、光照和构图自然一致。"

负面提示词可以放在可折叠区域。

### 2.3 Seed 配置

提供：

- 随机 Seed
- 手动输入 Seed
- 复用历史任务 Seed

当前 Workflow 使用固定 Seed，默认界面可以设置为随机 Seed，并由后端在提交时生成实际数值。

### 2.4 高级参数

折叠显示：

- Steps：默认 25
- CFG：默认 1
- Denoise：默认 1
- Resolution：默认 1024

不要默认开放未经验证的参数范围。

### 2.5 生成按钮

主按钮：

「生成图片」

点击后：

1. 检查输入图片
2. 检查提示词
3. 校验参数
4. 提交生成请求
5. 获取业务 task_id
6. 建立 WebSocket 连接
7. 展示真实生成进度
8. 生成成功后展示图片

支持取消生成和重新生成，不要伪造进度。

## 3. 生成结果区域

展示生成图片。

支持：

- 图片网格
- 原图预览
- 全屏预览
- 下载原图
- 查看提示词
- 查看生成参数
- 复用参数重新生成

建议提供原图和生成结果的对比功能，可以使用滑动对比组件。

注意：

当前 Workflow 有 ImageCompare 节点，但其 compare_view 输入包含临时图片 URL 链接，不要假设这些临时图片 URL 能够直接作为业务图片地址使用，应优先使用后端保存的原图和生成图片实现稳定的前端对比功能。

## 4. 创作历史

展示：

- 输入图片缩略图
- 生成结果缩略图
- 提示词
- Seed
- 图片尺寸
- 创建时间
- 任务状态

支持搜索、筛选、详情、复用和删除。

## 5. 设置页面

提供：

- 后端连接测试
- 默认主题

ComfyUI 地址由后端管理，不允许普通用户直接修改。

---

# 五、FastAPI 后端开发

## 1. ComfyUIClient

封装独立的 ComfyUI 客户端。

负责：

- HTTP 连接
- WebSocket 连接
- 图片上传
- Workflow 提交
- 任务状态监听
- 查询 History
- 获取生成图片
- 中断任务
- 服务健康检查

使用 ComfyUI 标准 API：

```
POST /upload/image

上传用户输入图片，获取 ComfyUI 返回的文件名
```

```
POST /prompt

提交 API 格式 Workflow
```

```
GET /history/{prompt_id}

查询任务执行结果
```

```
GET /view

获取生成图片
```

```
POST /interrupt

中断当前执行任务
```

```
WebSocket：

/ws?clientId={client_id}

监听任务状态
```

注意：

- 不允许在 API 路由中直接操作 ComfyUI
- 所有调用集中在 ComfyUIClient
- HTTP 请求应当具有合理超时
- WebSocket 断开后支持重新连接
- 不能依赖 WebSocket 作为唯一的任务状态来源

## 2. WorkflowManager

负责：

- 加载 Workflow JSON
- 深拷贝 Workflow 模板
- 根据业务参数修改节点输入
- 验证节点和参数
- 注入上传图片文件名
- 注入提示词
- 注入图片比例和生成参数
- 设置生成图片文件名前缀

严禁直接修改原始 Workflow 模板，每个任务必须使用独立的 Workflow 副本，节点 ID 集中定义在配置文件中。

## 3. 图片上传

新增业务 API：

```
POST /api/v1/uploads
```

使用 multipart/form-data

后端负责：

1. 校验图片类型
2. 校验文件大小
3. 校验图片格式
4. 生成唯一文件名
5. 保存输入图片
6. 上传图片到 ComfyUI
7. 保存 ComfyUI 返回的文件名
8. 返回业务 upload_id

业务上传记录和 ComfyUI 输入文件名必须分开保存，不要直接信任用户提交的文件名，生成任务使用 upload_id 关联输入图片。

## 4. 任务管理

建立独立的 TaskManager 和 TaskWorker

初期使用：

asyncio.Queue + 单 Worker + SQLite

状态：

- queued
- submitting
- running
- cancelling
- succeeded
- failed
- cancelled

任务记录：

- task_id
- prompt_id
- upload_id
- prompt
- negative_prompt
- model
- generation_params
- status
- progress
- error_message
- created_at
- started_at
- completed_at

确保同一个 ComfyUI 实例同一时间只由一个 Worker 提交和管理生成任务，处理任务取消时必须确认当前执行的 prompt_id 避免误中断其他任务。

## 5. 任务状态同步

数据流：

```
ComfyUI WebSocket
    |
ComfyUIClient
    |
TaskManager
    |
SQLite
    |
FastAPI WebSocket
    |
React
```

支持：

- queued
- submitting
- running
- succeeded
- failed
- cancelled

进度来自 ComfyUI 实际事件，收到执行完成事件后，必须查询 ComfyUI History 确认最终结果，即使浏览器关闭，后台任务也必须继续执行，页面重新打开时，通过 REST API 恢复任务状态。

## 6. 图片管理

任务成功后：

1. 获取 ComfyUI 输出图片
2. 将原始图片复制到业务存储目录
3. 使用 Pillow 读取图片尺寸
4. 生成缩略图
5. 保存图片元数据
6. 更新任务状态
7. 通知前端

存储结构：

```
storage/
├── input/
├── images/
│   └── YYYY/MM/
└── thumbnails/
    └── YYYY/MM/
```

不要依赖 ComfyUI 原始输出目录作为长期图片存储，不要将图片转成 Base64 返回给前端，通过 FastAPI 图片接口提供图片资源。

---

# 六、API 接口设计

统一使用 /api/v1 前缀。

### 系统

GET /api/v1/health

GET /api/v1/comfyui/status

### 模型

GET /api/v1/models

### 图片上传

POST /api/v1/uploads

GET /api/v1/uploads/{upload_id}

DELETE /api/v1/uploads/{upload_id}

### 图片生成

POST /api/v1/generations

GET /api/v1/generations

GET /api/v1/generations/{task_id}

POST /api/v1/generations/{task_id}/cancel

POST /api/v1/generations/{task_id}/retry

### 图片资源

GET /api/v1/assets

GET /api/v1/assets/{asset_id}/file

GET /api/v1/assets/{asset_id}/thumbnail

DELETE /api/v1/assets/{asset_id}

### 实时通信

WS /api/v1/ws/generations/{task_id}

所有业务 API 必须有完整的 Pydantic 请求和响应类型。

---

# 七、数据库设计

使用 SQLAlchemy 2.0 + SQLite

建立：

GenerationTask 保存生成任务。

UploadAsset 保存上传的原始图片及 ComfyUI 文件名。

ImageAsset 保存生成结果及缩略图信息。

AppSetting 保存个人应用设置。

所有图片路径使用相对业务存储目录的安全路径或统一的存储键，不允许客户端传入任意文件路径。

使用 Alembic 管理数据库迁移，启用 SQLite WAL 模式。

---

# 八、开发阶段与验收标准

必须分阶段开发，不要一次性生成全部代码。

## Phase 1：Workflow 接入与后端 MVP

完成：

- 检查现有 ComfyUI
- 读取 API Workflow
- 实现图片上传
- 实现 Workflow 动态参数替换
- 实现生成任务提交
- 实现任务队列
- 实现状态监听
- 实现生成图片保存
- 实现基础 API

验收：

可以通过 curl 上传图片、提交提示词，并成功生成一张真实图片。

## Phase 2：前端创作工作台

完成：

- 页面布局
- 图片上传
- 提示词编辑
- 图片参数配置
- 生成任务管理
- 实时进度
- 结果展示
- 图片预览
- 图片下载

验收：

用户可以通过浏览器完整完成一次图像编辑任务。

## Phase 3：图片管理

完成：

- 创作历史
- 图片搜索
- 图片详情
- 图片删除
- 参数复用
- 默认设置

验收：

关闭并重新打开浏览器，所有历史图片仍然存在。

## Phase 4：部署与优化

完成：

- 前端生产构建
- FastAPI 部署
- Systemd 管理
- 日志管理
- 异常恢复
- 数据备份
- 自动化测试

验收：

Ubuntu 重启后服务可以自动启动，任务记录和图片资产完整保留。

---

最终目标：

打造一套真正可用的个人 AI 图片生成与编辑工作台，以现有 ComfyUI + Qwen Image 2.1 为推理核心，具有简洁专业的用户界面、稳定的任务管理和完整的图片资产管理能力。
