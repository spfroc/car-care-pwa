import { useCallback, useEffect, useState } from 'react';
import {
  applyWaitingUpdate,
  dismissUpdatePrompt,
  startPwaRegister,
  subscribeNeedRefresh,
} from '../lib/pwaRegister';

export function usePwaUpdate() {
  const [needRefresh, setNeedRefresh] = useState(false);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    startPwaRegister();
    return subscribeNeedRefresh(setNeedRefresh);
  }, []);

  const updateNow = useCallback(async () => {
    setUpdating(true);
    try {
      await applyWaitingUpdate();
    } finally {
      setUpdating(false);
    }
  }, []);

  const dismiss = useCallback(() => {
    dismissUpdatePrompt();
  }, []);

  return { needRefresh, updating, updateNow, dismiss };
}
