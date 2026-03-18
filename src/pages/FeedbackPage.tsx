import { LoaderCircle, MessageSquare, Send, Siren, Sparkles } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '../components/ui/Button'
import { submitSupportRequest, type SupportRequestKind } from '../lib/support'
import { useAppStore } from '../stores/appStore'

interface FlowDefinition {
  id: SupportRequestKind
  label: string
  title: string
  description: string
  icon: typeof Siren
  submitLabel: string
  messagePlaceholder: string
  subjectPlaceholder: string
}

const flowDefinitions: FlowDefinition[] = [
  {
    id: 'problem-report',
    label: 'Report a problem',
    title: 'Report a problem',
    description: 'Send a bug report with enough detail for us to reproduce the issue inside the desktop app.',
    icon: Siren,
    submitLabel: 'Send problem report',
    messagePlaceholder: 'What happened, what you expected, and any steps we can use to reproduce it.',
    subjectPlaceholder: 'Short issue summary',
  },
  {
    id: 'general-feedback',
    label: 'Send feedback',
    title: 'Send feedback',
    description: 'Share product feedback, UX friction, missing features, or anything else that would improve the app.',
    icon: MessageSquare,
    submitLabel: 'Send feedback',
    messagePlaceholder: 'Tell us what is working, what is confusing, or what you would change.',
    subjectPlaceholder: 'Short feedback summary',
  },
  {
    id: 'plugin-request',
    label: 'Request a plugin',
    title: 'Request a plugin',
    description: 'Send the plugin link you want reviewed so it can be considered for the curated installer catalog.',
    icon: Sparkles,
    submitLabel: 'Submit plugin request',
    messagePlaceholder: 'Optional notes about why this plugin matters, supported platforms, or any install issues.',
    subjectPlaceholder: 'Plugin request summary',
  },
]

function inputClassName() {
  return 'w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white outline-none transition focus:border-primary/70 focus:bg-white/[0.05] placeholder:text-slate-500'
}

