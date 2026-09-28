import React from 'react';
import { PasswordSetupScreen } from './SetPasswordPage';

/**
 * FR-AUTH-09 — reset password from a single-use link.
 * Shares the whole screen with Set Password; the mode switches the heading,
 * the endpoint and the "all other sessions will be signed out" notice.
 */
const ResetPasswordPage: React.FC = () => <PasswordSetupScreen mode="reset" />;

export default ResetPasswordPage;
