/**
 * AuthAttestationPanel — 授权声明管理
 * ---------------------------------------------------------------------------
 * 为什么有这个: 富哥实机反馈「AI 老是反复核实这是不是真人 / 有没有授权」,
 * 截图给了还一直拒绝。根因查实: 工作区里**根本没有可读的授权依据文件**
 * (src-platforms.json / auth-attestations.json 都不存在, scope.json 的 source
 * 全是 unknown), AI 手里没有确定性依据, 只能每轮靠推理重新审计一遍。
 *
 * 机制: 授权从「每轮待判断的题」变成「**已落盘可读的状态**」——
 * 人在这里签署声明 (目标 + 授权依据 + 是否生效), AI 每轮读到它就按范围内开工。
 *
 * ⚠️ 设计立场(不是给 SRC 开后门, 是修通用缺陷):
 *   **授权真伪是人类的声明, 不是 AI 该审查的对象。**
 *   AI 的职责是"在声明范围内怎么做", 不是"判断声明是否成立"。
 *   真要收紧, 该由人在签署时把关(active 必须显式勾选), 而不是让模型每轮
 *   重新当一遍审计员 — 那既拖慢用户, 又拦不住真越权(真越权靠 deny硬闸门拦)。
 *
 * 声明本身不放宽边界: 未声明的目标依然默认拒绝, deny 进代码层硬闸门。
 */
import React, { useState, useCallback } from 'react';
import {
  Button, Input, Tag, Collapse, Spin, Empty, Alert, Checkbox, message as antdMsg,
} from 'antd';
import {
  SafetyCertificateOutlined, PlusOutlined, DeleteOutlined, SyncOutlined, StopOutlined, InfoCircleOutlined,
} from '@ant-design/icons';
import { GATEWAY_HTTP } from '../services/config';
import { useProfileStore } from '../store';

const AUTH_KINDS: { key: string; label: string; hint: string }[] = [
  { key: 'src', label: 'SRC众测', hint: '补天/ 漏洞盒子 / 阿里SRC 等众测平台' },
  { key: 'pentest-contract', label: '渗透合同', hint: '有正式授权合同的渗透测试项目' },
  { key: 'own-assets', label: '自有资产', hint: '自己公司的系统' },
  { key: 'ctf', label: 'CTF / 靶场', hint: '比赛或本地靶场' },
  { key: 'research', label: '研究用途', hint: '明确声明范围内的安全研究' },
];

const BLANK = {
  id: '', kind: 'src', name: '', projectUrl: '',
  evidence: '', hosts: '', deny: '', forbiddenActions: '', active: false,
};

