/**
 * useSuggestionSSE.ts
 * 全局建议 SSE 连接 Hook
 *
 * 在 App 顶层调用一次，自动连接 /v1/suggestions/stream，
 * 收到新建议时写入 suggestionStore，触发浮动弹窗。
 */

import { useEffect, useRef } from 'react';
import { useSuggestionStore, SuggestionItem } from '../store/suggestionStore';

interface SSEData {
  type: 'connected' | 'suggestion_update' | 'reload_suggestions' | 'new_suggestion';
  message?: string;
  action?: string;
  suggestion?: SuggestionItem;
  suggestions?: SuggestionItem[];
}

export function useSuggestionSSE() {
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setSseConnected = useSuggestionStore(s => s.setSseConnected);
  const addSuggestion = useSuggestionStore(s => s.addSuggestion);
  const removeSuggestion = useSuggestionStore(s => s.removeSuggestion);
  const setSuggestions = useSuggestionStore(s => s.setSuggestions);

  useEffect(() => {
    let mounted = true;

    const connect = () => {
      if (!mounted) return;

      // 从 localStorage 读取用户身份
      let userId = 'user1';
      let workspace = 'general';
      try {
        const raw = localStorage.getItem('agentai-user-profile');
        if (raw) {
          const parsed = JSON.parse(raw);
          const profile = parsed?.state?.profile || parsed?.profile;
          if (profile?.name) userId = profile.name;
          if (profile?.workspace) workspace = profile.workspace;
        }
      } catch { /* ignore */ }

      try {
        const es = new EventSource(
          `/v1/suggestions/stream?userId=${encodeURIComponent(userId)}&workspace=${encodeURIComponent(workspace)}`
        );
        eventSourceRef.current = es;

        es.onopen = () => {
          setSseConnected(true);
        };

        es.onmessage = (event) => {
          try {
            const data: SSEData = JSON.parse(event.data);

            switch (data.type) {
              case 'connected':
                // 连接成功
                break;

              case 'new_suggestion':
              case 'suggestion_update':
                if (data.action === 'new' && data.suggestion) {
                  addSuggestion(data.suggestion);
                } else if (data.action === 'accepted' || data.action === 'dismissed') {
                  if (data.suggestion) {
                    removeSuggestion(data.suggestion.id);
                  }
                }
                break;

              case 'reload_suggestions':
                // 后端要求重新加载 — 拉取最新列表
                fetchLatestSuggestions(userId, workspace);
                break;
            }
          } catch {
            // JSON 解析失败，忽略
          }
        };

        es.onerror = () => {
          setSseConnected(false);
          es.close();
          eventSourceRef.current = null;
          // 5 秒后重连
          if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
          reconnectTimerRef.current = setTimeout(connect, 5000);
        };
      } catch {
        setSseConnected(false);
        if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = setTimeout(connect, 5000);
      }
    };

    const fetchLatestSuggestions = async (userId: string, workspace: string) => {
      try {
        const res = await fetch(
          `/v1/suggestions?userId=${encodeURIComponent(userId)}&workspace=${encodeURIComponent(workspace)}`
        );
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.suggestions)) {
            setSuggestions(data.suggestions);
          }
        }
      } catch {
        // 网络错误，忽略
      }
    };

    // 初始加载一次
    let userId = 'user1';
    let workspace = 'general';
    try {
      const raw = localStorage.getItem('agentai-user-profile');
      if (raw) {
        const parsed = JSON.parse(raw);
        const profile = parsed?.state?.profile || parsed?.profile;
        if (profile?.name) userId = profile.name;
        if (profile?.workspace) workspace = profile.workspace;
      }
    } catch { /* ignore */ }
    fetchLatestSuggestions(userId, workspace);

    // 连接 SSE
    connect();

    return () => {
      mounted = false;
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
    };
  }, []); // 只在挂载时连接一次
}
