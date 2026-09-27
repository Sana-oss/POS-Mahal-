/**
 * Subscribes to the data-source sync status (bootstrap state + in-flight
 * writes). The header renders the "saving / offline" hint from it and App
 * renders the full-screen bootstrap / error states.
 */
import { useEffect, useState } from 'react';
import { getSyncStatus, subscribeSyncStatus, SyncStatus } from '../lib/dataSource';

export function useSyncStatus(): SyncStatus {
  const [status, setStatus] = useState<SyncStatus>(getSyncStatus());

  useEffect(
    () =>
      subscribeSyncStatus(() => {
        setStatus({ ...getSyncStatus() });
      }),
    []
  );

  return status;
}
