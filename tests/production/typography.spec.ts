import { test } from '@playwright/test'
import { verifyTypography } from '../typography.ts'
test('bundled production fonts render with external network access disabled', async ({ page }) => {
  await verifyTypography(page, 'production')
})
