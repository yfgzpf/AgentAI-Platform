# 智 Y 可用工具列表

## 系统工具

### 文件操作
- `read_file`: 读取文件内容
  - 参数：file_path (必需)
  - 返回：文件内容

- `write_file`: 写入文件
  - 参数：file_path (必需), content (必需)
  - 返回：操作结果

- `edit_file`: 编辑文件
  - 参数：file_path (必需), old_text (必需), new_text (必需)
  - 返回：操作结果

- `list_directory`: 列出目录内容
  - 参数：dir_path (必需)
  - 返回：文件列表

- `delete_file`: 删除文件
  - 参数：file_path (必需)
  - 返回：操作结果

### 命令执行
- `run_command`: 执行Shell命令
  - 参数：command (必需), timeout (可选, 默认30秒)
  - 返回：命令输出

### 网络请求
- `http_get`: GET请求
  - 参数：url (必需), headers (可选)
  - 返回：响应内容

- `http_post`: POST请求
  - 参数：url (必需), body (必需), headers (可选)
  - 返回：响应内容

## 智能体调用

### 调用语法
```
@agent-name --param1 value1 --param2 value2
```

### 可用智能体
- `@guidance`: 需求引导智能体
- `@script-writer`: 剧本创作智能体
- `@character-designer`: 角色设计智能体
- `@storyboard-generator`: 分镜生成智能体
- `@video-composer`: 视频合成智能体
- `@doc-assistant`: 文档助手智能体
- `@image-gen`: 图像生成智能体
- `@web-assistant`: 网页自动化智能体
- `@memory-keeper`: 记忆管理智能体
- `@skill-creator`: 技能生成智能体

## 技能调用

### 调用语法
```
use skill:skill-name --param1 value1
```

### 办公技能
- `skill:doc-generator`: Word文档生成
- `skill:excel-generator`: Excel表格生成
- `skill:ppt-generator`: PPT演示文稿生成

### 图像技能
- `skill:image-gen`: 图像生成（支持多种模型）
- `skill:image-edit`: 图像编辑

### 视频技能
- `skill:seedance-video`: 豆包视频生成
- `skill:video-composer`: 视频合成

### 网页技能
- `skill:browser-auto`: 浏览器自动化
- `skill:web-scraper`: 网页数据抓取

### 通信技能
- `skill:wechat-bot`: 微信机器人
- `skill:email-sender`: 邮件发送
- `skill:telegram-bot`: Telegram机器人

## 记忆工具

- `save_to_memory`: 保存信息到记忆
  - 参数：content (必需), category (可选: core/daily/task)
  - 返回：操作结果

- `search_memory`: 搜索记忆
  - 参数：query (必需), date_range (可选)
  - 返回：匹配的记忆条目

- `get_context`: 获取上下文
  - 参数：session_id (可选)
  - 返回：当前会话上下文

## 行业工具

- `load_industry_config`: 加载行业配置
  - 参数：industry (必需)
  - 返回：行业配置信息

- `get_industry_fields`: 获取行业字段
  - 参数：industry (必需), task_type (必需)
  - 返回：字段定义列表

## 钩子工具

- `trigger_hook`: 触发钩子
  - 参数：hook_name (必需), context (可选)
  - 返回：钩子执行结果

- `register_hook`: 注册自定义钩子
  - 参数：hook_name (必需), script_path (必需)
  - 返回：注册结果
