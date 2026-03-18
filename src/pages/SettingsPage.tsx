import { type ReactNode, useState } from 'react'
import {
  Bell,
  BrushCleaning,
  Download,
  FolderCog,
  Keyboard,
  Languages,
  MonitorCog,
  Palette,
  RefreshCw,
  Settings2,
  TerminalSquare,
  Trash2,
  Video,
  MessageSquareMore,
} from 'lucide-react'

import { Button } from '../components/ui/Button'
import { useNavigate } from 'react-router-dom'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { CopyPathField } from '../components/ui/CopyPathField'
import { ShortcutHint } from '../components/ui/ShortcutHint'
import { cn } from '../lib/utils'
import { useAppStore } from '../stores/appStore'
import type { AppSettings } from '../types/desktop'

const keyboardShortcuts = [
  {
    title: 'Open command palette',
    description: 'Search plugins, navigation, and commands from anywhere in the app shell.',
    keys: ['Ctrl/Cmd', 'K'],
  },
  {
    title: 'Quick search',
    description: 'Open the command palette when you are not typing into a field.',
    keys: ['/'],
  },
  {
    title: 'Open settings',
    description: 'Jump straight to the Settings screen.',
    keys: ['Ctrl/Cmd', ','],
  },
  {
    title: 'Go to Dashboard',
    description: 'Open the system dashboard.',
    keys: ['Alt', '1'],
  },
  {
    title: 'Go to Plugins',
    description: 'Open the main plugin catalog view.',
    keys: ['Alt', '2'],
  },
  {
    title: 'Go to Installed',
    description: 'Open the installed plugins view.',
    keys: ['Alt', '3'],
  },
  {
    title: 'Go to Updates',
    description: 'Open the updates view.',
    keys: ['Alt', '4'],
  },
  {
    title: 'Go to Settings',
    description: 'Open this page directly from anywhere in the app shell.',
    keys: ['Alt', '5'],
  },
  {
    title: 'Close command palette or finished install modal',
    description: 'Dismiss the command palette or a safe install modal state.',
    keys: ['Esc'],
  },
]

function getDefaultPreferences(isGlobalInstallTarget: boolean): AppSettings {
  return {
    obsPath: null,
    setupCompleted: false,
    launchOnStartup: true,
    minimizeToTray: false,
    language: 'English (US)',
    autoDetectObsVersion: true,
    installScope: isGlobalInstallTarget ? 'global' : 'user',
    theme: 'dark',
    accentColor: 'purple',
    autoUpdatePlugins: true,
    betaUpdates: false,
    desktopNotifications: true,
    releaseNotifications: true,
    developerNews: false,
    developerMode: false,
  }
}

function SettingToggle({
  checked,
  description,
  disabled,
  onChange,
  title,
}: {
  checked: boolean
  description: string
  disabled?: boolean
  onChange: (nextValue: boolean) => void
  title: string
}) {
  return (
    <div className="flex items-center justify-between gap-6 rounded-[24px] border border-white/10 bg-white/[0.04] p-5">
      <div>
        <p className="font-semibold text-white">{title}</p>
        <p className="mt-1 text-sm leading-6 text-slate-400">{description}</p>
      </div>
      <button
        aria-checked={checked}
        className={cn(
          'relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-60',
          checked ? 'bg-primary' : 'bg-white/15',
        )}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        role="switch"
        type="button"
      >
        <span
          className={cn(
            'absolute top-1 h-4 w-4 rounded-full bg-white transition-all',
            checked ? 'left-6' : 'left-1',
          )}
        />
      </button>
    </div>
  )
}

function SettingSection({
  children,
  icon,
  title,
}: {
  children: ReactNode
  icon: ReactNode
  title: string
}) {
  return (
    <section>
      <div className="mb-6 flex items-center gap-3 text-primary">
        {icon}
        <h2 className="text-lg font-semibold text-white">{title}</h2>
      </div>
      {children}
    </section>
  )
}

