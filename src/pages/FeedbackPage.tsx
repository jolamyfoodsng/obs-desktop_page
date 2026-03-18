import { useMemo, useState } from 'react'
import { LifeBuoy, LoaderCircle, MessageSquare, Send, Siren, Sparkles } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '../components/ui/Button'
import { SupportSubmissionError, submitSupportRequest, type SupportRequestKind } from '../lib/support'
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
  emailLabel: string
  emailHelperText: string
}

type FormErrors = Partial<Record<'email' | 'subject' | 'message' | 'pluginUrl', string>>

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
    emailLabel: 'Reply email',
    emailHelperText: 'Enter your email so we can follow up after reviewing the bug report.',
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
    emailLabel: 'Email address',
    emailHelperText: 'A valid email address is required so we can follow up on your feedback.',
  },
  {
    id: 'plugin-request',
    label: 'Request a plugin',
    title: 'Request a plugin',
    description: 'Send the plugin link you want reviewed so it can be considered for the curated installer catalog.',
    icon: Sparkles,
    submitLabel: 'Submit plugin request',
    messagePlaceholder: 'Add context about why this plugin matters, supported platforms, or any install issues you ran into.',
    subjectPlaceholder: 'Plugin request summary',
    emailLabel: 'Reply email',
    emailHelperText: 'Enter your email so we can follow up if we need more information about the request.',
  },
]

