# Qwen Image Studio

个人 AI 图片编辑工作台：React 前端 + FastAPI 后端，推理由本机 ComfyUI（Qwen Image 2.1）完成。
上传图片 → 输入编辑指令 → 实时进度 → 结果对比/下载；历史记录与图片资产保存在本地。

```
浏览器 ── HTTP / WebSocket ──▶ FastAPI (:8000) ── HTTP / WebSocket ──▶ ComfyUI (:8188)
                                │  SQLite (WAL) + storage/ 文件
                                └─ 任务队列（asyncio.Queue + 单 Worker）
```

## 目录

| 路径 | 说明 |
|---|---|
| `backend/` | FastAPI 应用、Alembic 迁移、测试；`workflows/` 为 ComfyUI API Workflow，`workflow_mapping.json` 为节点/参数映射 |
| `frontend/` | Vite + React + TypeScript + Tailwind + shadcn/ui |
| `deploy/` | systemd 单元模板、安装脚本、冒烟检查 |
| `backend/storage/` | 运行期数据：`qwen_studio.db`、`input/`、`images/`、`thumbnails/`、`logs/`（不入库） |

## 开发

```bash
# 后端（Python 3.12）
cd backend && python -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app.main:app --reload --port 8000

# 前端（另一个终端；/api 与 WebSocket 代理到 :8000）
cd frontend && npm install && npm run dev          # http://127.0.0.1:5173
```

## 测试

```bash
cd backend  && .venv/bin/python -m pytest          # API、任务恢复、备份、客户端（使用假 ComfyUI，无需 GPU）
cd frontend && npm test && npm run lint && npm run build
```

## 部署（systemd）

构建前端后，由 FastAPI 一并托管（单进程，访问 `http://127.0.0.1:8000`）。

```bash
sudo deploy/install.sh            # 系统级：开机自启，以当前登录用户运行
deploy/install.sh --user          # 用户级（无需 root）。若要在未登录时也开机自启：sudo loginctl enable-linger $USER
deploy/install.sh --uninstall     # 卸载（加 --user 卸载用户级）；数据不会被删除
deploy/smoke.sh                   # 部署后检查
```

脚本会：创建 `.venv` 并安装依赖、`npm ci && npm run build`、渲染并启用
`qwen-image-studio.service`（主服务）和 `qwen-image-studio-backup.timer`（每日 03:30 备份）。
升级：`git pull && sudo deploy/install.sh && sudo systemctl restart qwen-image-studio`（数据库迁移在启动时自动执行）。

> ComfyUI 需自行启动，服务不依赖它：ComfyUI 离线时界面显示「未连接」，上线后自动恢复。
> 默认只监听 `127.0.0.1`，**应用本身没有登录认证**；若要开放到局域网，设置 `QIS_HOST=0.0.0.0` 并自行在前面加访问控制。

### 配置

在 `backend/.env` 中覆盖（见 `backend/.env.example`），修改后 `systemctl restart qwen-image-studio`：

| 变量 | 默认 | 说明 |
|---|---|---|
| `QIS_COMFYUI_URL` | `http://127.0.0.1:8188` | ComfyUI 地址 |
| `QIS_HOST` / `QIS_PORT` | `127.0.0.1` / `8000` | 监听地址 |
| `QIS_STORAGE_DIR` | `backend/storage` | 数据库、图片、日志位置 |
| `QIS_BACKUP_DIR` / `QIS_BACKUP_KEEP` | `backend/backups` / `14` | 备份目录与保留份数 |
| `QIS_MAX_UPLOAD_BYTES` | `20971520` | 上传大小上限（前端校验值需同步修改） |
| `QIS_ORPHAN_UPLOAD_HOURS` | `24` | 未被任何任务使用的上传图片的保留时间 |
| `QIS_LOG_LEVEL` | `INFO` | 日志级别 |

### 日志

- journald：`journalctl -u qwen-image-studio -f`（用户级加 `--user`）
- 文件：`backend/storage/logs/app.log`，单文件 10 MB，保留 5 份轮转

### 备份与恢复

数据库使用 SQLite 在线备份（服务运行中也一致），连同 `input/`、`images/`、`thumbnails/` 打成一个 `.tar`，
定时器每日执行，只保留最近 `QIS_BACKUP_KEEP` 份。

```bash
cd backend
.venv/bin/python -m app.backup backup                       # 立即备份
sudo systemctl stop qwen-image-studio                        # 恢复前必须先停服务
.venv/bin/python -m app.backup restore backups/qis-backup-XXXX.tar --force
sudo systemctl start qwen-image-studio
```

`--force` 时旧数据不会被删除，而是改名为 `*.before-restore-<时间>`，确认无误后可手动清理。
建议把 `backups/` 同步到另一块磁盘或机器。

### 异常恢复

- 服务崩溃或被杀：systemd 3 秒后自动重启；`running` 的任务按原 `prompt_id` 继续等待结果（不会重复提交），`queued` 的任务重新入队。
- ComfyUI 短暂不可达：生成中的任务最多等待 90 秒；超过则标记失败，可在界面重试。
- 每 6 小时清理一次：超过保留时间且未被使用的上传图片，以及数据库中没有记录的孤立文件。
