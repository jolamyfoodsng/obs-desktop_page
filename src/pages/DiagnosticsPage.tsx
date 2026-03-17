import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  AlertTriangle,
  CircleCheckBig,
  LoaderCircle,
  RefreshCw,
  ScanSearch,
  ShieldCheck,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import {
  DiagnosticLogPanel,
  type DiagnosticLogEntry,
} from '../components/diagnostics/DiagnosticLogPanel'
import {
  IntegrityCheckRow,
  type IntegrityCheckStatus,
} from '../components/diagnostics/IntegrityCheckRow'
import { SummaryStatCard } from '../components/diagnostics/SummaryStatCard'
import { Button } from '../components/ui/Button'
import { CopyPathField } from '../components/ui/CopyPathField'
import { compareVersions, platformLabel } from '../lib/utils'
import { useAppStore } from '../stores/appStore'
import type { BootstrapPayload } from '../types/desktop'

interface DiagnosticCheckModel {
  id: string
  title: string
  summary: ReactNode
  status: IntegrityCheckStatus
  actionLabel?: string
  onAction?: () => void
}

type InstalledRow = {
  installedPlugin: BootstrapPayload['installedPlugins'][number]
  plugin: BootstrapPayload['plugins'][number]
}

function formatRelativeTime(isoDate: string | null) {
  if (!isoDate) {
    return 'Not yet run'
  }

  const targetDate = new Date(isoDate)
  const diffMs = targetDate.getTime() - Date.now()
  const diffMinutes = Math.round(diffMs / (60 * 1000))
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })

  if (Math.abs(diffMinutes) < 1) {
    return 'Just now'
  }

  if (Math.abs(diffMinutes) < 60) {
    return formatter.format(diffMinutes, 'minute')
  }

  const diffHours = Math.round(diffMinutes / 60)
  if (Math.abs(diffHours) < 24) {
    return formatter.format(diffHours, 'hour')
  }

  const diffDays = Math.round(diffHours / 24)
  return formatter.format(diffDays, 'day')
}

function buildInitialLogs(
  bootstrap: BootstrapPayload,
  incompatiblePluginNames: string[],
  verificationFailures: number,
): DiagnosticLogEntry[] {
  const logs: DiagnosticLogEntry[] = []
  const now = new Date()

  const pushLog = (
    level: DiagnosticLogEntry['level'],
    message: string,
    offsetSeconds: number,
  ) => {
    const timestamp = new Date(now.getTime() + offsetSeconds * 1000).toLocaleTimeString(
      [],
      {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      },
    )

    logs.push({
      id: `${level}-${offsetSeconds}-${message}`,
      level,
      message,
      timestamp,
    })
  }

  pushLog('info', 'Initializing system diagnostic scan...', 0)
  if (bootstrap.settings.obsPath) {
    pushLog('info', `Scanning OBS path: ${bootstrap.settings.obsPath}`, 1)
  } else {
    pushLog('warning', 'OBS path is not configured yet.', 1)
  }

  if (bootstrap.obsDetection.isValid) {
    pushLog('success', 'OBS installation validated.', 2)
  } else {
    pushLog('error', bootstrap.obsDetection.message || 'OBS validation failed.', 2)
  }

  if (incompatiblePluginNames.length > 0) {
    pushLog(
      'warning',
      `${incompatiblePluginNames.join(', ')} ${
        incompatiblePluginNames.length === 1 ? 'requires' : 'require'
      } version review against the current OBS build.`,
      3,
    )
  } else {
    pushLog('success', 'Managed plugin compatibility checks passed.', 3)
  }

  if (verificationFailures > 0) {
    pushLog(
      'warning',
      `${verificationFailures} managed installation${
        verificationFailures === 1 ? '' : 's'
      } reported missing tracked files.`,
      4,
    )
  } else {
    pushLog('success', 'No managed plugins are missing tracked files.', 4)
  }

  pushLog(
    'info',
    `Diagnostic summary generated for ${platformLabel(bootstrap.currentPlatform)}.`,
    5,
  )

  return logs
}

