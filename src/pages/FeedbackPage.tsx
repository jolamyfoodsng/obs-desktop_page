import { useMemo, useState, type FormEvent, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import packageJson from '../../package.json'
import {
  AlertCircle,
  Bug,
  CheckCircle2,
  ExternalLink,
  FileImage,
  LifeBuoy,
  LoaderCircle,
  MessageSquare,
  PlusCircle,
  RefreshCw,
  Send,
  Sparkles,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { cn, platformLabel } from '../lib/utils'
import { useAppStore } from '../stores/appStore'

const issueTypeOptions = [
  'Installation failed',
  'App crash',
  'Plugin not showing',
  'UI bug',
  'Other',
] as const

const feedbackCategoryOptions = [
  'Feature suggestion',
  'User interface',
  'Performance',
  'General praise',
  'Other',
] as const

const pluginCategoryOptions = [
  'Visual effects',
  'Audio processing',
  'Transitions',
  'Integration / API',
  'Tools',
] as const

type FeedbackPanel = 'problem' | 'feedback' | 'request'
type SubmitStatus = 'idle' | 'loading' | 'success' | 'error'

type ProblemFormState = {
  name: string
  email: string
  issueType: string
  operatingSystem: string
  appVersion: string
  obsVersion: string
  pluginInvolved: string
  whatHappened: string
  expectedBehavior: string
  screenshotName: string
}

type GeneralFeedbackFormState = {
  name: string
  email: string
  category: string
  message: string
}

type PluginRequestFormState = {
  pluginName: string
  pluginUrl: string
  category: string
  reason: string
  email: string
}

function defaultProblemForm(operatingSystem: string, appVersion: string, obsVersion: string): ProblemFormState {
  return {
    name: '',
    email: '',
    issueType: issueTypeOptions[0],
    operatingSystem,
    appVersion,
    obsVersion,
    pluginInvolved: '',
    whatHappened: '',
    expectedBehavior: '',
    screenshotName: '',
  }
}

function defaultFeedbackForm(): GeneralFeedbackFormState {
  return {
    name: '',
    email: '',
    category: feedbackCategoryOptions[0],
    message: '',
  }
}

function defaultPluginRequestForm(): PluginRequestFormState {
  return {
    pluginName: '',
    pluginUrl: '',
    category: pluginCategoryOptions[3],
    reason: '',
    email: '',
  }
}

function emailIsValid(value: string) {
  if (!value.trim()) {
    return true
  }

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function urlIsValid(value: string) {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:'
  } catch {
    return false
  }
}

function FieldLabel({ children, helper }: { children: ReactNode; helper?: string }) {
  return (
    <label className="block space-y-2">
      <div>
        <span className="text-sm font-semibold text-white">{children}</span>
        {helper ? <p className="mt-1 text-xs leading-5 text-slate-500">{helper}</p> : null}
      </div>
    </label>
  )
}

function TextInput({ error, ...props }: InputHTMLAttributes<HTMLInputElement> & { error?: string }) {
  return (
    <div>
      <input
        className={cn(
          'w-full rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white outline-none transition-colors placeholder:text-slate-500 focus:border-primary/40',
          error ? 'border-rose-400/50 focus:border-rose-400/60' : '',
        )}
        {...props}
      />
      {error ? <p className="mt-2 text-xs text-rose-300">{error}</p> : null}
    </div>
  )
}

function SelectInput({ error, children, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { error?: string }) {
  return (
    <div>
      <select
        className={cn(
          'w-full rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white outline-none transition-colors focus:border-primary/40',
          error ? 'border-rose-400/50 focus:border-rose-400/60' : '',
        )}
        {...props}
      >
        {children}
      </select>
      {error ? <p className="mt-2 text-xs text-rose-300">{error}</p> : null}
    </div>
  )
}

function TextArea({ error, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & { error?: string }) {
  return (
    <div>
      <textarea
        className={cn(
          'min-h-[120px] w-full rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white outline-none transition-colors placeholder:text-slate-500 focus:border-primary/40',
          error ? 'border-rose-400/50 focus:border-rose-400/60' : '',
        )}
        {...props}
      />
      {error ? <p className="mt-2 text-xs text-rose-300">{error}</p> : null}
    </div>
  )
}

function SectionCard({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cn('rounded-[24px] border border-white/10 bg-white/[0.04] p-6 shadow-panel', className)}>{children}</section>
}

function SupportPanelButton({
  active,
  description,
  icon,
  onClick,
  title,
}: {
  active: boolean
  description: string
  icon: ReactNode
  onClick: () => void
  title: string
}) {
  return (
    <button
      className={cn(
        'rounded-[24px] border p-5 text-left transition-all',
        active
          ? 'border-primary/30 bg-primary/10'
          : 'border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.05]',
      )}
      onClick={onClick}
      type="button"
    >
      <div className="flex items-start gap-4">
        <div className={cn('flex size-11 shrink-0 items-center justify-center rounded-2xl border', active ? 'border-primary/30 bg-primary/15 text-primary' : 'border-white/10 bg-white/[0.04] text-slate-400')}>
          {icon}
        </div>
        <div className="min-w-0">
          <p className="font-semibold text-white">{title}</p>
          <p className="mt-2 text-sm leading-6 text-slate-400">{description}</p>
        </div>
      </div>
    </button>
  )
}

function FormStatusBanner({ status, message }: { status: SubmitStatus; message: string | null }) {
  if (!message || status === 'idle') {
    return null
  }

  const isError = status === 'error'

  return (
    <div className={cn('rounded-2xl border px-4 py-3 text-sm', isError ? 'border-rose-400/30 bg-rose-500/10 text-rose-200' : 'border-primary/20 bg-primary/10 text-slate-200')}>
      <div className="flex items-start gap-3">
        {isError ? <AlertCircle className="mt-0.5 size-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />}
        <span className="leading-6">{message}</span>
      </div>
    </div>
  )
}

function SuccessStateCard({
  description,
  onReset,
  title,
}: {
  description: string
  onReset: () => void
  title: string
}) {
  return (
    <SectionCard className="border-primary/20 bg-primary/5">
      <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
        <div className="flex items-start gap-4">
          <div className="flex size-14 shrink-0 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-primary">
            <CheckCircle2 className="size-7" />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary/80">Captured in app</p>
            <h2 className="mt-2 text-2xl font-semibold text-white">{title}</h2>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-400">{description}</p>
          </div>
        </div>
        <Button variant="secondary" onClick={onReset}>
          <RefreshCw className="size-4" />
          Submit another
        </Button>
      </div>
    </SectionCard>
  )
}

export function FeedbackPage() {
  const navigate = useNavigate()
  const bootstrap = useAppStore((state) => state.bootstrap)
  const openExternal = useAppStore((state) => state.openExternal)

  const operatingSystem = platformLabel(bootstrap?.currentPlatform ?? 'unknown')
  const appVersion = `v${packageJson.version}`
  const obsVersion = bootstrap?.obsDetection.obsVersion ?? ''

  const [activePanel, setActivePanel] = useState<FeedbackPanel>('request')
  const [problemForm, setProblemForm] = useState(() => defaultProblemForm(operatingSystem, appVersion, obsVersion))
  const [feedbackForm, setFeedbackForm] = useState(() => defaultFeedbackForm())
  const [pluginRequestForm, setPluginRequestForm] = useState(() => defaultPluginRequestForm())
  const [problemErrors, setProblemErrors] = useState<Record<string, string>>({})
  const [feedbackErrors, setFeedbackErrors] = useState<Record<string, string>>({})
  const [pluginRequestErrors, setPluginRequestErrors] = useState<Record<string, string>>({})
  const [problemStatus, setProblemStatus] = useState<SubmitStatus>('idle')
  const [feedbackStatus, setFeedbackStatus] = useState<SubmitStatus>('idle')
  const [pluginRequestStatus, setPluginRequestStatus] = useState<SubmitStatus>('idle')
  const [problemMessage, setProblemMessage] = useState<string | null>(null)
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null)
  const [pluginRequestMessage, setPluginRequestMessage] = useState<string | null>(null)

  const helperStats = useMemo(
    () => [
      ['Desktop build', appVersion],
      ['Detected platform', operatingSystem],
      ['OBS version', obsVersion || 'Not detected'],
    ],
    [appVersion, obsVersion, operatingSystem],
  )

  function resetProblemState() {
    setProblemForm(defaultProblemForm(operatingSystem, appVersion, obsVersion))
    setProblemErrors({})
    setProblemStatus('idle')
    setProblemMessage(null)
  }

  function resetFeedbackState() {
    setFeedbackForm(defaultFeedbackForm())
    setFeedbackErrors({})
    setFeedbackStatus('idle')
    setFeedbackMessage(null)
  }

  function resetPluginRequestState() {
    setPluginRequestForm(defaultPluginRequestForm())
    setPluginRequestErrors({})
    setPluginRequestStatus('idle')
    setPluginRequestMessage(null)
  }

  function validateProblemForm() {
    const nextErrors: Record<string, string> = {}

    if (!problemForm.whatHappened.trim()) {
      nextErrors.whatHappened = 'Please describe the problem.'
    }

    if (!problemForm.expectedBehavior.trim()) {
      nextErrors.expectedBehavior = 'Please describe what you expected to happen.'
    }

    if (!emailIsValid(problemForm.email)) {
      nextErrors.email = 'Enter a valid email address or leave it blank.'
    }

    return nextErrors
  }

  function validateFeedbackForm() {
    const nextErrors: Record<string, string> = {}

    if (!feedbackForm.message.trim()) {
      nextErrors.message = 'Please share your feedback before submitting.'
    }

    if (!emailIsValid(feedbackForm.email)) {
      nextErrors.email = 'Enter a valid email address or leave it blank.'
    }

    return nextErrors
  }

  function validatePluginRequestForm() {
    const nextErrors: Record<string, string> = {}

    if (!pluginRequestForm.pluginName.trim()) {
      nextErrors.pluginName = 'Plugin name is required.'
    }

    if (!pluginRequestForm.pluginUrl.trim()) {
      nextErrors.pluginUrl = 'Please include the official plugin or repository link.'
    } else if (!urlIsValid(pluginRequestForm.pluginUrl)) {
      nextErrors.pluginUrl = 'Enter a valid HTTP or HTTPS URL.'
    }

    if (!pluginRequestForm.reason.trim()) {
      nextErrors.reason = 'Please explain why this plugin should be reviewed.'
    }

    if (!emailIsValid(pluginRequestForm.email)) {
      nextErrors.email = 'Enter a valid email address or leave it blank.'
    }

    return nextErrors
  }

  async function handleProblemSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const nextErrors = validateProblemForm()
    setProblemErrors(nextErrors)

    if (Object.keys(nextErrors).length > 0) {
      setProblemStatus('error')
      setProblemMessage('Please fix the highlighted fields before you submit this report.')
      return
    }

    setProblemStatus('loading')
    setProblemMessage(null)

    try {
      await new Promise((resolve) => window.setTimeout(resolve, 700))
      setProblemStatus('success')
      setProblemMessage('Problem report drafted successfully.')
    } catch {
      setProblemStatus('error')
      setProblemMessage('The problem report could not be prepared right now. Please try again.')
    }
  }

  async function handleFeedbackSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const nextErrors = validateFeedbackForm()
    setFeedbackErrors(nextErrors)

    if (Object.keys(nextErrors).length > 0) {
      setFeedbackStatus('error')
      setFeedbackMessage('Please fix the highlighted fields before you submit this feedback.')
      return
    }

    setFeedbackStatus('loading')
    setFeedbackMessage(null)

    try {
      await new Promise((resolve) => window.setTimeout(resolve, 700))
      setFeedbackStatus('success')
      setFeedbackMessage('Feedback captured successfully.')
    } catch {
      setFeedbackStatus('error')
      setFeedbackMessage('The feedback draft could not be prepared right now. Please try again.')
    }
  }

  async function handlePluginRequestSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const nextErrors = validatePluginRequestForm()
    setPluginRequestErrors(nextErrors)

    if (Object.keys(nextErrors).length > 0) {
      setPluginRequestStatus('error')
      setPluginRequestMessage('Please fix the highlighted fields before you submit this request.')
      return
    }

    setPluginRequestStatus('loading')
    setPluginRequestMessage(null)

    try {
      await new Promise((resolve) => window.setTimeout(resolve, 700))
      setPluginRequestStatus('success')
      setPluginRequestMessage('Plugin request captured successfully.')
    } catch {
      setPluginRequestStatus('error')
      setPluginRequestMessage('The plugin request could not be prepared right now. Please try again.')
    }
  }

  if (!bootstrap) {
    return null
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-8 pb-16">
      <section className="flex flex-col gap-5 border-b border-white/10 pb-6 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.26em] text-primary/80">Support</p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-semibold text-white">Feedback &amp; Requests</h1>
            <Badge tone="primary">In-app support</Badge>
          </div>
          <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-400">
            Report a problem, send product feedback, or request a plugin without leaving OBS Plugin Installer.
            This screen is designed for desktop support workflows, so fields are prefilled with app context where possible.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {helperStats.map(([label, value]) => (
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3" key={label}>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">{label}</p>
              <p className="mt-2 text-sm font-semibold text-white">{value}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <SupportPanelButton
          active={activePanel === 'problem'}
          description="Capture crashes, install failures, compatibility issues, and unexpected app behavior."
          icon={<Bug className="size-5" />}
          onClick={() => setActivePanel('problem')}
          title="Report a Problem"
        />
        <SupportPanelButton
          active={activePanel === 'feedback'}
          description="Share UI ideas, workflow improvements, or general product feedback for the desktop app."
          icon={<MessageSquare className="size-5" />}
          onClick={() => setActivePanel('feedback')}
          title="Send Feedback"
        />
        <SupportPanelButton
          active={activePanel === 'request'}
          description="Suggest a plugin to review and include the official source link so maintainers can verify it quickly."
          icon={<PlusCircle className="size-5" />}
          onClick={() => setActivePanel('request')}
          title="Request a Plugin"
        />
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_280px]">
        <div className="space-y-6">
          {activePanel === 'problem' ? (
            problemStatus === 'success' ? (
              <SuccessStateCard
                description="Your report has been captured inside this app session and is ready for a future submission backend. This preview build does not transmit support data yet, so nothing has been sent outside your machine."
                onReset={resetProblemState}
                title="Problem report ready"
              />
            ) : (
              <SectionCard>
                <div className="flex flex-col gap-3 border-b border-white/10 pb-5 md:flex-row md:items-start md:justify-between">
                  <div>
                    <h2 className="text-2xl font-semibold text-white">Report a Problem</h2>
                    <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-400">
                      Include enough detail for troubleshooting. Version fields are prefilled so maintainers can reproduce issues faster.
                    </p>
                  </div>
                  <Badge tone="danger">Needs triage</Badge>
                </div>
                <form className="mt-6 space-y-6" onSubmit={handleProblemSubmit}>
                  <FormStatusBanner message={problemMessage} status={problemStatus} />
                  <div className="grid gap-5 md:grid-cols-2">
                    <div>
                      <FieldLabel helper="Optional, if you want us to know who sent it.">Name</FieldLabel>
                      <TextInput placeholder="John Doe" value={problemForm.name} onChange={(event) => setProblemForm((current) => ({ ...current, name: event.target.value }))} />
                    </div>
                    <div>
                      <FieldLabel helper="Optional, used only if follow-up is needed.">Email</FieldLabel>
                      <TextInput error={problemErrors.email} placeholder="john@example.com" type="email" value={problemForm.email} onChange={(event) => setProblemForm((current) => ({ ...current, email: event.target.value }))} />
                    </div>
                    <div>
                      <FieldLabel>Issue type</FieldLabel>
                      <SelectInput value={problemForm.issueType} onChange={(event) => setProblemForm((current) => ({ ...current, issueType: event.target.value }))}>
                        {issueTypeOptions.map((option) => <option key={option}>{option}</option>)}
                      </SelectInput>
                    </div>
                    <div>
                      <FieldLabel>Operating system</FieldLabel>
                      <TextInput value={problemForm.operatingSystem} onChange={(event) => setProblemForm((current) => ({ ...current, operatingSystem: event.target.value }))} />
                    </div>
                    <div>
                      <FieldLabel>App version</FieldLabel>
                      <TextInput value={problemForm.appVersion} onChange={(event) => setProblemForm((current) => ({ ...current, appVersion: event.target.value }))} />
                    </div>
                    <div>
                      <FieldLabel>OBS version</FieldLabel>
                      <TextInput placeholder="30.0.2" value={problemForm.obsVersion} onChange={(event) => setProblemForm((current) => ({ ...current, obsVersion: event.target.value }))} />
                    </div>
                  </div>
                  <div>
                    <FieldLabel helper="Optional, if the issue appears tied to a specific install.">Plugin involved</FieldLabel>
                    <TextInput placeholder="Move Transition" value={problemForm.pluginInvolved} onChange={(event) => setProblemForm((current) => ({ ...current, pluginInvolved: event.target.value }))} />
                  </div>
                  <div>
                    <FieldLabel>What happened?</FieldLabel>
                    <TextArea error={problemErrors.whatHappened} placeholder="Describe the issue, the steps you took, and any error text you saw." rows={5} value={problemForm.whatHappened} onChange={(event) => setProblemForm((current) => ({ ...current, whatHappened: event.target.value }))} />
                  </div>
                  <div>
                    <FieldLabel>What did you expect?</FieldLabel>
                    <TextArea error={problemErrors.expectedBehavior} placeholder="Describe the expected result so maintainers can compare the behavior." rows={4} value={problemForm.expectedBehavior} onChange={(event) => setProblemForm((current) => ({ ...current, expectedBehavior: event.target.value }))} />
                  </div>
                  <div>
                    <FieldLabel helper="Attachments are tracked in the form UI now and can be wired to a real uploader later.">Screenshot</FieldLabel>
                    <label className="flex cursor-pointer items-center gap-4 rounded-[24px] border border-dashed border-white/10 bg-white/[0.03] px-5 py-5 transition-colors hover:border-primary/30 hover:bg-primary/5">
                      <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-slate-400">
                        <FileImage className="size-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-white">{problemForm.screenshotName || 'Choose a screenshot'}</p>
                        <p className="mt-1 text-sm leading-6 text-slate-400">PNG, JPG, or any local image reference for future support submission wiring.</p>
                      </div>
                      <input className="sr-only" type="file" accept="image/*" onChange={(event) => setProblemForm((current) => ({ ...current, screenshotName: event.target.files?.[0]?.name ?? '' }))} />
                    </label>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-5">
                    <p className="text-xs leading-6 text-slate-500">This build validates and stores the draft in-memory only. Submission transport can be connected later without redesigning the screen.</p>
                    <Button disabled={problemStatus === 'loading'} type="submit">
                      {problemStatus === 'loading' ? <LoaderCircle className="size-4 animate-spin" /> : <Send className="size-4" />}
                      {problemStatus === 'loading' ? 'Preparing report...' : 'Submit report'}
                    </Button>
                  </div>
                </form>
              </SectionCard>
            )
          ) : null}

          {activePanel === 'feedback' ? (
            feedbackStatus === 'success' ? (
              <SuccessStateCard
                description="Your feedback is captured and ready for future backend wiring. This preview build does not send the message yet, but the form state, validation, and success flow are implemented as production UI patterns."
                onReset={resetFeedbackState}
                title="Feedback saved"
              />
            ) : (
              <SectionCard>
                <div className="flex flex-col gap-3 border-b border-white/10 pb-5 md:flex-row md:items-start md:justify-between">
                  <div>
                    <h2 className="text-2xl font-semibold text-white">Send Feedback</h2>
                    <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-400">
                      Use this for feature ideas, polish requests, and broader product suggestions that are not urgent bugs.
                    </p>
                  </div>
                  <Badge tone="primary">Product input</Badge>
                </div>
                <form className="mt-6 space-y-6" onSubmit={handleFeedbackSubmit}>
                  <FormStatusBanner message={feedbackMessage} status={feedbackStatus} />
                  <div className="grid gap-5 md:grid-cols-2">
                    <div>
                      <FieldLabel helper="Optional.">Name</FieldLabel>
                      <TextInput placeholder="Jane Smith" value={feedbackForm.name} onChange={(event) => setFeedbackForm((current) => ({ ...current, name: event.target.value }))} />
                    </div>
                    <div>
                      <FieldLabel helper="Optional, if a reply would help.">Email</FieldLabel>
                      <TextInput error={feedbackErrors.email} placeholder="jane@example.com" type="email" value={feedbackForm.email} onChange={(event) => setFeedbackForm((current) => ({ ...current, email: event.target.value }))} />
                    </div>
                  </div>
                  <div>
                    <FieldLabel>Feedback category</FieldLabel>
                    <SelectInput value={feedbackForm.category} onChange={(event) => setFeedbackForm((current) => ({ ...current, category: event.target.value }))}>
                      {feedbackCategoryOptions.map((option) => <option key={option}>{option}</option>)}
                    </SelectInput>
                  </div>
                  <div>
                    <FieldLabel>Tell us more</FieldLabel>
                    <TextArea error={feedbackErrors.message} placeholder="Share the workflow issue, idea, or improvement you would like to see in the desktop app." rows={7} value={feedbackForm.message} onChange={(event) => setFeedbackForm((current) => ({ ...current, message: event.target.value }))} />
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-5">
                    <p className="text-xs leading-6 text-slate-500">Clear, concrete feedback is easier to route into the roadmap and design review queue.</p>
                    <Button disabled={feedbackStatus === 'loading'} type="submit">
                      {feedbackStatus === 'loading' ? <LoaderCircle className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                      {feedbackStatus === 'loading' ? 'Preparing feedback...' : 'Submit feedback'}
                    </Button>
                  </div>
                </form>
              </SectionCard>
            )
          ) : null}

          {activePanel === 'request' ? (
            pluginRequestStatus === 'success' ? (
              <SuccessStateCard
                description="Your plugin suggestion is ready for a real submission pipeline. Compatibility, safety review, and source validation will still be required before any requested plugin would be added to the managed catalog."
                onReset={resetPluginRequestState}
                title="Plugin request saved"
              />
            ) : (
              <SectionCard className="border-primary/20">
                <div className="flex flex-col gap-3 border-b border-white/10 pb-5 md:flex-row md:items-start md:justify-between">
                  <div>
                    <h2 className="text-2xl font-semibold text-white">Request a Plugin</h2>
                    <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-400">
                      Share the official plugin page, GitHub repository, or OBS resource link so maintainers can verify the package and supported platforms quickly.
                    </p>
                  </div>
                  <Badge tone="success">Catalog review</Badge>
                </div>
                <form className="mt-6 space-y-6" onSubmit={handlePluginRequestSubmit}>
                  <FormStatusBanner message={pluginRequestMessage} status={pluginRequestStatus} />
                  <div className="grid gap-5 md:grid-cols-2">
                    <div>
                      <FieldLabel>Plugin name</FieldLabel>
                      <TextInput error={pluginRequestErrors.pluginName} placeholder="Stream Deck Connector" value={pluginRequestForm.pluginName} onChange={(event) => setPluginRequestForm((current) => ({ ...current, pluginName: event.target.value }))} />
                    </div>
                    <div>
                      <FieldLabel helper="Optional but helpful for routing review.">Category</FieldLabel>
                      <SelectInput value={pluginRequestForm.category} onChange={(event) => setPluginRequestForm((current) => ({ ...current, category: event.target.value }))}>
                        {pluginCategoryOptions.map((option) => <option key={option}>{option}</option>)}
                      </SelectInput>
                    </div>
                  </div>
                  <div>
                    <FieldLabel helper="Official source links make compatibility and safety review much faster.">Plugin URL / GitHub / OBS resource</FieldLabel>
                    <TextInput error={pluginRequestErrors.pluginUrl} placeholder="https://github.com/..." type="url" value={pluginRequestForm.pluginUrl} onChange={(event) => setPluginRequestForm((current) => ({ ...current, pluginUrl: event.target.value }))} />
                  </div>
                  <div>
                    <FieldLabel>Why should we add this?</FieldLabel>
                    <TextArea error={pluginRequestErrors.reason} placeholder="Explain how this plugin helps streamers, creators, or production workflows inside OBS." rows={5} value={pluginRequestForm.reason} onChange={(event) => setPluginRequestForm((current) => ({ ...current, reason: event.target.value }))} />
                  </div>
                  <div>
                    <FieldLabel helper="Optional, if a follow-up would help.">Email</FieldLabel>
                    <TextInput error={pluginRequestErrors.email} placeholder="name@example.com" type="email" value={pluginRequestForm.email} onChange={(event) => setPluginRequestForm((current) => ({ ...current, email: event.target.value }))} />
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-5">
                    <p className="text-xs leading-6 text-slate-500">Requested plugins are reviewed for source trust, install safety, compatibility, and long-term maintenance fit before they can enter the catalog.</p>
                    <Button disabled={pluginRequestStatus === 'loading'} type="submit">
                      {pluginRequestStatus === 'loading' ? <LoaderCircle className="size-4 animate-spin" /> : <PlusCircle className="size-4" />}
                      {pluginRequestStatus === 'loading' ? 'Preparing request...' : 'Request plugin'}
                    </Button>
                  </div>
                </form>
              </SectionCard>
            )
          ) : null}
        </div>

        <div className="space-y-6">
          <SectionCard>
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-primary">
                <LifeBuoy className="size-5" />
              </div>
              <h2 className="text-lg font-semibold text-white">What to expect</h2>
            </div>
            <ul className="mt-5 space-y-3 text-sm leading-7 text-slate-400">
              <li className="flex gap-3"><span className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" />Every request is reviewed before action is taken.</li>
              <li className="flex gap-3"><span className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" />Plugin additions depend on compatibility, safety, and install maintainability.</li>
              <li className="flex gap-3"><span className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" />Not every request can be added immediately, especially when upstream releases are unstable.</li>
              <li className="flex gap-3"><span className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" />If you can include exact steps, error text, or the official source URL, review is much faster.</li>
            </ul>
          </SectionCard>

          <SectionCard>
            <h2 className="text-lg font-semibold text-white">Helpful actions</h2>
            <div className="mt-5 space-y-3">
              <Button className="w-full justify-between" variant="secondary" onClick={() => navigate('/diagnostics')}>
                <span className="flex items-center gap-2">
                  <Bug className="size-4" />
                  Open diagnostics
                </span>
                <ExternalLink className="size-4" />
              </Button>
              <Button className="w-full justify-between" variant="secondary" onClick={() => navigate('/settings')}>
                <span className="flex items-center gap-2">
                  <MessageSquare className="size-4" />
                  Review settings
                </span>
                <ExternalLink className="size-4" />
              </Button>
              <Button
                className="w-full justify-between"
                variant="outline"
                onClick={() => void openExternal('https://obsproject.com/forum/resources/')}
              >
                <span className="flex items-center gap-2">
                  <ExternalLink className="size-4" />
                  Browse OBS resources
                </span>
                <ExternalLink className="size-4" />
              </Button>
            </div>
          </SectionCard>
        </div>
      </div>
    </div>
  )
}
