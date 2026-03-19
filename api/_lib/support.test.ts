import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveSupportRelayConfig } from './support.js'

test('support relay config accepts the current and legacy env names', () => {
  assert.deepEqual(
    resolveSupportRelayConfig({
      RESEND_API_KEY: 'resend-live',
      SUPPORT_INBOX_EMAIL: 'help@example.com',
      SUPPORT_FROM_EMAIL: 'from@example.com',
    }),
    {
      resendApiKey: 'resend-live',
      supportInbox: 'help@example.com',
      fromEmail: 'from@example.com',
    },
  )

  assert.deepEqual(
    resolveSupportRelayConfig({
      RESEND_API_KEY: 'resend-live',
      SUPPORT_EMAIL: 'legacy-inbox@example.com',
      FROM_EMAIL: 'legacy-from@example.com',
    }),
    {
      resendApiKey: 'resend-live',
      supportInbox: 'legacy-inbox@example.com',
      fromEmail: 'legacy-from@example.com',
    },
  )
})