export function DiagnosticsPage() {
  const navigate = useNavigate()
  const bootstrap = useAppStore((state) => state.bootstrap)
  const loadApp = useAppStore((state) => state.loadApp)
  const detectObs = useAppStore((state) => state.detectObs)
  const [lastScanTime, setLastScanTime] = useState<string | null>(null)
  const [logs, setLogs] = useState<DiagnosticLogEntry[]>([])
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isScanning, setIsScanning] = useState(false)

  const pluginsById = useMemo(
    () => new Map((bootstrap?.plugins ?? []).map((plugin) => [plugin.id, plugin])),
    [bootstrap?.plugins],
  )
  const installedRows = useMemo(
    () =>
      (bootstrap?.installedPlugins ?? [])
        .map((installedPlugin) => ({
          installedPlugin,
          plugin: pluginsById.get(installedPlugin.pluginId),
        }))
        .filter((row): row is InstalledRow => Boolean(row.plugin)),
    [bootstrap?.installedPlugins, pluginsById],
  )

  const verificationFailures = useMemo(
    () =>
      (bootstrap?.installedPlugins ?? []).filter(
        (plugin) => plugin.verificationStatus === 'missing-files',
      ).length,
    [bootstrap?.installedPlugins],
  )

  const incompatiblePlugins = useMemo(() => {
    const detectedVersion = bootstrap?.obsDetection.obsVersion
    if (!detectedVersion) {
      return [] as typeof installedRows
    }

    return installedRows.filter(({ plugin }) => {
      if (!plugin.minOBSVersion || plugin.minOBSVersion === '0.0.0') {
        return false
      }

      if (compareVersions(detectedVersion, plugin.minOBSVersion) < 0) {
        return true
      }

      if (plugin.maxOBSVersion && compareVersions(detectedVersion, plugin.maxOBSVersion) > 0) {
        return true
      }

      return false
    })
  }, [bootstrap?.obsDetection.obsVersion, installedRows])

  const issueCount = useMemo(() => {
    let total = 0

    if (!bootstrap?.obsDetection.isValid) {
      total += 1
    }
    if (!bootstrap?.obsDetection.isSupported) {
      total += 1
    }
    total += verificationFailures
    total += incompatiblePlugins.length

    return total
  }, [
    bootstrap?.obsDetection.isSupported,
    bootstrap?.obsDetection.isValid,
    incompatiblePlugins.length,
    verificationFailures,
  ])

  const overallHealth = useMemo(() => {
    if (issueCount === 0) {
      return {
        label: 'Healthy',
        supportingText: 'No issues detected',
        tone: 'success' as const,
      }
    }

    if (issueCount === 1) {
      return {
        label: 'At Risk',
        supportingText: '1 issue requires attention',
        tone: 'warning' as const,
      }
    }

    return {
      label: 'Needs Attention',
      supportingText: `${issueCount} issues require attention`,
      tone: 'danger' as const,
    }
  }, [issueCount])

  useEffect(() => {
    if (!bootstrap) {
      return
    }

    const initialLogs = buildInitialLogs(
      bootstrap,
      incompatiblePlugins.map(({ plugin }) => plugin.name),
      verificationFailures,
    )

    setLogs((currentLogs) => (currentLogs.length === 0 ? initialLogs : currentLogs))
  }, [bootstrap, incompatiblePlugins, verificationFailures])

  async function copyLogs() {
    try {
      await navigator.clipboard.writeText(
        logs.map((entry) => `[${entry.timestamp}] ${entry.message}`).join('\n'),
      )
      toast.success('Diagnostic logs copied.')
    } catch {
      toast.error('Could not copy diagnostic logs.')
    }
  }

  async function runChecks(mode: 'refresh' | 'scan') {
    const now = new Date()
    const nowLabel = now.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })

    const append = (level: DiagnosticLogEntry['level'], message: string) => {
      setLogs((currentLogs) => [
        ...currentLogs,
        {
          id: `${Date.now()}-${level}-${message}`,
          timestamp: nowLabel,
          level,
          message,
        },
      ])
    }

    if (mode === 'refresh') {
      setIsRefreshing(true)
      append('info', 'Refreshing cached OBS detection and local catalog state...')
    } else {
      setIsScanning(true)
      append('info', 'Starting full diagnostic scan...')
    }

    try {
      await detectObs()
      append('success', 'OBS detection completed.')

      await loadApp()
      const latestBootstrap = useAppStore.getState().bootstrap

      if (latestBootstrap?.obsDetection.isValid) {
        append('success', 'OBS install path validated.')
      } else {
        append(
          'warning',
          latestBootstrap?.obsDetection.message || 'OBS validation still needs review.',
        )
      }

      const latestFailures =
        latestBootstrap?.installedPlugins.filter(
          (plugin) => plugin.verificationStatus === 'missing-files',
        ).length ?? 0

      if (latestFailures > 0) {
        append(
          'warning',
          `${latestFailures} managed installation${
            latestFailures === 1 ? '' : 's'
          } still require file repair.`,
        )
      } else {
        append('success', 'Managed install verification completed without file loss.')
      }

      append('info', mode === 'refresh' ? 'Refresh complete.' : 'Full diagnostic scan complete.')
      setLastScanTime(new Date().toISOString())
    } catch {
      append('error', mode === 'refresh' ? 'Refresh failed.' : 'Full scan failed.')
    } finally {
      if (mode === 'refresh') {
        setIsRefreshing(false)
      } else {
        setIsScanning(false)
      }
    }
  }

  const checks: DiagnosticCheckModel[] = useMemo(() => {
    if (!bootstrap) {
      return []
    }

    const checksList: DiagnosticCheckModel[] = []

    checksList.push({
      id: 'obs-installation',
      title: 'OBS Installation Detected',
      summary: bootstrap.settings.obsPath ? (
        <span className="font-mono text-xs text-slate-400">{bootstrap.settings.obsPath}</span>
      ) : (
        'OBS Studio is not configured on this device yet.'
      ),
      status: bootstrap.obsDetection.isValid ? 'passed' : 'actionable',
      actionLabel: bootstrap.obsDetection.isValid ? undefined : 'Fix Issue',
      onAction: bootstrap.obsDetection.isValid ? undefined : () => navigate('/settings'),
    })

    if (incompatiblePlugins.length > 0) {
      const firstPlugin = incompatiblePlugins[0]
      checksList.push({
        id: 'plugin-compatibility',
        title: 'Plugin Compatibility',
        summary: `${firstPlugin.plugin.name} v${firstPlugin.installedPlugin.installedVersion} is outside the recommended OBS range for ${bootstrap.obsDetection.obsVersion ?? 'this OBS version'}.`,
        status: 'actionable',
        actionLabel: 'Fix Issue',
        onAction: () => navigate(`/plugin/${firstPlugin.plugin.id}`),
      })
    } else {
      checksList.push({
        id: 'plugin-compatibility',
        title: 'Plugin Compatibility',
        summary: 'Managed plugins are within the detected OBS compatibility range.',
        status: 'passed',
      })
    }

    checksList.push({
      id: 'missing-dependencies',
      title: 'Missing Dependencies',
      summary: bootstrap.obsDetection.isValid
        ? 'Core OBS runtime files required for managed installs are present.'
        : 'Dependency checks are limited until OBS Studio is configured.',
      status: bootstrap.obsDetection.isValid ? 'passed' : 'warning',
    })

    if (verificationFailures > 0) {
      checksList.push({
        id: 'broken-plugins',
        title: 'Broken Plugins',
        summary: `${verificationFailures} managed install${
          verificationFailures === 1 ? '' : 's'
        } are missing tracked files and may need repair.`,
        status: 'actionable',
        actionLabel: 'Retry',
        onAction: () => navigate('/installed'),
      })
    } else {
      checksList.push({
        id: 'broken-plugins',
        title: 'Broken Plugins',
        summary: 'No managed plugin file integrity issues were found in the current session.',
        status: 'passed',
      })
    }

    return checksList
  }, [bootstrap, incompatiblePlugins, navigate, verificationFailures])

  if (!bootstrap) {
    return null
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-8 pb-16">
      <section className="flex flex-col gap-4 border-b border-white/10 pb-6 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.26em] text-primary/80">
            System Health Check
          </p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight text-white">
            Diagnostic Scan
          </h1>
          <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-400">
            Identify and fix issues within your OBS Studio environment automatically.
          </p>
        </div>
        <Button
          disabled={isRefreshing || isScanning}
          variant="secondary"
          onClick={() => void runChecks('refresh')}
        >
          {isRefreshing ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : (
            <RefreshCw className="size-4" />
          )}
          Refresh
        </Button>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <SummaryStatCard
          icon={
            overallHealth.tone === 'success' ? (
              <ShieldCheck className="size-5 text-primary" />
            ) : (
              <AlertTriangle
                className={`size-5 ${
                  overallHealth.tone === 'danger' ? 'text-red-300' : 'text-amber-300'
                }`}
              />
            )
          }
          label="Overall Health"
          supportingText={overallHealth.supportingText}
          tone={overallHealth.tone}
          value={overallHealth.label}
        />
        <SummaryStatCard
          icon={
            bootstrap.obsDetection.isSupported ? (
              <CircleCheckBig className="size-5 text-primary" />
            ) : (
              <AlertTriangle className="size-5 text-amber-300" />
            )
          }
          label="OBS Version"
          supportingText={
            bootstrap.obsDetection.isValid
              ? bootstrap.obsDetection.isSupported
                ? 'Up to date'
                : 'Needs review'
              : 'Not detected'
          }
          tone={
            !bootstrap.obsDetection.isValid
              ? 'danger'
              : bootstrap.obsDetection.isSupported
                ? 'success'
                : 'warning'
          }
          value={bootstrap.obsDetection.obsVersion ?? 'Unknown'}
        />
        <SummaryStatCard
          icon={<ScanSearch className="size-5 text-slate-500" />}
          label="Last Full Scan"
          supportingText={
            lastScanTime ? 'Next scheduled: Manual refresh only' : 'No scheduled scan'
          }
          value={formatRelativeTime(lastScanTime)}
        />
      </section>

      <section className="overflow-hidden rounded-[24px] border border-white/10 bg-white/[0.04]">
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-white">Active Integrity Checks</h2>
            <p className="mt-1 text-sm leading-6 text-slate-400">
              Current install, compatibility, and managed file integrity checks.
            </p>
          </div>
          <span className="rounded-md border border-white/10 px-2 py-1 text-[11px] font-mono text-slate-400">
            DEBUG_MODE=OFF
          </span>
        </div>
        <div className="divide-y divide-white/8">
          {checks.map((check) => (
            <IntegrityCheckRow
              actionLabel={check.actionLabel}
              key={check.id}
              onAction={check.onAction}
              status={check.status}
              summary={check.summary}
              title={check.title}
            />
          ))}
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)]">
        <DiagnosticLogPanel
          logs={logs}
          onClear={() => setLogs([])}
          onCopy={() => void copyLogs()}
        />

        <section className="rounded-[24px] border border-white/10 bg-white/[0.04] p-5">
          <h2 className="text-sm font-semibold uppercase tracking-[0.22em] text-slate-500">
            OBS Environment
          </h2>
          <div className="mt-4 space-y-4">
            <div className="space-y-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                Installation Path
              </span>
              {bootstrap.settings.obsPath ? (
                <CopyPathField
                  codeClassName="rounded-xl px-3 py-2 text-xs"
                  value={bootstrap.settings.obsPath}
                />
              ) : (
                <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-slate-400">
                  OBS path not configured yet.
                </div>
              )}
            </div>

            <div className="flex items-center justify-between border-b border-white/10 py-2">
              <span className="text-xs text-slate-400">Validation</span>
              <span className="text-xs font-semibold text-slate-300">
                {bootstrap.obsDetection.isValid ? 'Validated' : 'Needs setup'}
              </span>
            </div>
            <div className="flex items-center justify-between border-b border-white/10 py-2">
              <span className="text-xs text-slate-400">Version</span>
              <span className="text-xs font-semibold text-slate-300">
                {bootstrap.obsDetection.obsVersion ?? 'Unknown'}
              </span>
            </div>
            <div className="flex items-center justify-between border-b border-white/10 py-2">
              <span className="text-xs text-slate-400">Plugin target</span>
              <span className="text-right text-xs font-semibold text-slate-300">
                {bootstrap.obsDetection.installTargetLabel ?? 'Pending'}
              </span>
            </div>
            <div className="flex items-center justify-between py-2">
              <span className="text-xs text-slate-400">Platform</span>
              <span className="text-xs font-semibold text-slate-300">
                {platformLabel(bootstrap.currentPlatform)}
              </span>
            </div>
          </div>
        </section>
      </section>

      <section className="flex flex-col items-center gap-4 border-t border-white/10 pt-8 text-center">
        <Button
          disabled={isRefreshing || isScanning}
          size="lg"
          onClick={() => void runChecks('scan')}
        >
          {isScanning ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : (
            <ScanSearch className="size-4" />
          )}
          Run Full Scan
        </Button>
        <p className="text-xs leading-6 text-slate-500">
          A full scan may take up to 2 minutes depending on your library size.
        </p>
      </section>
    </div>
  )
}
