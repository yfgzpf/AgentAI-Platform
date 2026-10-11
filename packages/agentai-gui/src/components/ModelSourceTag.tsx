/**
 * ModelSourceTag — 模型来源徽章
 * 官方直连显示灰色「官方」, 中转站显示对应站点的彩色徽章 (ALRO / SuperAPI / ...)。
 * 用户自建模型不显示。
 */
import React from 'react';
import { Tag, Tooltip } from 'antd';
import type { ModelConfig } from '../store/modelStore';
import { getSourceBadge } from '../utils/modelPicker';

interface Props {
  model: ModelConfig;
  /** 极简模式 (下拉菜单内) 用更小的字号 */
  dense?: boolean;
}

export const ModelSourceTag: React.FC<Props> = ({ model, dense }) => {
  const badge = getSourceBadge(model);
  if (!badge) return null;
  return (
    <Tooltip title={badge.tip}>
      <Tag
        color={badge.color}
        style={{
          fontSize: dense ? 8 : 9,
          lineHeight: dense ? '12px' : '14px',
          padding: '0 3px',
          margin: 0,
          flexShrink: 0,
        }}
      >
        {badge.text}
      </Tag>
    </Tooltip>
  );
};
