import {
  CheckCircle2,
  FolderSearch,
  LoaderCircle,
  PencilLine,
} from 'lucide-react'

import type { ObsDetectionState } from '../types/desktop'
import { Button } from './ui/Button'
import { CopyPathField } from './ui/CopyPathField'

interface SetupWizardProps {
  detection: ObsDetectionState
  isBusy: boolean
  onAcceptDetectedPath: (path: string) => Promise<void>
  onChooseDirectory: () => Promise<void>
  onDetectAgain: () => Promise<void>
}

export function SetupWizard({
  detection,
  isBusy,
  onAcceptDetectedPath,
  onChooseDirectory,
  onDetectAgain,
}: SetupWizardProps) {
  const currentPath = detection.storedPath ?? detection.detectedPath

  return (
    <div className="min-h-screen bg-background-dark px-4 py-10 text-slate-100">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-6xl items-center justify-center">
        <div className="grid w-full gap-10 lg:grid-cols-[1.1fr_0.9fr]">
          <section className="rounded-xl border border-white/10 bg-white/[0.04] p-8 shadow-panel">
            <div className="mb-10 flex items-center justify-between gap-6">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary/80">
                  First-time setup
                </p>
                <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white">
                  Find your OBS Studio install
                </h1>
                <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-300">
                  We’ll detect OBS automatically, verify the path for your operating system, and save the trusted location locally before any plugin files are touched.
                </p>
              </div>
            </div>

            <div className="mb-8 rounded-xl border border-primary/20 bg-primary/10 p-5">
              <div className="mb-4 flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-white">Step 1 of 3</p>
                  <p className="mt-1 text-sm text-slate-300">Detect OBS and lock in a trusted install path.</p>
                </div>
                <span className="text-sm font-semibold text-primary">33%</span>
              </div>
              <div className="h-2.5 overflow-hidden rounded-full bg-white/10">
                <div className="h-full w-1/3 rounded-full bg-primary" />
              </div>
              <div className="mt-4 flex items-center gap-2 text-sm text-slate-300">
                <CheckCircle2 className="size-4 text-primary" />
                Windows, macOS, and common native Linux paths are supported in this MVP.
              </div>
            </div>

            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-6">
              <div className="flex items-start gap-4">
                <div className="rounded-2xl bg-primary/20 p-3 text-primary">
                  <FolderSearch className="size-7" />
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="text-xl font-semibold text-white">
                    {currentPath ? 'OBS detected at' : 'No OBS path saved yet'}
                  </h2>
                  {currentPath ? (
                    <CopyPathField
                      className="mt-2"
                      codeClassName="rounded-lg px-4 py-3 text-sm"
                      value={currentPath}
                    />
                  ) : (
                    <p className="ui-code-block mt-2 break-all rounded-lg px-4 py-3 text-sm">
                      Automatic detection did not find a valid obs-studio folder yet.
                    </p>
                  )}
                  <p className="mt-3 text-sm leading-6 text-slate-400">{detection.message}</p>
                  {detection.installTargetPath ? (
                    <div className="mt-4 rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
                        Install target
                      </p>
                      <CopyPathField
                        className="mt-2"
                        codeClassName="rounded-md bg-transparent px-0 py-0 text-sm text-slate-300"
                        displayValue={`${detection.installTargetLabel}: ${detection.installTargetPath}`}
                        value={detection.installTargetPath}
                      />
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="mt-6 flex flex-wrap gap-3">
                {currentPath ? (
                  <Button
                    className="min-w-[160px]"
                    disabled={isBusy}
                    onClick={() => onAcceptDetectedPath(currentPath)}
                  >
                    {isBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}
                    Continue
                  </Button>
                ) : null}
                <Button disabled={isBusy} variant="secondary" onClick={onChooseDirectory}>
                  <PencilLine className="size-4" />
                  Locate OBS manually
                </Button>
                <Button disabled={isBusy} variant="ghost" onClick={onDetectAgain}>
                  {isBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}
                  Detect again
                </Button>
              </div>
            </div>
          </section>

          <aside className="flex flex-col justify-between gap-6">
            <div className="rounded-xl border border-white/10 bg-white/[0.04] p-6 shadow-panel">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary/80">
                Safety first
              </p>
              <h3 className="mt-3 text-[18px] font-semibold text-white">Why the app asks for your OBS path</h3>
              <div className="mt-6 space-y-4 text-sm leading-7 text-slate-300">
                <p>Installs stay predictable because plugin files are copied into a verified OBS folder only.</p>
                <p>The installer refuses unsupported ZIP structures instead of scattering files across your system.</p>
                <p>Installed plugin history is saved locally, so Updates and Installed stay accurate for this device.</p>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-1">
              <div className="rounded-xl border border-white/10 bg-white/[0.04] p-5">
                <p className="text-sm font-semibold text-white">Curated catalog</p>
                <p className="mt-2 text-sm leading-6 text-slate-400">
                  A focused starter set keeps installs safe while the marketplace is still MVP-scoped.
                </p>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/[0.04] p-5">
                <p className="text-sm font-semibold text-white">Guided updates</p>
                <p className="mt-2 text-sm leading-6 text-slate-400">
                  The app tracks what it installed so it can surface clean update prompts later.
                </p>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/[0.04] p-5">
                <p className="text-sm font-semibold text-white">Trusted fallbacks</p>
                <p className="mt-2 text-sm leading-6 text-slate-400">
                  When a vendor only ships an installer or release page, the UI makes that explicit instead of guessing.
                </p>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  )
}