export function SettingsPage() {
  const navigate = useNavigate()
  const bootstrap = useAppStore((state) => state.bootstrap)
  const chooseObsDirectory = useAppStore((state) => state.chooseObsDirectory)
  const updateSettings = useAppStore((state) => state.updateSettings)
  const appUpdate = useAppStore((state) => state.appUpdate)
  const appUpdateStatus = useAppStore((state) => state.appUpdateStatus)
  const appUpdateProgress = useAppStore((state) => state.appUpdateProgress)
  const isCheckingAppUpdate = useAppStore((state) => state.isCheckingAppUpdate)
  const isApplyingAppUpdate = useAppStore((state) => state.isApplyingAppUpdate)
  const checkForAppUpdate = useAppStore((state) => state.checkForAppUpdate)
  const downloadAppUpdate = useAppStore((state) => state.downloadAppUpdate)
  const installAppUpdate = useAppStore((state) => state.installAppUpdate)
  const clearCache = useAppStore((state) => state.clearCache)
  const exportLogs = useAppStore((state) => state.exportLogs)
  const resetAppData = useAppStore((state) => state.resetAppData)
  const isSettingsWorking = useAppStore((state) => state.isSettingsWorking)

  const installTargetLabel =
    bootstrap?.obsDetection.installTargetLabel?.toLowerCase() ?? ''
  const isGlobalInstallTarget = installTargetLabel.includes('shared') || installTargetLabel.includes('global')
  const preferences = bootstrap?.settings ?? getDefaultPreferences(isGlobalInstallTarget)
  const [isResetDialogOpen, setIsResetDialogOpen] = useState(false)

  function setPreference<Key extends keyof AppSettings>(key: Key, value: AppSettings[Key]) {
    void updateSettings({
      [key]: value,
    } as Partial<AppSettings>)
  }

  async function handleChangePath() {
    try {
      await chooseObsDirectory()
    } catch {
      // Store already reports the specific failure toast.
    }
  }

  async function handleResetAppData() {
    await resetAppData()
    setIsResetDialogOpen(false)
  }

  return (
    <>
      <div className="mx-auto w-full max-w-5xl space-y-12 pb-16">
        <header className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-primary/80">
            Settings
          </p>
          <h1 className="text-4xl font-semibold tracking-tight text-white">
            Manage your desktop utility preferences
          </h1>
          <p className="max-w-3xl text-sm leading-7 text-slate-400">
            Control how OBS Plugin Installer behaves on this machine, where it installs plugins,
            and how much experimental tooling you want visible while the product is still MVP-scoped.
          </p>
        </header>

        <div className="space-y-12">
          <SettingSection
            icon={<Keyboard className="size-5" />}
            title="Keyboard Shortcuts"
          >
            <div className="rounded-[24px] border border-white/10 bg-white/[0.04] p-6">
              <div className="grid gap-3">
                {keyboardShortcuts.map((shortcut) => (
                  <div
                    className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-4 md:flex-row md:items-center md:justify-between"
                    key={shortcut.title}
                  >
                    <div className="min-w-0">
                      <p className="font-semibold text-white">{shortcut.title}</p>
                      <p className="mt-1 text-sm leading-6 text-slate-400">
                        {shortcut.description}
                      </p>
                    </div>
                    <ShortcutHint
                      className="shrink-0 text-slate-400"
                      keyClassName="bg-white/[0.05] text-slate-200"
                      keys={shortcut.keys}
                    />
                  </div>
                ))}
              </div>
              <p className="mt-4 text-xs leading-6 text-slate-500">
                Shortcut handlers ignore active text inputs except the explicit search shortcuts.
              </p>
            </div>
          </SettingSection>

          <SettingSection
            icon={<Settings2 className="size-5" />}
            title="General Settings"
          >
            <div className="space-y-4">
            <SettingToggle
              checked={preferences.launchOnStartup}
              description="Automatically start OBS Plugin Installer when you sign in."
              disabled={isSettingsWorking}
              onChange={(nextValue) => setPreference('launchOnStartup', nextValue)}
              title="Launch on System Startup"
            />
            <SettingToggle
              checked={preferences.minimizeToTray}
              description="Keep the app available in the background instead of fully closing it."
              disabled={isSettingsWorking}
              onChange={(nextValue) => setPreference('minimizeToTray', nextValue)}
              title="Minimize to System Tray"
            />
            <div className="flex items-center justify-between gap-6 rounded-[24px] border border-white/10 bg-white/[0.04] p-5">
              <div className="flex items-start gap-3">
                <div className="rounded-2xl bg-white/8 p-2 text-slate-300">
                  <Languages className="size-4" />
                </div>
                <div>
                  <p className="font-semibold text-white">Interface Language</p>
                  <p className="mt-1 text-sm leading-6 text-slate-400">
                    Choose the display language for the app UI.
                  </p>
                </div>
              </div>
              <select
                className="rounded-xl border border-white/10 bg-[#1a1124] px-4 py-2 text-sm text-white outline-none transition-colors focus:border-primary/40 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isSettingsWorking}
                onChange={(event) => setPreference('language', event.target.value)}
                value={preferences.language}
              >
                <option>English (US)</option>
                <option>Deutsch</option>
                <option>Español</option>
                <option>Français</option>
                <option>日本語</option>
              </select>
            </div>
          </div>
        </SettingSection>

        <SettingSection icon={<Video className="size-5" />} title="OBS Studio Configuration">
          <div className="space-y-4">
            <div className="rounded-[24px] border border-white/10 bg-white/[0.04] p-5">
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0">
                  <p className="font-semibold text-white">OBS Installation Path</p>
                  <p className="mt-1 text-sm leading-6 text-slate-400">
                    Where OBS Studio is installed and validated on this device.
                  </p>
                </div>
                <Button size="sm" variant="outline" onClick={() => void handleChangePath()}>
                  Change Path
                </Button>
              </div>

              {bootstrap?.settings.obsPath ? (
                <CopyPathField
                  className="mt-4"
                  codeClassName="rounded-2xl px-4 py-3 text-xs"
                  value={bootstrap.settings.obsPath}
                />
              ) : (
                <div className="ui-code-block mt-4 rounded-2xl px-4 py-3 text-xs">
                  OBS has not been configured yet.
                </div>
              )}

              {bootstrap?.obsDetection.installTargetPath ? (
                <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
                    Plugin target
                  </p>
                  <CopyPathField
                    className="mt-2"
                    codeClassName="rounded-xl bg-transparent px-0 py-0 text-sm text-slate-300"
                    displayValue={`${bootstrap.obsDetection.installTargetLabel}: ${bootstrap.obsDetection.installTargetPath}`}
                    value={bootstrap.obsDetection.installTargetPath}
                  />
                </div>
              ) : null}
            </div>

            <SettingToggle
              checked={preferences.autoDetectObsVersion}
              description="Refresh compatibility messaging automatically when OBS changes."
              disabled={isSettingsWorking}
              onChange={(nextValue) => setPreference('autoDetectObsVersion', nextValue)}
              title="Auto-detect OBS version"
            />

            <div className="rounded-[24px] border border-white/10 bg-white/[0.04] p-5">
              <div className="flex items-start gap-3">
                <div className="rounded-2xl bg-white/8 p-2 text-slate-300">
                  <FolderCog className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-white">Plugin Install Directory</p>
                  <p className="mt-1 text-sm leading-6 text-slate-400">
                    The app decides this safely from your validated OBS setup, but you can still
                    see which scope is currently active.
                  </p>
                </div>
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <button
                  className={cn(
                    'rounded-2xl border px-4 py-3 text-sm font-medium transition-all disabled:cursor-not-allowed disabled:opacity-60',
                    preferences.installScope === 'user'
                      ? 'border-primary bg-primary text-on-accent'
                      : 'border-white/10 bg-white/[0.03] text-slate-400',
                  )}
                  disabled={isSettingsWorking}
                  onClick={() => setPreference('installScope', 'user')}
                  type="button"
                >
                  User Profile
                </button>
                <button
                  className={cn(
                    'rounded-2xl border px-4 py-3 text-sm font-medium transition-all disabled:cursor-not-allowed disabled:opacity-60',
                    preferences.installScope === 'global'
                      ? 'border-primary bg-primary text-on-accent'
                      : 'border-white/10 bg-white/[0.03] text-slate-400',
                  )}
                  disabled={isSettingsWorking}
                  onClick={() => setPreference('installScope', 'global')}
                  type="button"
                >
                  Global (All Users)
                </button>
              </div>
            </div>
          </div>
        </SettingSection>

        <SettingSection icon={<Palette className="size-5" />} title="App Appearance">
          <div className="rounded-[24px] border border-white/10 bg-white/[0.04] p-6">
            <div>
              <p className="font-semibold text-white">Color Theme</p>
              <div className="mt-4 grid gap-4 md:grid-cols-3">
                {(['light', 'dark', 'system'] as const).map((theme) => (
                  <button
                    className="text-left disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={isSettingsWorking}
                    key={theme}
                    onClick={() => setPreference('theme', theme)}
                    type="button"
                  >
                    <div
                      className={cn(
                        'relative aspect-video overflow-hidden rounded-2xl border-2 transition-all',
                        preferences.theme === theme
                          ? 'border-primary'
                          : 'border-white/10',
                        theme === 'light'
                          ? 'bg-slate-100'
                          : theme === 'dark'
                            ? 'bg-[#140b1f]'
                            : 'bg-gradient-to-r from-slate-100 via-slate-100 to-[#140b1f]',
                      )}
                    >
                      <div
                        className={cn(
                          'absolute inset-2 rounded-xl border',
                          theme === 'light'
                            ? 'border-slate-200 bg-white'
                            : theme === 'dark'
                              ? 'border-white/10 bg-black/25'
                              : 'border-white/10 bg-black/15',
                        )}
                      />
                      {preferences.theme === theme ? (
                        <div className="absolute right-3 top-3 rounded-full bg-primary/20 p-1 text-primary">
                          <MonitorCog className="size-4" />
                        </div>
                      ) : null}
                    </div>
                    <p
                      className={cn(
                        'mt-2 text-center text-xs font-semibold uppercase tracking-[0.18em]',
                        preferences.theme === theme ? 'text-primary' : 'text-slate-500',
                      )}
                    >
                      {theme === 'light'
                        ? 'Light'
                        : theme === 'dark'
                          ? 'Dark'
                          : 'System'}
                    </p>
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-8 rounded-[24px] border border-white/10 bg-white/[0.03] p-4">
              <p className="font-semibold text-white">Accent Color</p>
              <div className="mt-3 flex items-center gap-3">
                <div className="size-8 rounded-full bg-primary" />
                <p className="text-sm leading-6 text-slate-400">
                  The app uses one system-style accent color to keep the interface clean and
                  utility-focused.
                </p>
              </div>
            </div>
          </div>
        </SettingSection>

        <SettingSection icon={<Bell className="size-5" />} title="Updates & Notifications">
          <div className="space-y-4">
            <div className="rounded-[24px] border border-white/10 bg-white/[0.04] p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <p className="font-semibold text-white">Desktop app updates</p>
                  <p className="mt-1 text-sm leading-6 text-slate-400">
                    Keep this Tauri app current through the private Vercel update service, without
                    leaving the app.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    disabled={isCheckingAppUpdate || appUpdateStatus === 'downloading'}
                    variant="secondary"
                    onClick={() => void checkForAppUpdate({ forcePrompt: true })}
                  >
                    <RefreshCw className={cn('size-4', isCheckingAppUpdate ? 'animate-spin' : '')} />
                    Check for updates
                  </Button>
                  {appUpdateStatus === 'update-available' ? (
                    <Button onClick={() => void downloadAppUpdate()}>
                      <Download className="size-4" />
                      Update now
                    </Button>
                  ) : null}
                  {appUpdateStatus === 'ready-to-restart' ? (
                    <Button disabled={isApplyingAppUpdate} onClick={() => void installAppUpdate()}>
                      <RefreshCw className="size-4" />
                      {isApplyingAppUpdate ? 'Applying update...' : 'Restart to finish updating'}
                    </Button>
                  ) : null}
                </div>
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                {[
                  ['Current version', `v${bootstrap?.currentVersion ?? '0.0.0'}`],
                  ['Channel', preferences.betaUpdates ? 'beta' : 'stable'],
                  [
                    'Status',
                    appUpdateStatus === 'idle'
                      ? 'Not checked yet'
                      : appUpdateStatus.replace(/-/g, ' '),
                  ],
                ].map(([label, value]) => (
                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3" key={label}>
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                      {label}
                    </p>
                    <p className="mt-2 text-sm font-semibold text-white">{value}</p>
                  </div>
                ))}
              </div>

              {appUpdate ? (
                <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-4">
                  <p className="text-sm font-semibold text-white">{appUpdate.message}</p>
                  {appUpdate.latestVersion ? (
                    <p className="mt-2 text-sm leading-6 text-slate-400">
                      Latest release: v{appUpdate.latestVersion}
                      {appUpdate.minimumSupportedVersion
                        ? ` • minimum supported: v${appUpdate.minimumSupportedVersion}`
                        : ''}
                    </p>
                  ) : null}
                  {appUpdate.selectedAssetName ? (
                    <p className="mt-2 text-sm leading-6 text-slate-400">
                      Selected asset: {appUpdate.selectedAssetName}
                    </p>
                  ) : null}
                  {appUpdate.selectedAssetReason ? (
                    <p className="mt-1 text-sm leading-6 text-slate-500">
                      Reason: {appUpdate.selectedAssetReason}
                    </p>
                  ) : null}
                  {appUpdateProgress ? (
                    <div className="mt-4">
                      <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                        <span>{appUpdateProgress.message}</span>
                        <span>
                          {typeof appUpdateProgress.progressPercent === 'number'
                            ? `${Math.round(appUpdateProgress.progressPercent)}%`
                            : 'Working...'}
                        </span>
                      </div>
                      <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/[0.08]">
                        <div
                          className="h-full rounded-full bg-primary transition-all"
                          style={{ width: `${Math.max(appUpdateProgress.progressPercent ?? 10, 10)}%` }}
                        />
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>

            <SettingToggle
              checked={preferences.autoUpdatePlugins}
              description="Install curated plugin updates in the background when it is safe to do so."
              disabled={isSettingsWorking}
              onChange={(nextValue) => setPreference('autoUpdatePlugins', nextValue)}
              title="Auto-update plugins"
            />
            <SettingToggle
              checked={preferences.betaUpdates}
              description="Receive early builds and experimental plugin metadata when available."
              disabled={isSettingsWorking}
              onChange={(nextValue) => setPreference('betaUpdates', nextValue)}
              title="Beta updates"
            />
            <div className="rounded-[24px] border border-white/10 bg-white/[0.04] p-5">
              <p className="font-semibold text-white">Notification preferences</p>
              <div className="mt-4 space-y-3">
                {[
                  ['desktopNotifications', 'Desktop notifications for plugin updates'],
                  ['releaseNotifications', 'New curated plugin releases in your categories'],
                  ['developerNews', 'OBS Plugin Installer product and developer news'],
                ].map(([key, label]) => (
                  <label className="flex items-center gap-3 text-sm text-slate-300" key={key}>
                    <input
                      checked={preferences[key as keyof AppSettings] as boolean}
                      className="h-4 w-4 rounded border-white/10 bg-white/5 text-primary focus:ring-primary"
                      disabled={isSettingsWorking}
                      onChange={(event) =>
                        setPreference(
                          key as keyof AppSettings,
                          event.target.checked as never,
                        )
                      }
                      type="checkbox"
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        </SettingSection>


        <SettingSection icon={<MessageSquareMore className="size-5" />} title="Support & Requests">
          <div className="rounded-[24px] border border-white/10 bg-white/[0.04] p-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="max-w-2xl">
                <p className="font-semibold text-white">Open the in-app support center</p>
                <p className="mt-2 text-sm leading-6 text-slate-400">
                  Report desktop issues, share UI feedback, or request a new plugin from a dedicated screen that matches the rest of the product experience.
                </p>
              </div>
              <Button variant="secondary" onClick={() => navigate('/feedback')}>
                <MessageSquareMore className="size-4" />
                Open support center
              </Button>
            </div>
          </div>
        </SettingSection>

        <SettingSection
          icon={<TerminalSquare className="size-5 text-rose-300" />}
          title="Developer Options"
        >
          <div className="rounded-[24px] border border-rose-400/20 bg-rose-500/5 p-6">
            <SettingToggle
              checked={preferences.developerMode}
              description="Reveal advanced diagnostics, compatibility metadata, and install troubleshooting details."
              disabled={isSettingsWorking}
              onChange={(nextValue) => setPreference('developerMode', nextValue)}
              title="Enable Developer Mode"
            />

            <div className="mt-6 flex flex-wrap gap-3 border-t border-rose-400/10 pt-6">
              <Button disabled={isSettingsWorking} variant="secondary" onClick={() => void clearCache()}>
                <BrushCleaning className="size-4" />
                Clear Cache
              </Button>
              <Button disabled={isSettingsWorking} variant="secondary" onClick={() => void exportLogs()}>
                <FolderCog className="size-4" />
                Export Logs
              </Button>
              <Button
                className="ml-auto"
                disabled={isSettingsWorking}
                variant="outline"
                onClick={() => setIsResetDialogOpen(true)}
              >
                <Trash2 className="size-4" />
                Reset App Data
              </Button>
            </div>
          </div>
        </SettingSection>
        </div>
      </div>

      <ConfirmDialog
        cancelLabel="Keep Data"
        confirmLabel="Reset App Data"
        description="This resets the app's saved OBS path, tracked install history, and local preferences on this machine. It does not remove plugins or tools that are already installed on disk."
        isBusy={isSettingsWorking}
        onCancel={() => setIsResetDialogOpen(false)}
        onConfirm={() => void handleResetAppData()}
        open={isResetDialogOpen}
        title="Reset local app data?"
      />
    </>
  )
}
