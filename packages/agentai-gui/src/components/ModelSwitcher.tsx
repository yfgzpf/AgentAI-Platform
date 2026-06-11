import React from 'react';
import { Select } from 'antd';
import { useModelStore } from '../store/modelStore';

export const ModelSwitcher: React.FC<{ compact?: boolean }> = ({ compact }) => {
  const { models, activeModelId, setActive } = useModelStore();
  const active = models.find(m => m.id === activeModelId);

  const options = models.filter(m => m.enabled).map(m => ({
    value: m.id,
    label: m.label,
    color: m.color,
  }));

  return (
    <Select
      value={activeModelId}
      onChange={setActive}
      options={options}
      size={compact ? 'small' : 'middle'}
      style={{ minWidth: compact ? 100 : 140 }}
      dropdownStyle={{ minWidth: 180 }}
      optionRender={(option) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: option.data.color }} />
          <span>{option.data.label}</span>
        </div>
      )}
    />
  );
};
