/**
 * ChatModeToggle — 对话/改图模式切换按钮 (2026-10-12 从 App.tsx 拆出)
 * ---------------------------------------------------------------
 * 原 App.tsx:192-232。切换按钮始终显示: 用户可随时切回普通对话模式
 * (即使当前模型不支持图片)。
 */
import React from 'react';
import { Tooltip } from 'antd';
import { useModelStore } from '../store/modelStore';

export const ChatModeToggle: React.FC = () => {
  const { chatMode, setChatMode, models, activeModelId, setActive } = useModelStore();

  // 切换按钮始终显示: 用户可随时切换回普通对话模式 (即使当前模型不支持图片)
  const isImageMode = chatMode === 'image_edit';

  const handleToggle = () => {
    const newMode = isImageMode ? 'chat' : 'image_edit';
    setChatMode(newMode);

    // 切换到图片模式时，自动选择支持图片的模型
    if (newMode === 'image_edit') {
      const imageModels = models.filter(m =>
        m.capabilities?.includes('image') ||
        m.capabilities?.includes('multimodal') ||
        ['zhipu', 'doubao-chat', 'qwen-chat', 'longcat-2.0'].includes(m.id)
      );
      if (imageModels.length > 0 && !imageModels.find(m => m.id === activeModelId)) {
        setActive(imageModels[0].id);
      }
    }
  };

  return (
    <Tooltip title={isImageMode ? '切换回普通对话' : '切换到对话改图模式'}>
      <span
        onClick={handleToggle}
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 30, height: 30, borderRadius: 'var(--radius-md)', cursor: 'pointer',
          color: isImageMode ? 'var(--accent)' : 'var(--muted-2)',
          background: isImageMode ? 'var(--accent-soft)' : 'transparent',
          transition: 'all 0.15s ease', marginRight: 8,
          fontSize: 'var(--fs-lg)',
        }}
      >
        🎨
      </span>
    </Tooltip>
  );
};

export default ChatModeToggle;