export const AuthAttestationPanel: React.FC<{ onChanged?: () => void }> = ({ onChanged }) => {
  const { profile } = useProfileStore();
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ ...BLANK });
  const [busy, setBusy] = useState('');
  const [showForm, setShowForm] = useState(false);

  const baseUrl = () => GATEWAY_HTTP || 'http://127.0.0.1:18789';
  const wsUrl = useCallback((path: string) => {
    const ws = (profile?.workspace || localStorage.getItem('agentai.workspace') || '').trim();
    return ws ? `${baseUrl()}/${path}?workspace=${encodeURIComponent(ws)}` : `${baseUrl()}/${path}`;
  }, [profile]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(wsUrl('v1/pentest/auth-attestations'));
      const d = await r.json();
      if (d.ok) setList(d.attestations || []);
    } catch { /* 网关不可达 */ }
    finally { setLoading(false); }
  }, [wsUrl]);

  const submit = async () => {
    const hosts = form.hosts.split(/[\n,;、]+/).map(s => s.trim()).filter(Boolean);
    if (!form.name.trim()) { antdMsg.warning('给这份授权起个名字 (如: 翼支付 SRC 长期授权)'); return; }
    if (hosts.length === 0) { antdMsg.warning('至少填一个授权目标 (每行一个)'); return; }
    setBusy('submit');
    try {
      // ⚠️ 后端 POST 强制要求 id (缺失直接 400)。用户没填就按kind+名称生成一个 slug,
      //   靠 upsert 的**合并**语义保证同一份声明重复提交不会丢之前填的目标。
      const id = form.id.trim() || `${form.kind}-${form.name.trim()}${hosts[0] || ''}`
        .toLowerCase().replace(/^https?:\/\//, '')
        .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-').replace(/^-+|-+$/g, '');
      if (!id) { antdMsg.error('无法生成声明 id — 请显式填写'); setBusy(''); return; }

      const r = await fetch(wsUrl('v1/pentest/auth-attestations'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          kind: form.kind,
          name: form.name.trim(),
          projectUrl: form.projectUrl.trim() || undefined,
          evidence: form.evidence.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean),
          hosts,
          deny: form.deny.split(/[\n,;、]+/).map(s => s.trim()).filter(Boolean),
          forbiddenActions: form.forbiddenActions.split(/[\n,;、]+/).map(s => s.trim()).filter(Boolean),
          // ⚠️ 刻意不做"提交即生效" —— 必须显式勾选才置active
          active: form.active === true,
        }),
      });
      const d = await r.json();
      if (!d.ok) { antdMsg.error(d.error || '保存失败'); return; }
      antdMsg.success(form.active
        ? '已签署并生效 — AI 下轮读到后即按范围内直接开工, 不再核实授权真伪'
        : '已保存为草稿 (未生效) — 勾选「立即生效」后才对 AI 生效');
      setForm({ ...BLANK }); setShowForm(false);
      void load(); onChanged?.();
    } catch (e: any) { antdMsg.error(`保存失败: ${e?.message || e}`); }
    finally { setBusy(''); }
  };

  const revoke = async (id: string) => {
    setBusy(`rm:${id}`);
    try {
      const r = await fetch(wsUrl(`v1/pentest/auth-attestations&id=${encodeURIComponent(id)}`), { method: 'DELETE' });
      const d = await r.json();
      if (!d.ok) { antdMsg.error(d.error || '撤销失败'); return; }
      antdMsg.success('已撤销');
      void load();
    } catch (e: any) { antdMsg.error(`撤销失败: ${e?.message || e}`); }
    finally { setBusy(''); }
  };

  const sync = async (id: string) => {
    setBusy(`sync:${id}`);
    try {
      const r = await fetch(wsUrl('v1/pentest/auth-attestations/sync'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      const d = await r.json();
      if (!d.ok) { antdMsg.error(d.error || '同步失败'); return; }
      // skippedDeny 必须显示 —— 声明里写了但被平台 deny 拦下的目标, 静默跳过会让人以为配全了
      const extra = d.skippedDeny ? `; ${d.skippedDeny} 个命中平台 deny 被跳过(见平台档案)` : '';
      antdMsg.success(`已同步 ${d.added ?? 0} 个目标到授权范围${extra}`);
      onChanged?.();
    } catch (e: any) { antdMsg.error(`同步失败: ${e?.message || e}`); }
    finally { setBusy(''); }
  };

  return (
    <div style={{ marginBottom: 12 }}>
      <Button
        size="small" type="link" icon={<SafetyCertificateOutlined />}
        onClick={() => { setOpen(v => !v); if (!open) void load(); }}
        style={{ padding: 0, fontSize: 'var(--fs-micro)' }}
      >
        {open ? '收起授权声明' : '授权声明 (声明一次, AI 不再反复核实)'}
      </Button>

      {open && (
        <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Alert
            type="info" showIcon style={{ fontSize: 'var(--fs-micro)' }}
            message={(
              <>
                <InfoCircleOutlined /> 这里的授权<strong>由你本人签署并落盘</strong>, 对AI 是既定事实 ——
                AI 会直接按范围开工, 不再追问「是不是真人 / 有没有授权」。
                未声明的目标依然默认拒绝, deny 项进代码硬闸门。
              </>
            )}
          />

          <div>
            <Button size="small" icon={<PlusOutlined />} onClick={() => { setShowForm(v => !v); setForm({ ...BLANK }); }}>
              {showForm ? '收起' : '签署新声明'}
            </Button>
          </div>

          {showForm && (
            <div style={{
              border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: 8,
              display: 'flex', flexDirection: 'column', gap: 6,
            }}>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {AUTH_KINDS.map(k => (
                  <Tag
                    key={k.key} onClick={() => setForm(f => ({ ...f, kind: k.key }))}
                    title={k.hint}
                    style={{
                      cursor: 'pointer', fontSize: 'var(--fs-micro)', margin: 0,
                      borderRadius: 'var(--radius-sm)', border: 'none',
                      background: form.kind === k.key ? 'var(--accent)' : 'var(--panel)',
                      color: form.kind === k.key ? 'var(--fg-on-accent)' : 'var(--muted-2)',
                    }}
                  >
                    {k.label}
                  </Tag>
                ))}
              </div>

              <Field label="声明名称" required>
                <Input size="small" value={form.name} placeholder="如: 翼支付 SRC 长期授权"
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  style={{ fontSize: 'var(--fs-micro)' }} />
              </Field>

              <Field label="项目地址/ 平台主页">
                <Input size="small" value={form.projectUrl} placeholder="https://valasrc.vulbox.com/home"
                  onChange={e => setForm(f => ({ ...f, projectUrl: e.target.value }))}
                  style={{ fontSize: 'var(--fs-micro)' }} />
              </Field>

              <Field label="授权目标" required hint="每行一个, 支持 *.example.com 通配">
                <Input.TextArea rows={4} value={form.hosts} placeholder={'*.bestpay.com.cn\napi.bestpay.com.cn'}
                  onChange={e => setForm(f => ({ ...f, hosts: e.target.value }))}
                  style={{ fontSize: 'var(--fs-micro)' }} />
              </Field>

              <Field label="明确禁止 (deny)" hint="这些进代码层硬闸门, 优先于任何 allow; 建议把 out of scope 抄全">
                <Input.TextArea rows={2} value={form.deny} placeholder={'oms.bestpay.cn\nwww.tycredit.com'}
                  onChange={e => setForm(f => ({ ...f, deny: e.target.value }))}
                  style={{ fontSize: 'var(--fs-micro)' }} />
              </Field>

              <Field label="禁止的行为" hint="如: 社交工程 / DoS / 暴力破解">
                <Input.TextArea rows={2} value={form.forbiddenActions} placeholder="社交工程, 拒绝服务, 暴力破解"
                  onChange={e => setForm(f => ({ ...f, forbiddenActions: e.target.value }))}
                  style={{ fontSize: 'var(--fs-micro)' }} />
              </Field>

              <Field label="授权依据" hint="截图路径 / 合同号 / 项目 URL, 每行一条。仅供你自己审计备查">
                <Input.TextArea rows={2} value={form.evidence} placeholder=".agentai/evidence/src-授权.png\n合同号 CTF-2026-001"
                  onChange={e => setForm(f => ({ ...f, evidence: e.target.value }))}
                  style={{ fontSize: 'var(--fs-micro)' }} />
              </Field>

              <Checkbox
                checked={form.active}
                onChange={e => setForm(f => ({ ...f, active: e.target.checked }))}
                style={{ fontSize: 'var(--fs-micro)' }}
              >
                立即生效 (勾选后 AI 才会按此声明开工; 不勾 = 存草稿)
              </Checkbox>

              <div>
                <Button size="small" type="primary" loading={busy === 'submit'} onClick={() => void submit()}>
                  保存声明
                </Button>
              </div>
            </div>
          )}

          <Collapse
            size="small" ghost style={{ background: 'transparent' }}
            items={[{
              key: 'list',
              label: <span style={{ fontSize: 'var(--fs-micro)' }}>已签署声明 ({list.length})</span>,
              children: loading
                ? <Spin size="small" />
                : list.length === 0
                  ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE}
                      description={<span style={{ fontSize: 'var(--fs-micro)' }}>
                        还没有声明 — 这是 AI 反复核实授权的直接原因
                      </span>} />
                  : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {list.map(a => (
                        <div key={a.id} style={{
                          border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: 6,
                          display: 'flex', flexDirection: 'column', gap: 4,
                        }}>
                          <div style={{ fontSize: 'var(--fs-micro)', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                            <strong>{a.name}</strong>
                            <Tag style={{ margin: 0, fontSize: 'var(--fs-micro)' }}>
                              {AUTH_KINDS.find(k => k.key === a.kind)?.label || a.kind}
                            </Tag>
                            {a.active
                              ? <Tag color="green" style={{ margin: 0, fontSize: 'var(--fs-micro)' }}>生效中</Tag>
                              : <Tag color="default" style={{ margin: 0, fontSize: 'var(--fs-micro)' }}>草稿 (AI 不认)</Tag>}
                            <span style={{ color: 'var(--muted-2)' }}>
                              {a.hosts?.length || 0} 目标 / {a.deny?.length || 0} 禁止
                            </span>
                          </div>
                          {a.projectUrl && (
                            <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted-2)', wordBreak: 'break-all' }}>
                              {a.projectUrl}
                            </div>
                          )}
                          {a.hosts?.length > 0 && (
                            <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--fg)', wordBreak: 'break-all' }}>
                              {a.hosts.join(', ')}
                            </div>
                          )}
                          {a.deny?.length > 0 && (
                            <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--danger)', wordBreak: 'break-all' }}>
                              <StopOutlined /> {a.deny.join(', ')}
                            </div>
                          )}
                          {a.forbiddenActions?.length > 0 && (
                            <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--warn, #d48806)', wordBreak: 'break-all' }}>
                              ⛔ {a.forbiddenActions.join('、')}
                            </div>
                          )}
                          <div style={{ display: 'flex', gap: 4 }}>
                            <Button size="small" icon={<SyncOutlined />} loading={busy === `sync:${a.id}`}
                              onClick={() => void sync(a.id)}>
                              同步到授权范围
                            </Button>
                            <Button size="small" icon={<DeleteOutlined />} danger loading={busy === `rm:${a.id}`}
                              onClick={() => void revoke(a.id)}>
                              撤销
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ),
            }]}
          />
        </div>
      )}
    </div>
  );
};

const Field: React.FC<{ label: string; hint?: string; required?: boolean; children: React.ReactNode }> = ({
  label, hint, required, children,
}) => (
  <div style={{ fontSize: 'var(--fs-micro)' }}>
    <div style={{ color: 'var(--muted-2)' }}>
      {label}{required && <span style={{ color: 'var(--danger)' }}> *</span>}
      {hint && <span style={{ marginLeft: 6, opacity: 0.75 }}>{hint}</span>}
    </div>
    <div style={{ marginTop: 2 }}>{children}</div>
  </div>
);