function inputClassName(hasError = false) {
  return [
    'w-full rounded-2xl border bg-white/[0.04] px-4 py-3 text-sm text-white outline-none transition focus:bg-white/[0.05] placeholder:text-slate-500',
    hasError
      ? 'border-rose-400/60 focus:border-rose-300'
      : 'border-white/10 focus:border-primary/70',
  ].join(' ')
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function isValidHttpUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function validateForm(input: {
  email: string
  message: string
  pluginUrl: string
  kind: SupportRequestKind
}) {
  const errors: FormErrors = {}
  const trimmedEmail = input.email.trim()
  const trimmedMessage = input.message.trim()
  const trimmedPluginUrl = input.pluginUrl.trim()

  if (!trimmedEmail) {
    errors.email = 'Email is required.'
  } else if (!isValidEmail(trimmedEmail)) {
    errors.email = 'Enter a valid email address.'
  }

  if (!trimmedMessage) {
    errors.message = 'Please enter a message.'
  } else if (trimmedMessage.length < 10) {
    errors.message = 'Please add a bit more detail before submitting.'
  }

  if (input.kind === 'plugin-request') {
    if (!trimmedPluginUrl) {
      errors.pluginUrl = 'Please include the plugin link you want reviewed.'
    } else if (!isValidHttpUrl(trimmedPluginUrl)) {
      errors.pluginUrl = 'Plugin link must be a valid http or https URL.'
    }
  } else if (trimmedPluginUrl && !isValidHttpUrl(trimmedPluginUrl)) {
    errors.pluginUrl = 'Plugin link must be a valid http or https URL.'
  }

  return errors
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
  const [formErrors, setFormErrors] = useState<FormErrors>({})

  const activeDefinition = useMemo(
    () => flowDefinitions.find((flow) => flow.id === activeFlow) ?? flowDefinitions[0],
    [activeFlow],
  )

  const Icon = activeDefinition.icon
  const obsVersion = bootstrap?.obsDetection.obsVersion ?? null

  function clearFieldError(field: keyof FormErrors) {
    setFormErrors((current) => {
      if (!current[field]) {
        return current
      }

      const next = { ...current }
      delete next[field]
      return next
    })
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const nextErrors = validateForm({
      kind: activeFlow,
      email,
      message,
      pluginUrl,
    })

    if (Object.keys(nextErrors).length > 0) {
      setFormErrors(nextErrors)
      setSubmitState('error')
      setSubmitMessage(Object.values(nextErrors)[0] ?? 'Please review the highlighted fields.')
      return
    }

    setIsSubmitting(true)
    setSubmitState('idle')
    setSubmitMessage('')
    setFormErrors({})

    try {
      await submitSupportRequest({
        kind: activeFlow,
        email: email.trim(),
        subject: subject.trim() || null,
        message: message.trim(),
        pluginUrl: activeFlow === 'plugin-request' ? pluginUrl.trim() : null,
        obsVersion,
      })

      setSubmitState('success')
      setSubmitMessage(
        activeFlow === 'plugin-request'
          ? 'Thanks — your plugin request was sent to the support inbox for review.'
          : activeFlow === 'general-feedback'
            ? 'Thanks — your feedback was sent successfully.'
            : 'Thanks — your problem report was sent successfully.',
      )
      setSubject('')
      setMessage('')
      setPluginUrl('')
      toast.success('Submission sent successfully.')
    } catch (error) {
      const nextMessage = error instanceof Error ? error.message : 'Could not submit your request.'
      if (
        error instanceof SupportSubmissionError &&
        (error.field === 'email' || error.field === 'subject' || error.field === 'message' || error.field === 'pluginUrl')
      ) {
        const field = error.field as keyof FormErrors
        setFormErrors((current) => ({
          ...current,
          [field]: nextMessage,
        }))
      }
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
                setFormErrors({})
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

          <form className="space-y-5" noValidate onSubmit={handleSubmit}>
            <input aria-hidden="true" autoComplete="off" className="hidden" name="company" tabIndex={-1} />

            <div className="grid gap-5 md:grid-cols-2">
              <label className="space-y-2">
                <span className="text-sm font-medium text-slate-200">{activeDefinition.emailLabel}</span>
                <input
                  className={inputClassName(Boolean(formErrors.email))}
                  onChange={(event) => {
                    setEmail(event.target.value)
                    clearFieldError('email')
                  }}
                  placeholder="you@example.com"
                  required
                  type="email"
                  value={email}
                />
                <p className="text-xs leading-5 text-slate-500">{activeDefinition.emailHelperText}</p>
                {formErrors.email ? <p className="text-sm text-rose-300">{formErrors.email}</p> : null}
              </label>

              <label className="space-y-2">
                <span className="text-sm font-medium text-slate-200">Subject <span className="text-slate-500">optional</span></span>
                <input
                  className={inputClassName(Boolean(formErrors.subject))}
                  maxLength={160}
                  onChange={(event) => {
                    setSubject(event.target.value)
                    clearFieldError('subject')
                  }}
                  placeholder={activeDefinition.subjectPlaceholder}
                  value={subject}
                />
                <p className="text-xs leading-5 text-slate-500">Optional, but helpful if you want to summarize the request.</p>
                {formErrors.subject ? <p className="text-sm text-rose-300">{formErrors.subject}</p> : null}
              </label>
            </div>

            {activeFlow === 'plugin-request' ? (
              <label className="space-y-2">
                <span className="text-sm font-medium text-slate-200">Plugin link</span>
                <input
                  className={inputClassName(Boolean(formErrors.pluginUrl))}
                  onChange={(event) => {
                    setPluginUrl(event.target.value)
                    clearFieldError('pluginUrl')
                  }}
                  placeholder="https://github.com/... or the official plugin page"
                  required
                  type="url"
                  value={pluginUrl}
                />
                <p className="text-xs leading-5 text-slate-500">Include the public plugin page or repository URL you want reviewed.</p>
                {formErrors.pluginUrl ? <p className="text-sm text-rose-300">{formErrors.pluginUrl}</p> : null}
              </label>
            ) : null}

            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-200">Message</span>
              <textarea
                className={`${inputClassName(Boolean(formErrors.message))} min-h-40 resize-y`}
                maxLength={4000}
                onChange={(event) => {
                  setMessage(event.target.value)
                  clearFieldError('message')
                }}
                placeholder={activeDefinition.messagePlaceholder}
                required
                value={message}
              />
              <p className="text-xs leading-5 text-slate-500">Please include enough detail for the team to review and follow up effectively.</p>
              {formErrors.message ? <p className="text-sm text-rose-300">{formErrors.message}</p> : null}
            </label>

            <div className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-slate-400 md:flex-row md:items-center md:justify-between">
              <div className="space-y-1">
                <p>OBS version: <span className="text-slate-200">{obsVersion ?? 'Not detected'}</span></p>
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

        <aside className="space-y-4">
          <section className="rounded-[24px] border border-white/10 bg-white/[0.04] p-5">
            <div className="flex items-center gap-3 text-primary">
              <LifeBuoy className="size-5" />
              <h3 className="text-lg font-semibold text-white">How this is handled</h3>
            </div>
            <ul className="mt-4 space-y-3 text-sm leading-6 text-slate-400">
              <li>• Requests are posted to a Vercel serverless intake route.</li>
              <li>• The backend validates the payload and rejects malformed submissions.</li>
              <li>• Valid submissions are relayed to the support inbox for triage.</li>
              <li>• No secrets are stored in the Tauri frontend.</li>
            </ul>
          </section>

          <section className="rounded-[24px] border border-white/10 bg-white/[0.04] p-5">
            <div className="flex items-center gap-3 text-primary">
              <MessageSquare className="size-5" />
              <h3 className="text-lg font-semibold text-white">What gets sent</h3>
            </div>
            <ul className="mt-4 space-y-3 text-sm leading-6 text-slate-400">
              <li>• Flow type: problem report, feedback, or plugin request.</li>
              <li>• A required reply email and an optional short subject.</li>
              <li>• Your message content and plugin link for request submissions.</li>
              <li>• App version, detected OBS version, platform, and anonymous install ID.</li>
            </ul>
          </section>
        </aside>
      </div>
    </div>
  )
}
