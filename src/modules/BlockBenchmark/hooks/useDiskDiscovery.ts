import { message } from 'antd';
import { useCallback } from 'react';
import { useSSHStore } from '../../SSHManager/store/sshStore';
import { useBenchmarkStore, type DiscoveredDisk, type NodeDisks } from '../store/benchmarkStore';

export { type DiscoveredDisk, type NodeDisks };

export function useDiskDiscovery() {
  const { sessions, execCommandOnSession } = useSSHStore();
  // FIX-1: use shared store instead of local useState
  const { discoveredNodes, setDiscoveredNodes, isScanning, setIsScanning } = useBenchmarkStore();

  const scanAllNodes = useCallback(async () => {
    const activeSessions = sessions.filter(s => s.status === 'connected');
    if (activeSessions.length === 0) {
      message.warning('当前没有任何活跃的 SSH 会话，无法执行拓扑扫描。');
      return;
    }

    setIsScanning(true);
    const newResults: Record<string, NodeDisks> = {};

    try {
      const promises = activeSessions.map(async (sess) => {
        try {
          const { stdout } = await execCommandOnSession(
            sess.id,
            'lsblk -J -b -o NAME,TYPE,MOUNTPOINT,SIZE,PKNAME,MODEL',
            10000
          );

          if (!stdout) return;
          
          // stdout may have leading garbage from shell prompt — find the JSON start
          const jsonStart = stdout.indexOf('{');
          if (jsonStart === -1) return;
          
          const data = JSON.parse(stdout.slice(jsonStart));
          if (!data.blockdevices) return;

          const disks: DiscoveredDisk[] = [];

          const traverse = (devices: any[]) => {
            for (const d of devices) {
              if (d.type === 'disk') {
                let hasSystemMount = false;
                const checkSystem = (children: any[]) => {
                  for (const c of children) {
                    const mp = c.mountpoint || '';
                    if (mp === '/' || mp.startsWith('/boot')) hasSystemMount = true;
                    if (c.children) checkSystem(c.children);
                  }
                };
                if (d.children) checkSystem(d.children);

                if (!hasSystemMount) {
                  disks.push({
                    name: `/dev/${d.name}`,
                    type: d.type,
                    size: parseInt(d.size || '0', 10),
                    mountpoint: d.mountpoint || null,
                    pkname: d.pkname || null,
                    model: d.model || undefined,
                  });
                }
              }
            }
          };

          traverse(data.blockdevices);

          newResults[sess.id] = {
            sessionId: sess.id,
            disks,
            lastScan: Date.now(),
          };
        } catch (e: any) {
          console.error(`Scan error on node ${sess.name} (${sess.id}):`, e);
        }
      });

      await Promise.allSettled(promises);
      // FIX-1: write to store, not local state
      setDiscoveredNodes(newResults);
      message.success(`拓扑扫描完成，已更新 ${Object.keys(newResults).length} 个节点存储信息。`);
    } finally {
      setIsScanning(false);
    }
  }, [sessions, execCommandOnSession, setDiscoveredNodes, setIsScanning]);

  return { discoveredNodes, isScanning, scanAllNodes };
}
