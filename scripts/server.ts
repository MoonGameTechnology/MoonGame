import { installFatalHandlers } from '../packages/server/src/fatal';
import { startServer } from '../packages/server/src/main';
import { mailerFromEnv } from '../packages/server/src/mailer';
import { recoveryMailer } from './recoveryMailer';

// Keep fail-loud handlers in place before transport configuration can reject startup.
installFatalHandlers();
await startServer({ sendRecoveryMail: recoveryMailer(mailerFromEnv()) });
