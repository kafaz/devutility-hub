/**
 * backgroundJobStore.ts
 *
 * Background Job Execution for SSH Manager.
 *
 * Two execution modes:
 *   - once:  Long-running single command (nohup ... &)
 *   - watch: Periodic re-run every N seconds (while-loop nohup, equivalent to `watch -n N`)
 *
 * Log management:
 *   - Remote log path: /tmp/.bb-bgjob-{id}.log
 *   - Size limit: 1GB by default. Checked before each iteration; if exceeded, file is truncated.
 *   - Polling: tail -n 200 every 2s for running jobs.
 *
 * PID tracking: the launch command prints the background PID to stdout,
 * which is captured and stored for later kill -0 / kill signaling.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type JobMode = 'once' | 'watch';
export type JobStatus = 'launching' | 'running' | 'done' | 'killed' | 'error';

export interface BackgroundJob {
  id: string;
  sessionId: string;
  sessionName: string;
  cmd: string;
  mode: JobMode;
  watchInterval: number;    // seconds, only for watch mode
  logPath: string;          // remote log file path
  pid: number | null;
  status: JobStatus;
  startedAt: number;
  output: string;           // latest tail output (last 200 lines)
  errorMsg?: string;
  // Alert configuration
  alertPattern?: string;    // regex string to match against each line of output
  alertCount: number;       // how many times the pattern has been matched in total
  alertLines: string[];     // last 20 matched lines
}

const MAX_LOG_BYTES = 1024 * 1024 * 1024; // 1GB

export function shouldUpdateJobOutput(current: string, next: string): boolean {
  return current !== next;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Build the shell command launched with nohup
export function buildLaunchCmd(job: Pick<BackgroundJob, 'id' | 'cmd' | 'mode' | 'watchInterval' | 'logPath'>): string {
  const log = job.logPath;
  const sizeCheck = `
    if [ -f "${log}" ] && [ $(stat -c%s "${log}" 2>/dev/null || stat -f%z "${log}" 2>/dev/null || echo 0) -gt ${MAX_LOG_BYTES} ]; then
      > "${log}"; echo "=== [$( date )] Log truncated (exceeded 1GB) ===" >> "${log}";
    fi`.replace(/\n\s+/g, ' ').trim();

  if (job.mode === 'once') {
    // One-shot long-running command
    return `nohup bash -c '${job.cmd.replace(/'/g, "'\\''")}' >> "${log}" 2>&1 & echo $!`;
  } else {
    // watch mode: periodic with size-limit guard
    const safeCmd = job.cmd.replace(/'/g, "\\'\\''");
    const loop = `while true; do ${sizeCheck}; echo "=== [$( date )] ===" >> "${log}" 2>&1; ${safeCmd} >> "${log}" 2>&1; echo "" >> "${log}"; sleep ${job.watchInterval}; done`;
    return `nohup bash -c '${loop}' & echo $!`;
  }
}

interface BackgroundJobStore {
  jobs: BackgroundJob[];
  lastAlertJobId: string | null;   // most recently triggered alert job id

  // Called externally (component) with execCommandOnSession — returns the job id
  createJob: (
    params: {
      sessionId: string;
      sessionName: string;
      cmd: string;
      mode: JobMode;
      watchInterval: number;
      alertPattern?: string;
    },
    execFn: (sessionId: string, cmd: string, timeout: number) => Promise<{ stdout: string; stderr: string; exitCode: number; durationMs: number }>
  ) => Promise<string>;

  updateJobOutput: (id: string, output: string) => void;
  updateJobStatus: (id: string, status: JobStatus, errorMsg?: string) => void;
  setPid: (id: string, pid: number) => void;
  removeJob: (id: string) => void;
  // Record a new alert match
  recordAlertMatch: (id: string, matchedLine: string) => void;

  killJob: (
    id: string,
    execFn: (sessionId: string, cmd: string, timeout: number) => Promise<{ stdout: string; exitCode: number; stderr: string; durationMs: number }>
  ) => Promise<void>;
}

export const useBackgroundJobStore = create<BackgroundJobStore>()(
  persist(
    (set, get) => ({
      jobs: [],
      lastAlertJobId: null,

      createJob: async (params, execFn) => {
        const id = `bgjob-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const logPath = `/tmp/.bb-bgjob-${id}.log`;

        const newJob: BackgroundJob = {
          id,
          sessionId: params.sessionId,
          sessionName: params.sessionName,
          cmd: params.cmd,
          mode: params.mode,
          watchInterval: params.watchInterval,
          logPath,
          pid: null,
          status: 'launching',
          startedAt: Date.now(),
          output: '',
          alertPattern: params.alertPattern,
          alertCount: 0,
          alertLines: [],
        };
        set(s => ({ jobs: [...s.jobs, newJob] }));

        try {
          const launchCmd = buildLaunchCmd(newJob);
          const result = await execFn(params.sessionId, launchCmd, 10000);

          if (result.exitCode !== 0) {
            set(s => ({
              jobs: s.jobs.map(j => j.id === id ? { ...j, status: 'error', errorMsg: result.stderr } : j)
            }));
            return id;
          }

          // stdout should be the PID
          const pid = parseInt(result.stdout.trim(), 10);
          set(s => ({
            jobs: s.jobs.map(j => j.id === id
              ? { ...j, pid: isNaN(pid) ? null : pid, status: 'running' }
              : j
            )
          }));
        } catch (e: unknown) {
          set(s => ({
            jobs: s.jobs.map(j => j.id === id ? { ...j, status: 'error', errorMsg: getErrorMessage(e) } : j)
          }));
        }

        return id;
      },

      updateJobOutput: (id, output) =>
        set(s => ({ jobs: s.jobs.map(j => j.id === id ? { ...j, output } : j) })),

      updateJobStatus: (id, status, errorMsg) =>
        set(s => ({ jobs: s.jobs.map(j => j.id === id ? { ...j, status, errorMsg } : j) })),

      setPid: (id, pid) =>
        set(s => ({ jobs: s.jobs.map(j => j.id === id ? { ...j, pid } : j) })),

      removeJob: (id) =>
        set(s => ({ jobs: s.jobs.filter(j => j.id !== id) })),

      recordAlertMatch: (id, matchedLine) =>
        set(s => ({
          lastAlertJobId: id,
          jobs: s.jobs.map(j => j.id === id ? {
            ...j,
            alertCount: j.alertCount + 1,
            alertLines: [...j.alertLines.slice(-19), matchedLine],
          } : j)
        })),

      killJob: async (id, execFn) => {
        const job = get().jobs.find(j => j.id === id);
        if (!job) return;

        if (job.pid) {
          await execFn(job.sessionId, `kill ${job.pid} 2>/dev/null; rm -f "${job.logPath}"`, 5000).catch(() => {});
        }
        set(s => ({
          jobs: s.jobs.map(j => j.id === id ? { ...j, status: 'killed', pid: null } : j)
        }));
      },
    }),
    {
      name: 'background-job-store',
      // Only persist non-transient fields. Output can be re-tailed on reload.
      partialize: (state) => ({
        jobs: state.jobs.map(j => ({
          ...j,
          output: '',  // don't persist large outputs
          status: j.status === 'running' ? 'running' : j.status,
        })),
      }),
    }
  )
);