export function FeedbackPage() {
  const bootstrap = useAppStore((state) => state.bootstrap)
  const [activeFlow, setActiveFlow] = useState<SupportRequestKind>('problem-report')
  const [email, setEmail] = useState('')
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [pluginUrl, setPluginUrl] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitState, setSubmitState] = useState<'idle' | 'success' | 'error'>('idle')
  const [submitMessage, setSubmitMessage] = useState('')

  const activeDefinition = useMemo(
    () => flowDefinitions.find((flow) => flow.id === activeFlow) ?? flowDefinitions[0],
    [activeFlow],
  )

  const Icon = activeDefinition.icon
  const obsVersion = bootstrap?.obsDetection.obsVersion ?? null

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsSubmitting(true)
    setSubmitState('idle')
    setSubmitMessage('')

    try {
      await submitSupportRequest({
        kind: activeFlow,
        email,
        subject,
        message,
        pluginUrl: activeFlow === 'plugin-request' ? pluginUrl : null,
        obsVersion,
      })

      setSubmitState('success')
      setSubmitMessage(
        activeFlow === 'plugin-request'
          ? 'Thanks — your plugin request was sent to the support inbox for review.'
          : 'Thanks — your submission was sent to the support inbox.',
      )
      setSubject('')
      setMessage('')
      setPluginUrl('')
      toast.success('Submission sent successfully.')
    } catch (error) {
      const nextMessage = error instanceof Error ? error.message : 'Could not submit your request.'
      setSubmitState('error')
      setSubmitMessage(nextMessage)
      toast.error(nextMessage)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-8 pb-16">
      <header className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-primary/80">Support</p>
        <h1 className="text-4xl font-semibold tracking-tight text-white">Feedback & requests</h1>
        <p className="max-w-3xl text-sm leading-7 text-slate-400">
          This screen sends submissions from the Tauri desktop app to the production support backend.
          Problem reports, general feedback, and plugin requests all go through the same validated intake route.
        </p>
      </header>

      <section className="grid gap-4 lg:grid-cols-3">
        {flowDefinitions.map((flow) => {
          const FlowIcon = flow.icon
          const isActive = flow.id === activeFlow
          return (
            <button
              key={flow.id}
              type="button"
              onClick={() => {
                setActiveFlow(flow.id)
                setSubmitState('idle')
                setSubmitMessage('')
              }}
              className={[
                'rounded-[24px] border p-5 text-left transition',
                isActive
                  ? 'border-primary/60 bg-primary/10 shadow-[0_0_0_1px_rgba(120,119,255,0.18)]'
                  : 'border-white/10 bg-white/[0.04] hover:border-white/20 hover:bg-white/[0.05]',
              ].join(' ')}
            >
              <div className="flex items-start gap-4">
                <div className="rounded-2xl border border-white/10 bg-black/20 p-3 text-primary">
                  <FlowIcon className="size-5" />
                </div>
                <div>
                  <p className="font-semibold text-white">{flow.label}</p>
                  <p className="mt-1 text-sm leading-6 text-slate-400">{flow.description}</p>
                </div>
              </div>
            </button>
          )
        })}
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
        <section className="rounded-[28px] border border-white/10 bg-white/[0.04] p-6 md:p-8">
          <div className="mb-6 flex items-start gap-4">
            <div className="rounded-2xl border border-white/10 bg-black/20 p-3 text-primary">
              <Icon className="size-5" />
            </div>
            <div>
              <h2 className="text-2xl font-semibold text-white">{activeDefinition.title}</h2>
              <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-400">{activeDefinition.description}</p>
            </div>
          </div>

          <form className="space-y-5" onSubmit={handleSubmit}>
            <input aria-hidden="true" autoComplete="off" className="hidden" name="company" tabIndex={-1} />

            <div className="grid gap-5 md:grid-cols-2">
              <label className="space-y-2">
                <span className="text-sm font-medium text-slate-400">Reply email <span className="text-slate-500">optional</span></span>
                <input
                  className={inputClassName()}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@example.com"
                  type="email"

                  value={email}
                />
              </label>

              <label className="space-y-2">
                <span className="text-sm font-medium text-slate-400">Subject <span className="text-slate-500">optional</span></span>
                <input
                  className={inputClassName()}
                  maxLength={160}
                  onChange={(event) => setSubject(event.target.value)}
                  placeholder={activeDefinition.subjectPlaceholder}
                  value={subject}
                />
              </label>
            </div>

            {activeFlow === 'plugin-request' ? (
              <label className="space-y-2">
                <span className="text-sm font-medium text-slate-400">Plugin link</span>
                <input
                  className={inputClassName()}
                  onChange={(event) => setPluginUrl(event.target.value)}
                  placeholder="https://github.com/... or the official plugin page"
                  type="url"
                  value={pluginUrl}
                />
              </label>
            ) : null}

            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-400">Message</span>
              <textarea
                className={`${inputClassName()} min-h-40 resize-y`}
                maxLength={4000}
                onChange={(event) => setMessage(event.target.value)}
                placeholder={activeDefinition.messagePlaceholder}
                value={message}
              />
            </label>

            <div className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-slate-400 md:flex-row md:items-center md:justify-between">
              <div className="space-y-1">
                <p>OBS version: <span className="text-slate-400">{obsVersion ?? 'Not detected'}</span></p>
                <p>Desktop submissions include app version, platform, and install ID automatically.</p>
              </div>
              <Button className="min-w-[220px]" disabled={isSubmitting} size="lg" type="submit">
                {isSubmitting ? <LoaderCircle className="size-4 animate-spin" /> : <Send className="size-4" />}
                {isSubmitting ? 'Submitting…' : activeDefinition.submitLabel}
              </Button>
            </div>

            {submitState !== 'idle' ? (
              <div
                className={[
                  'rounded-2xl border px-4 py-3 text-sm leading-6',
                  submitState === 'success'
                    ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-100'
                    : 'border-rose-400/30 bg-rose-500/10 text-rose-100',
                ].join(' ')}
              >
                {submitMessage}
              </div>
            ) : null}
          </form>
        </section>


      </div>
    </div>
  )
}
