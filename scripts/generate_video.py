"""
生成一个带有动画效果的视频
使用 cat.png 图片，添加文字和动画
"""

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont
import os

# 配置
IMAGE_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'cat.png')
OUTPUT_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'output_video.mp4')
FPS = 30
DURATION = 5  # 秒
WIDTH, HEIGHT = 800, 600

def create_frame_with_text(img_pil, text, position, font_size=40):
    """在PIL图像上添加文字"""
    draw = ImageDraw.Draw(img_pil)
    try:
        font = ImageFont.truetype("arial.ttf", font_size)
    except:
        font = ImageFont.load_default()
    draw.text(position, text, fill=(255, 255, 255), font=font)
    return img_pil

def generate_video():
    # 加载原始图片
    cat_img = Image.open(IMAGE_PATH).convert("RGBA")
    
    # 创建视频写入器
    fourcc = cv2.VideoWriter_fourcc(*'mp4v')
    out = cv2.VideoWriter(OUTPUT_PATH, fourcc, FPS, (WIDTH, HEIGHT))
    
    total_frames = FPS * DURATION
    
    for frame_idx in range(total_frames):
        # 创建背景（渐变背景）
        t = frame_idx / FPS
        bg = Image.new('RGB', (WIDTH, HEIGHT), (20, 20, 40))
        
        # 计算猫图片的位置（左右摆动动画）
        cat_size = 200
        cat_resized = cat_img.resize((cat_size, cat_size), Image.LANCZOS)
        
        # 正弦摆动
        offset_x = int(100 * np.sin(2 * np.pi * 0.5 * t))
        offset_y = int(30 * np.sin(2 * np.pi * 1.0 * t))
        
        x_pos = (WIDTH - cat_size) // 2 + offset_x
        y_pos = (HEIGHT - cat_size) // 2 + offset_y - 50
        
        # 粘贴猫图片
        bg.paste(cat_resized, (x_pos, y_pos), cat_resized)
        
        # 添加文字
        draw = ImageDraw.Draw(bg)
        try:
            font_title = ImageFont.truetype("arial.ttf", 48)
            font_sub = ImageFont.truetype("arial.ttf", 30)
        except:
            font_title = ImageFont.load_default()
            font_sub = ImageFont.load_default()
        
        # 标题 - 打字机效果
        title = "Hello, AgentAI!"
        chars_to_show = min(len(title), int(len(title) * t / 2))
        if chars_to_show > 0:
            draw.text(
                ((WIDTH - 300) // 2, 50),
                title[:chars_to_show],
                fill=(255, 215, 0),
                font=font_title
            )
        
        # 副标题 - 淡入效果
        alpha = min(1.0, (t - 1.0) / 1.0)
        if alpha > 0:
            gray_val = int(200 * alpha)
            draw.text(
                ((WIDTH - 250) // 2, 120),
                "AI Platform Demo",
                fill=(gray_val, gray_val, gray_val),
                font=font_sub
            )
        
        # 底部时间戳
        time_text = f"Time: {t:.1f}s"
        draw.text(
            (WIDTH - 150, HEIGHT - 40),
            time_text,
            fill=(100, 100, 100),
            font=font_sub
        )
        
        # 装饰性粒子效果
        for i in range(20):
            px = int((WIDTH * (0.1 + 0.8 * (i / 20)) + 30 * np.sin(2 * np.pi * (0.3 * t + i / 20))) % WIDTH)
            py = int((HEIGHT * 0.1 + 50 * np.sin(2 * np.pi * (0.5 * t + i / 10))) % HEIGHT)
            draw.ellipse(
                [px-2, py-2, px+2, py+2],
                fill=(100, 150, 255, 150)
            )
        
        # 转换为 OpenCV 格式并写入
        frame = cv2.cvtColor(np.array(bg), cv2.COLOR_RGB2BGR)
        out.write(frame)
    
    out.release()
    print(f"[OK] 视频已生成: {OUTPUT_PATH}")
    print(f"   时长: {DURATION}s, FPS: {FPS}, 分辨率: {WIDTH}x{HEIGHT}")

if __name__ == '__main__':
    generate_video()
