# Desktop Control (桌面操控)

Windows GUI 自动化，模拟键盘鼠标操作，支持 CAD 控制。

## 参数
- `action` (string): click / type / screenshot / find / cad_script / cad_execute / cad_parse_dxf / cad_write_dxf
- `x` (int, optional): 点击 X 坐标
- `y` (int, optional): 点击 Y 坐标
- `text` (string, optional): 输入文本
- `commands` (array, optional): CAD 命令列表（JSON 格式）
- `file_path` (string, optional): DXF 文件路径

## CAD 控制功能

### 生成 AutoCAD 脚本
```json
{
  "action": "cad_script",
  "commands": [
    { "cmd": "LINE", "args": ["0,0", "100,100"] },
    { "cmd": "CIRCLE", "args": ["50,50", "25"] }
  ],
  "output": "script.scr"
}
```

### 解析 DXF 文件
```json
{
  "action": "cad_parse_dxf",
  "file_path": "drawing.dxf"
}
```

### 写入 DXF 文件
```json
{
  "action": "cad_write_dxf",
  "entities": [
    { "type": "LINE", "start": [0, 0], "end": [100, 100] },
    { "type": "CIRCLE", "center": [50, 50], "radius": 25 }
  ],
  "output": "output.dxf"
}
```

## 执行
Windows 原生执行 (需管理员权限)
