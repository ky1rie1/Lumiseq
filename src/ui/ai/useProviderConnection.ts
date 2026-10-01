import { useEffect, useState } from 'react';
import { defaultProviderRegistry, type ProviderReadiness } from '../../ai/providers/ProviderRegistry';

const CHECKING: ProviderReadiness = { status: 'checking', canSend: false, label: '检查 AI 配置', detail: '正在检查连接配置。' };

export function useProviderConnection(enabled: boolean) {
  const [connection, setConnection] = useState<ProviderReadiness>(CHECKING);
  const [refreshTick, setRefreshTick] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let current = true;
    let generation = 0;
    const refresh = async () => {
      const request = ++generation;
      setConnection(CHECKING);
      const result = await defaultProviderRegistry.getReadiness();
      if (current && generation === request) setConnection(result);
    };
    void refresh();
    const unsubscribe = defaultProviderRegistry.subscribe(() => { void refresh(); });
    const onFocus = () => { void refresh(); };
    window.addEventListener('focus', onFocus);
    return () => { current = false; unsubscribe(); window.removeEventListener('focus', onFocus); };
  }, [enabled, refreshTick]);
  return { connection, refreshConnection: () => setRefreshTick(value => value + 1) };
}
