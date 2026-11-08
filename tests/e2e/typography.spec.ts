import { test } from '@playwright/test'
import { verifyTypography } from '../typography.ts'
test('approved fonts render offline with readable core contrast', async ({ page }) => {
  await verifyTypography(page, 'development')
})
