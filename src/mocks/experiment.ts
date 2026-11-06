import type { Experiment, ExampleTest, FileChange, TestStatus } from '../types/experiment'

function tests(compatibility: TestStatus, revoke: TestStatus): ExampleTest[] {
  return [
    {
      id: 'existing',
      name: 'Existing accounts can sign in',
      status: compatibility,
      detail:
        compatibility === 'failed'
          ? 'Fixture: imported password hashes require a migration adapter.'
          : 'Fixture: legacy password hashes are accepted by the compatibility adapter.',
    },
    {
      id: 'invalid',
      name: 'Invalid credentials are rejected',
      status: 'passed',
      detail: 'Fixture: an invalid password returns a generic authentication error.',
    },
    {
      id: 'revoke',
      name: 'Sign-out revokes active access',
      status: revoke,
      detail:
        revoke === 'failed'
          ? 'Fixture: access tokens remain valid until expiry. Add revocation handling.'
          : 'Fixture: the current credential is invalidated after sign-out.',
    },
    {
      id: 'cookies',
      name: 'Credential transport is protected',
      status: 'passed',
      detail: 'Fixture: cookies use HttpOnly, Secure, and SameSite attributes.',
    },
    {
      id: 'recovery',
      name: 'Account recovery is preserved',
      status: 'pending',
      detail: 'Fixture: recovery integration has not been reviewed in this example.',
    },
  ]
}

const file = (
  path: string,
  kind: FileChange['kind'],
  additions: number,
  deletions: number,
  before: string,
  after: string,
): FileChange => ({ path, kind, additions, deletions, before, after })

export const demoExperiment: Experiment = {
  id: 'EXP-001',
  name: 'Authentication, reimagined',
  workspace: 'auth-platform',
  objective: 'Implement secure authentication without breaking existing user accounts.',
  source: 'mock',
  futures: [
    {
      id: 'jwt',
      letter: 'A',
      title: 'JWT Authentication',
      subtitle: 'Stateless. Portable. In your control.',
      accent: 'violet',
      description:
        'Issue short-lived access tokens with rotating refresh credentials. Keep existing account records and verify legacy password hashes through a compatibility adapter.',
      strategy: [
        'Keep the existing user model and password verifier.',
        'Issue signed access tokens and rotate refresh credentials.',
        'Store refresh credentials in secure, HttpOnly cookies.',
        'Add revocation handling before production use.',
      ],
      tradeoff:
        'Portable verification adds token lifecycle complexity. Immediate sign-out needs a revocation strategy.',
      architecture: 'Stateless tokens + refresh store',
      dependencies: [
        { name: 'jose', purpose: 'JWT signing and verification' },
        { name: 'argon2', purpose: 'New password hash support; retain legacy verification' },
      ],
      files: [
        file(
          'src/auth/token.ts',
          'added',
          84,
          0,
          '// No token service exists yet.',
          "import { SignJWT } from 'jose'\n\nexport async function issueToken(userId: string) {\n  // Illustrative excerpt: key setup omitted.\n  return new SignJWT({ sub: userId })\n    .setProtectedHeader({ alg: 'EdDSA' })\n    .setExpirationTime('15m')\n}",
        ),
        file(
          'src/auth/login.ts',
          'modified',
          36,
          12,
          'const user = await legacyLogin(credentials)\nreturn user',
          'const user = await verifyExistingAccount(credentials)\nconst token = await issueToken(user.id)\nreturn { user, token }',
        ),
        file(
          'src/auth/refresh.ts',
          'added',
          62,
          0,
          '// No refresh handler.',
          '// Example only; not an executable implementation.\nawait revokePreviousRefreshCredential()\nreturn rotateRefreshCredential(user.id)',
        ),
      ],
      tests: tests('passed', 'failed'),
    },
    {
      id: 'sessions',
      letter: 'B',
      title: 'Server-Side Sessions',
      subtitle: 'Stateful. Familiar. Easy to revoke.',
      accent: 'cyan',
      description:
        'Keep authentication state on the server and send an opaque session cookie to the client. Reuse the current account verification flow with minimal migration.',
      strategy: [
        'Reuse the existing account verification service.',
        'Create opaque sessions in a shared Redis store.',
        'Set secure cookies and protect mutations against CSRF.',
        'Invalidate sessions centrally when users sign out.',
      ],
      tradeoff:
        'Simple revocation and account compatibility require a highly available session store and CSRF protection.',
      architecture: 'Opaque cookie + shared Redis store',
      dependencies: [
        { name: 'express-session', purpose: 'Server-side session lifecycle' },
        { name: 'connect-redis', purpose: 'Shared session storage adapter' },
        { name: 'redis', purpose: 'Redis client connection' },
      ],
      files: [
        file(
          'src/auth/session.ts',
          'added',
          56,
          0,
          '// No shared session middleware.',
          "// Illustrative excerpt: secrets and store setup omitted.\napp.use(session({\n  store: redisStore,\n  resave: false,\n  saveUninitialized: false,\n  cookie: { httpOnly: true, secure: true, sameSite: 'lax' }\n}))",
        ),
        file(
          'src/auth/login.ts',
          'modified',
          18,
          8,
          'const user = await legacyLogin(credentials)\nreturn user',
          'const user = await verifyExistingAccount(credentials)\nawait regenerateSession(request)\nrequest.session.userId = user.id',
        ),
        file(
          'src/auth/logout.ts',
          'added',
          22,
          0,
          '// No session revocation.',
          '// Illustrative excerpt.\nawait destroySession(request)\nresponse.clearCookie(sessionCookieName)',
        ),
      ],
      tests: tests('passed', 'passed'),
    },
    {
      id: 'managed',
      letter: 'C',
      title: 'Managed Authentication',
      subtitle: 'Hosted identity. Less to maintain.',
      accent: 'blue',
      description:
        'Delegate identity infrastructure to a managed provider. Introduce an identity adapter and plan an explicit migration for existing accounts and password hashes.',
      strategy: [
        'Map current user IDs to external identity records.',
        'Integrate provider SDK behind a local adapter.',
        'Migrate supported password hashes or require recovery.',
        'Preserve application roles and account metadata.',
      ],
      tradeoff:
        'Lower infrastructure ownership introduces provider dependency, migration risk, and recurring cost.',
      architecture: 'Identity provider + local adapter',
      dependencies: [{ name: '@auth/core', purpose: 'Illustrative provider integration layer' }],
      files: [
        file(
          'src/auth/provider.ts',
          'added',
          48,
          0,
          '// No provider adapter.',
          '// Illustrative adapter, provider not configured.\nexport const identity = {\n  signIn: (credentials) => provider.authenticate(credentials),\n  signOut: (session) => provider.revoke(session),\n}',
        ),
        file(
          'src/auth/migration.ts',
          'added',
          96,
          0,
          '// No external identity mapping.',
          '// Migration still requires implementation and review.\nconst identity = await findExternalIdentity(user.id)\nif (!identity) return requireAccountMigration(user)',
        ),
        file(
          'src/auth/login.ts',
          'modified',
          24,
          18,
          'const user = await legacyLogin(credentials)\nreturn user',
          'const identity = await provider.signIn(credentials)\nreturn resolveLocalAccount(identity.subject)',
        ),
      ],
      tests: tests('failed', 'passed'),
    },
  ],
  contracts: [
    {
      id: 'legacy',
      title: 'Preserve existing accounts',
      condition:
        'Given an existing account, valid current credentials must still allow sign-in without a password reset.',
      enabled: true,
      category: 'Compatibility',
    },
    {
      id: 'reject',
      title: 'Reject invalid credentials',
      condition:
        'Invalid credentials return a generic error without revealing whether an account exists.',
      enabled: true,
      category: 'Security',
    },
    {
      id: 'revoke',
      title: 'Revoke access on sign-out',
      condition: 'After signing out, the same credential cannot access a protected endpoint.',
      enabled: true,
      category: 'Security',
    },
    {
      id: 'transport',
      title: 'Protect credentials in transit',
      condition:
        'Authentication cookies are HttpOnly and Secure, with an explicit SameSite policy.',
      enabled: true,
      category: 'Security',
    },
    {
      id: 'recovery',
      title: 'Keep account recovery accessible',
      condition:
        'Existing users can request account recovery and return to their original account.',
      enabled: false,
      category: 'Experience',
    },
  ],
  timeline: [
    {
      id: 't1',
      time: '09:00',
      title: 'An objective takes shape',
      description:
        'A hypothetical experiment begins with one constraint: preserve existing user accounts.',
      kind: 'objective',
    },
    {
      id: 't2',
      time: '09:02',
      title: 'Behavior becomes a contract',
      description:
        'Five sample acceptance conditions describe compatibility, security, and recovery.',
      kind: 'contract',
    },
    {
      id: 't3',
      time: '09:04',
      title: 'Three possible futures',
      description:
        'JWT, server-side sessions, and managed authentication become alternative approaches.',
      kind: 'branch',
    },
    {
      id: 't4',
      time: '09:08',
      title: 'Evidence, side by side',
      description:
        'Hand-authored test fixtures and illustrative code excerpts reveal tradeoffs. No tests were executed.',
      kind: 'evidence',
    },
    {
      id: 't5',
      time: '09:12',
      title: 'The decision stays with you',
      description:
        'Review the example evidence, compare the futures, and record a local preference.',
      kind: 'decision',
    },
  ],
}
