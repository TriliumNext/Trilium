import type { NextFunction, Request, Response } from "express";
import openIDEncryption from "./encryption/open_id_encryption.js";
import sqlInit from "./sql_init.js";
import options from "./options.js";
import type { Session } from "express-openid-connect";
import sql from "./sql.js";
import config from "./config.js";
import log from "./log.js";

/**
 * Enhanced error types for OAuth/OIDC errors
 */
interface OAuthError extends Error {
    error?: string;
    error_description?: string;
    error_uri?: string;
    error_hint?: string;
    state?: string;
    scope?: string;
    code?: string;
    errno?: string;
    syscall?: string;
    cause?: any;
    statusCode?: number;
    headers?: Record<string, string>;
}

/**
 * OPError type - errors from the OpenID Provider
 */
interface OPError extends OAuthError {
    name: 'OPError';
    response?: {
        body?: any;
        statusCode?: number;
        headers?: Record<string, string>;
    };
}

/**
 * RPError type - errors from the Relying Party (client-side)
 */
interface RPError extends OAuthError {
    name: 'RPError';
    response?: {
        body?: any;
        statusCode?: number;
    };
    checks?: Record<string, any>;
}

/**
 * Type definition for OIDC user claims
 * These may not all be present depending on the provider configuration
 */
interface OIDCUserClaims {
    sub?: string | number | undefined;  // Subject identifier (required in OIDC spec but may be missing)
    name?: string | undefined;           // Full name
    given_name?: string | undefined;     // First name
    family_name?: string | undefined;    // Last name
    preferred_username?: string | undefined;  // Username
    email?: string | undefined;          // Email address
    email_verified?: boolean | undefined;
    [key: string]: unknown;              // Allow additional claims
}

/**
 * Type guard to check if a value is a non-empty string
 */
function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Safely converts a value to string with fallback
 */
function safeToString(value: unknown, fallback = ''): string {
    if (value === null || value === undefined) {
        return fallback;
    }
    if (typeof value === 'string') {
        return value;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
    }
    if (typeof value === 'object') {
        try {
            return JSON.stringify(value);
        } catch {
            return fallback;
        }
    }
    return fallback;
}

/**
 * Type guard for OPError
 */
function isOPError(error: any): error is OPError {
    return error?.name === 'OPError' || 
           (error?.constructor?.name === 'OPError') ||
           (error?.error && typeof error?.error === 'string');
}

/**
 * Type guard for RPError
 */
function isRPError(error: any): error is RPError {
    return error?.name === 'RPError' || 
           (error?.constructor?.name === 'RPError') ||
           (error?.checks && typeof error?.checks === 'object');
}

/**
 * Extract detailed error information from various error types
 */
function extractErrorDetails(error: any): Record<string, any> {
    const details: Record<string, any> = {};
    
    // Basic error properties
    if (error?.message) details.message = error.message;
    if (error?.name) details.errorType = error.name;
    if (error?.code) details.code = error.code;
    if (error?.statusCode) details.statusCode = error.statusCode;
    
    // OAuth-specific error properties
    if (error?.error) details.error = error.error;
    if (error?.error_description) details.error_description = error.error_description;
    if (error?.error_uri) details.error_uri = error.error_uri;
    if (error?.error_hint) details.error_hint = error.error_hint;
    if (error?.state) details.state = error.state;
    if (error?.scope) details.scope = error.scope;
    
    // System error properties
    if (error?.errno) details.errno = error.errno;
    if (error?.syscall) details.syscall = error.syscall;
    
    // Response information for OPError/RPError
    if (error?.response) {
        details.response = {
            statusCode: error.response.statusCode,
            body: error.response.body
        };
        // Don't log full headers to avoid sensitive data, just important ones
        if (error.response.headers) {
            details.response.headers = {
                'content-type': error.response.headers['content-type'],
                'www-authenticate': error.response.headers['www-authenticate']
            };
        }
    }
    
    // RPError specific checks
    if (error?.checks) {
        details.checks = error.checks;
    }
    
    // Nested cause error
    if (error?.cause) {
        details.cause = extractErrorDetails(error.cause);
    }
    
    return details;
}

/**
 * Log comprehensive error details with actionable guidance
 */
function logOAuthError(context: string, error: any, req?: Request): void {
    const errorDetails = extractErrorDetails(error);
    
    // Always log the full error details
    log.error(`OAuth ${context}: ${JSON.stringify(errorDetails, null, 2)}`);
    
    // Provide specific guidance based on error type
    if (isOPError(error)) {
        log.error(`OAuth ${context}: OpenID Provider Error detected`);
        
        // Handle specific OPError types
        switch (error.error) {
            case 'invalid_request':
                log.error('Action: Check that all required parameters are being sent in the authorization request');
                break;
            case 'invalid_client':
                log.error('Action: Verify OAuth client ID and client secret are correct');
                log.error(`Current client ID: ${config.MultiFactorAuthentication.oauthClientId?.substring(0, 10)}...`);
                break;
            case 'invalid_grant':
                log.error('Action: Authorization code may be expired or already used. User should try logging in again');
                if (req?.session) {
                    log.error(`Session ID: ${req.session.id?.substring(0, 10)}...`);
                }
                break;
            case 'unauthorized_client':
                log.error('Action: Client is not authorized for this grant type. Check OAuth provider configuration');
                break;
            case 'unsupported_grant_type':
                log.error('Action: Provider does not support authorization_code grant type. Check provider documentation');
                break;
            case 'invalid_scope':
                log.error('Action: Requested scopes are invalid. Current scopes: openid profile email');
                break;
            case 'access_denied':
                log.error('Action: User denied the authorization request or provider blocked access');
                break;
            case 'temporarily_unavailable':
                log.error('Action: OAuth provider is temporarily unavailable. Try again later');
                break;
            case 'server_error':
                log.error('Action: OAuth provider encountered an error. Check provider logs if available');
                break;
            case 'interaction_required':
                log.error('Action: User interaction is required but prompt=none was requested');
                break;
            default:
                if (error.error_description) {
                    log.error(`Provider guidance: ${error.error_description}`);
                }
        }
    } else if (isRPError(error)) {
        log.error(`OAuth ${context}: Relying Party (Client) Error detected`);
        
        // Handle specific RPError types
        if (error.checks) {
            log.error('Failed validation checks:');
            Object.entries(error.checks).forEach(([check, value]) => {
                log.error(`  - ${check}: ${JSON.stringify(value)}`);
            });
        }
        
        if (error.message?.includes('state mismatch')) {
            log.error('Action: State parameter mismatch. This can happen due to:');
            log.error('  1. Multiple login attempts in different tabs');
            log.error('  2. Session expired during login');
            log.error('  3. CSRF attack attempt (unlikely)');
            log.error('Solution: Clear cookies and try logging in again');
        } else if (error.message?.includes('nonce mismatch')) {
            log.error('Action: Nonce mismatch detected. Similar to state mismatch');
            log.error('Solution: Clear session and retry authentication');
        } else if (error.message?.includes('JWT')) {
            log.error('Action: JWT validation failed. Check:');
            log.error('  1. Clock synchronization between client and provider');
            log.error('  2. JWT signature algorithm configuration');
            log.error('  3. Issuer URL consistency');
        }
    } else if (error?.message?.includes('getaddrinfo') || error?.code === 'ENOTFOUND') {
        log.error(`OAuth ${context}: DNS resolution failed`);
        log.error(`Action: Cannot resolve host: ${config.MultiFactorAuthentication.oauthIssuerBaseUrl}`);
        log.error('Solutions:');
        log.error('  1. Verify the OAuth issuer URL is correct');
        log.error('  2. Check DNS configuration (especially in Docker)');
        log.error('  3. Try using IP address instead of hostname');
        log.error('  4. Check network connectivity');
    } else if (error?.code === 'ECONNREFUSED') {
        log.error(`OAuth ${context}: Connection refused`);
        log.error(`Target: ${config.MultiFactorAuthentication.oauthIssuerBaseUrl}`);
        log.error('Solutions:');
        log.error('  1. Verify the OAuth provider is running');
        log.error('  2. Check firewall rules');
        log.error('  3. In Docker, ensure services are on the same network');
        log.error('  4. Verify port numbers are correct');
    } else if (error?.code === 'ETIMEDOUT' || error?.code === 'ESOCKETTIMEDOUT') {
        log.error(`OAuth ${context}: Request timeout`);
        log.error('Solutions:');
        log.error('  1. Check network latency to OAuth provider');
        log.error('  2. Increase timeout values if possible');
        log.error('  3. Check for network congestion or packet loss');
    } else if (error?.message?.includes('certificate')) {
        log.error(`OAuth ${context}: SSL/TLS certificate issue`);
        log.error('Solutions:');
        log.error('  1. For self-signed certificates, configure NODE_TLS_REJECT_UNAUTHORIZED=0 (dev only)');
        log.error('  2. Add CA certificate to trusted store');
        log.error('  3. Verify certificate validity and expiration');
    } else if (error?.message?.includes('Unexpected token')) {
        log.error(`OAuth ${context}: Invalid response format`);
        log.error('Likely causes:');
        log.error('  1. Provider returned HTML error page instead of JSON');
        log.error('  2. Proxy or firewall intercepting requests');
        log.error('  3. Wrong endpoint URL configured');
    }
    
    // Log request context if available
    if (req) {
        const urlPath = req.originalUrl ? req.originalUrl.split('?')[0] : req.url;
        if (urlPath) {
            log.error(`Request path: ${urlPath}`);
        }
        if (req.method) {
            log.error(`Request method: ${req.method}`);
        }
        // Log session state for debugging
        if (req.session?.id) {
            log.error(`Session ID (first 10 chars): ${req.session.id.substring(0, 10)}...`);
        }
    }
    
    // Always log stack trace for debugging
    if (error?.stack) {
        const stackLines = error.stack.split('\n').slice(0, 5);
        log.error('Stack trace (first 5 lines):');
        stackLines.forEach((line: string) => log.error(`  ${line.trim()}`));
    }
}

/**
 * Extracts and validates user information from OIDC claims
 */
function extractUserInfo(user: OIDCUserClaims): {
    sub: string;
    name: string;
    email: string;
} | null {
    // Extract subject identifier (required by OIDC spec)
    const sub = safeToString(user.sub);
    if (!isNonEmptyString(sub)) {
        log.error('OAuth: CRITICAL - Missing or invalid subject identifier (sub) in user claims!');
        log.error('The "sub" claim is REQUIRED by the OpenID Connect specification.');
        log.error(`Received claims: ${JSON.stringify(user, null, 2)}`);
        log.error('Possible causes:');
        log.error('  1. OAuth provider is not OIDC-compliant');
        log.error('  2. Provider configuration is incorrect');
        log.error('  3. Token parsing failed');
        log.error('  4. Using OAuth2 instead of OpenID Connect');
        return null;
    }
    
    // Validate subject identifier quality
    if (sub.length < 1) {
        log.error(`OAuth: Subject identifier too short (length=${sub.length}): "${sub}"`);
        log.error('This may indicate a configuration problem with the OAuth provider');
        return null;
    }
    
    // Warn about suspicious subject identifiers
    if (sub === 'undefined' || sub === 'null' || sub === '[object Object]') {
        log.error(`OAuth: Subject identifier appears to be a stringified error value: "${sub}"`);
        log.error('This indicates a serious problem with the OAuth provider or token parsing');
        return null;
    }

    // Extract name with multiple fallback strategies
    let name = '';
    
    // Try direct name field
    if (isNonEmptyString(user.name)) {
        name = user.name;
    } 
    // Try concatenating given_name and family_name
    else if (isNonEmptyString(user.given_name) || isNonEmptyString(user.family_name)) {
        const parts: string[] = [];
        if (isNonEmptyString(user.given_name)) parts.push(user.given_name);
        if (isNonEmptyString(user.family_name)) parts.push(user.family_name);
        name = parts.join(' ');
    }
    // Try preferred_username
    else if (isNonEmptyString(user.preferred_username)) {
        name = user.preferred_username;
    }
    // Try email username part
    else if (isNonEmptyString(user.email)) {
        const emailParts = user.email.split('@');
        if (emailParts.length > 0 && emailParts[0]) {
            name = emailParts[0];
        }
    }
    
    // Final fallback to subject identifier
    if (!isNonEmptyString(name)) {
        name = `User-${sub.substring(0, 8)}`;
    }

    // Extract email with fallback
    let email = '';
    if (isNonEmptyString(user.email)) {
        email = user.email;
    } else {
        // Generate a placeholder email if none provided
        email = `${sub}@oauth.local`;
    }

    return { sub, name, email };
}

function checkOpenIDConfig() {
    const missingVars: string[] = []
    if (config.MultiFactorAuthentication.oauthBaseUrl === "") {
        missingVars.push("oauthBaseUrl");
    }
    if (config.MultiFactorAuthentication.oauthClientId === "") {
        missingVars.push("oauthClientId");
    }
    if (config.MultiFactorAuthentication.oauthClientSecret === "") {
        missingVars.push("oauthClientSecret");
    }
    return missingVars;
}

function isOpenIDEnabled() {
    return !(checkOpenIDConfig().length > 0) && options.getOptionOrNull('mfaMethod') === 'oauth';
}

function isUserSaved() {
    const data = sql.getValue<string>("SELECT isSetup FROM user_data;");
    return data === "true" ? true : false;
}

function getUsername() {
    const username = sql.getValue<string>("SELECT username FROM user_data;");
    return username;
}

function getUserEmail() {
    const email = sql.getValue<string>("SELECT email FROM user_data;");
    return email;
}

function clearSavedUser() {
    sql.execute("DELETE FROM user_data");
    options.setOption("userSubjectIdentifierSaved", false);
    return {
        success: true,
        message: "Account data removed."
    };
}

function getOAuthStatus() {
    return {
        success: true,
        name: getUsername(),
        email: getUserEmail(),
        enabled: isOpenIDEnabled(),
        missingVars: checkOpenIDConfig()
    };
}

function isTokenValid(req: Request, res: Response, next: NextFunction) {
    const userStatus = openIDEncryption.isSubjectIdentifierSaved();

    if (req.oidc !== undefined) {
        const result = req.oidc
            .fetchUserInfo()
            .then((result) => {
                return {
                    success: true,
                    message: "Token is valid",
                    user: userStatus,
                };
            })
            .catch((result) => {
                return {
                    success: false,
                    message: "Token is not valid",
                    user: userStatus,
                };
            });
        return result;
    } else {
        return {
            success: false,
            message: "Token not set up",
            user: userStatus,
        };
    }
}

function getSSOIssuerName() {
    return config.MultiFactorAuthentication.oauthIssuerName;
}

function getSSOIssuerIcon() {
    return config.MultiFactorAuthentication.oauthIssuerIcon;
}

function generateOAuthConfig() {
    const authRoutes = {
        callback: "/callback",
        login: "/authenticate",
        postLogoutRedirect: "/login",
        logout: "/logout",
    };

    const logoutParams = {
    };

    // No need to log configuration details - users can check their environment variables
    // The connectivity test will verify if everything is working

    // Log what we're configuring
    log.info(`OAuth config: baseURL=${config.MultiFactorAuthentication.oauthBaseUrl}, issuerBaseURL=${config.MultiFactorAuthentication.oauthIssuerBaseUrl}`);
    log.info(`OAuth config: redirect URI will be: ${config.MultiFactorAuthentication.oauthBaseUrl}/callback`);
    
    const authConfig = {
        authRequired: false,
        auth0Logout: false,
        baseURL: config.MultiFactorAuthentication.oauthBaseUrl,
        clientID: config.MultiFactorAuthentication.oauthClientId,
        issuerBaseURL: config.MultiFactorAuthentication.oauthIssuerBaseUrl,
        secret: config.MultiFactorAuthentication.oauthClientSecret,
        clientSecret: config.MultiFactorAuthentication.oauthClientSecret,
        authorizationParams: {
            response_type: "code",
            scope: "openid profile email",
            access_type: "offline",
            prompt: "consent",
            state: "random_state_" + Math.random().toString(36).substring(2)
        },
        routes: authRoutes,
        idpLogout: true,
        logoutParams: logoutParams,
        // Add error handling for required auth failures
        errorOnRequiredAuth: true,
        // Enable detailed error messages
        enableTelemetry: false,
        // Explicitly configure to get user info
        getLoginState: (req: Request) => {
            // This ensures user info is fetched
            return {
                returnTo: req.originalUrl || '/'
            };
        },
        // afterCallback is called only on successful token exchange
        afterCallback: async (req: Request, res: Response, session: Session) => {
            try {
                log.info('OAuth afterCallback: Token exchange successful, processing user information');
                
                // Check if database is initialized
                if (!sqlInit.isDbInitialized()) {
                    log.info('OAuth afterCallback: Database not initialized, skipping user save');
                    return session;
                }

                // Check for callback errors in query parameters first
                if (req.query?.error) {
                    log.error(`OAuth afterCallback: Provider returned error: ${req.query.error}`);
                    if (req.query.error_description) {
                        log.error(`OAuth afterCallback: Error description: ${req.query.error_description}`);
                    }
                    // Still try to set session to avoid breaking the flow
                    req.session.loggedIn = false;
                    return session;
                }
                
                // Log detailed OIDC state and session info
                log.info(`OAuth afterCallback: Session has idToken=${!!session.id_token}, hasAccessToken=${!!session.access_token}, hasRefreshToken=${!!session.refresh_token}`);
                log.info(`OAuth afterCallback: OIDC state - hasOidc=${!!req.oidc}, hasIdTokenClaims=${!!req.oidc?.idTokenClaims}`);
                
                // Log comprehensive OAuth context for debugging
                if (req.oidc) {
                    const isAuth = typeof req.oidc.isAuthenticated === 'function' ? req.oidc.isAuthenticated() : 'N/A';
                    log.info(`OAuth afterCallback: Context details - isAuthenticated=${isAuth}, ` +
                        `hasIdToken=${!!req.oidc.idToken}, hasAccessToken=${!!req.oidc.accessToken}, ` +
                        `hasRefreshToken=${!!req.oidc.refreshToken}, hasUser=${!!req.oidc.user}`);
                }
                
                // Parse and log ID token payload (safely) for debugging
                if (session.id_token) {
                    try {
                        const parts = session.id_token.split('.');
                        if (parts.length === 3) {
                            const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
                            // Log token payload for debugging (trusted logging environment)
                            const safePayload = {
                                iss: payload.iss,
                                aud: payload.aud,
                                exp: payload.exp ? new Date(payload.exp * 1000).toISOString() : undefined,
                                iat: payload.iat ? new Date(payload.iat * 1000).toISOString() : undefined,
                                sub: payload.sub,
                                email: payload.email,
                                name: payload.name,
                                given_name: payload.given_name,
                                family_name: payload.family_name,
                                preferred_username: payload.preferred_username,
                                nickname: payload.nickname,
                                groups: payload.groups ? `[${payload.groups.length} groups]` : undefined,
                                all_claims: Object.keys(payload).sort().join(', ')
                            };
                            log.info(`OAuth afterCallback: ID Token payload (masked): ${JSON.stringify(safePayload, null, 2)}`);
                        }
                    } catch (tokenError) {
                        log.error(`OAuth afterCallback: Failed to parse ID token for logging: ${tokenError}`);
                    }
                }
                
                // According to express-openid-connect v2 best practices, idTokenClaims is most reliable in afterCallback
                // The session parameter contains the verified tokens
                let user: OIDCUserClaims | undefined;
                
                // Primary source: idTokenClaims from verified ID token
                if (req.oidc?.idTokenClaims) {
                    log.info('OAuth afterCallback: Using idTokenClaims from verified ID token');
                    user = req.oidc.idTokenClaims as OIDCUserClaims;
                    
                    // Log the actual claims structure for debugging
                    const claimKeys = Object.keys(req.oidc.idTokenClaims);
                    log.info(`OAuth afterCallback: idTokenClaims has ${claimKeys.length} properties: [${claimKeys.sort().join(', ')}]`);
                    
                    // Log claim values for debugging (trusted logging environment)
                    const claimValues: any = {};
                    for (const key of claimKeys) {
                        const value = (req.oidc.idTokenClaims as any)[key];
                        if (typeof value === 'string' && value.length > 200) {
                            claimValues[key] = `${value.substring(0, 200)}...[truncated, length: ${value.length}]`;
                        } else if (Array.isArray(value)) {
                            claimValues[key] = `[Array with ${value.length} items: ${JSON.stringify(value.slice(0, 5))}${value.length > 5 ? '...' : ''}]`;
                        } else if (typeof value === 'object' && value !== null) {
                            claimValues[key] = `[Object with keys: ${Object.keys(value).join(', ')}]`;
                        } else {
                            claimValues[key] = value;
                        }
                    }
                    log.info(`OAuth afterCallback: idTokenClaims content: ${JSON.stringify(claimValues, null, 2)}`);
                } 
                // Fallback: req.oidc.user (may be available in some configurations)
                else if (req.oidc?.user) {
                    log.info('OAuth afterCallback: idTokenClaims not available, using req.oidc.user');
                    user = req.oidc.user as OIDCUserClaims;
                    
                    const userKeys = Object.keys(req.oidc.user);
                    log.info(`OAuth afterCallback: req.oidc.user has ${userKeys.length} properties: [${userKeys.sort().join(', ')}]`);
                }
                // Log what we have for debugging
                else {
                    log.error('OAuth afterCallback: No user claims available in req.oidc');
                    log.error(`Session has id_token: ${!!session.id_token}, access_token: ${!!session.access_token}`);
                }
                
                // Fallback: Parse ID token directly if req.oidc is not populated
                // This handles cases where express-openid-connect doesn't properly populate req.oidc
                if (!user && session.id_token) {
                    log.info('OAuth afterCallback: Attempting to parse ID token directly from session');
                    try {
                        const parts = session.id_token.split('.');
                        if (parts.length === 3) {
                            const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
                            user = payload as OIDCUserClaims;
                            log.info('OAuth afterCallback: Successfully parsed ID token from session');
                            log.info(`OAuth afterCallback: Parsed claims: sub="${payload.sub}", name="${payload.name}", email="${payload.email}"`);
                        } else {
                            log.error('OAuth afterCallback: Invalid ID token format (expected 3 parts)');
                        }
                    } catch (parseError) {
                        log.error(`OAuth afterCallback: Failed to parse ID token from session: ${parseError}`);
                    }
                }
                
                // Fallback: Call UserInfo endpoint if we have an access token but no user info
                if (!user && session.access_token) {
                    log.info('OAuth afterCallback: No user info from ID token, attempting UserInfo endpoint');
                    try {
                        // Get the issuer URL from config
                        const issuerURL = config.MultiFactorAuthentication.oauthIssuerBaseUrl;
                        if (issuerURL) {
                            // Construct UserInfo endpoint URL
                            // Try to determine the correct URL format based on the issuer
                            let userinfoUrl: string;
                            
                            // For Keycloak/Authentik style URLs (ends with /realms/xxx or similar)
                            if (issuerURL.includes('/realms/') || issuerURL.includes('/application/o/')) {
                                userinfoUrl = issuerURL.endsWith('/') 
                                    ? `${issuerURL}protocol/openid-connect/userinfo`
                                    : `${issuerURL}/protocol/openid-connect/userinfo`;
                            }
                            // For standard OIDC providers (Auth0, Okta, etc.)
                            else {
                                userinfoUrl = issuerURL.endsWith('/') 
                                    ? `${issuerURL}userinfo`
                                    : `${issuerURL}/userinfo`;
                            }
                            
                            log.info(`OAuth afterCallback: Calling UserInfo endpoint at ${userinfoUrl}`);
                            
                            // Make the UserInfo request
                            const response = await fetch(userinfoUrl, {
                                method: 'GET',
                                headers: {
                                    'Authorization': `Bearer ${session.access_token}`,
                                    'Accept': 'application/json'
                                }
                            });
                            
                            if (response.ok) {
                                const userInfo = await response.json();
                                user = userInfo as OIDCUserClaims;
                                log.info('OAuth afterCallback: Successfully retrieved user info from UserInfo endpoint');
                                log.info(`OAuth afterCallback: UserInfo claims: sub="${userInfo.sub}", name="${userInfo.name}", email="${userInfo.email}"`);
                            } else {
                                const errorText = await response.text();
                                log.error(`OAuth afterCallback: UserInfo endpoint returned error: ${response.status} ${response.statusText}`);
                                log.error(`OAuth afterCallback: UserInfo error response: ${errorText}`);
                            }
                        } else {
                            log.error('OAuth afterCallback: Cannot call UserInfo endpoint - issuer URL not configured');
                        }
                    } catch (userinfoError) {
                        log.error(`OAuth afterCallback: Failed to fetch UserInfo: ${userinfoError}`);
                    }
                }
                
                // Check if user object exists after all attempts
                if (!user) {
                    log.error('OAuth afterCallback: No user object received after all fallback attempts');
                    log.error('Attempted:');
                    log.error('  1. req.oidc.idTokenClaims');
                    log.error('  2. req.oidc.user');
                    log.error('  3. Direct ID token parsing from session');
                    log.error('  4. UserInfo endpoint (if access token available)');
                    log.error('This can happen when:');
                    log.error('  1. ID token does not contain user claims (only sub)');
                    log.error('  2. OAuth provider not configured to include claims in ID token');
                    log.error('  3. Token validation failed');
                    log.error('  4. UserInfo endpoint is not accessible or returns no data');
                    log.error('Consider checking your OAuth provider configuration for "openid profile email" scopes');
                    
                    // Log raw OAuth context for maximum debugging
                    if (req.oidc) {
                        const isAuth = typeof req.oidc.isAuthenticated === 'function' ? req.oidc.isAuthenticated() : 'N/A';
                        log.error(`OAuth afterCallback: Raw oidc state: ${JSON.stringify({
                            isAuthenticated: isAuth,
                            hasIdToken: !!req.oidc.idToken,
                            hasAccessToken: !!req.oidc.accessToken,
                            hasIdTokenClaims: !!req.oidc.idTokenClaims,
                            hasUser: !!req.oidc.user,
                            idTokenClaimsKeys: req.oidc.idTokenClaims ? Object.keys(req.oidc.idTokenClaims) : [],
                            userKeys: req.oidc.user ? Object.keys(req.oidc.user) : []
                        }, null, 2)}`);
                    }
                    
                    // DO NOT allow login without proper authentication data
                    req.session.loggedIn = false;
                    
                    // Throw error to prevent authentication without user info
                    throw new Error('OAuth authentication failed: Unable to retrieve user information from any source');
                }

                const userClaims = user as OIDCUserClaims;
                
                // Log available claims for debugging (trusted logging environment)
                log.info(`OAuth afterCallback: User claims received - sub="${userClaims.sub}", name="${userClaims.name}", email="${userClaims.email}", given_name="${userClaims.given_name}", family_name="${userClaims.family_name}", preferred_username="${userClaims.preferred_username}", claimKeys=[${Object.keys(userClaims).join(', ')}]`);

                // Extract and validate user information
                const userInfo = extractUserInfo(userClaims);
                
                if (!userInfo) {
                    log.error('OAuth afterCallback: Failed to extract valid user information from claims');
                    log.error(`Raw claims: ${JSON.stringify(userClaims, null, 2)}`);
                    // Still return session to avoid breaking the auth flow
                    return session;
                }

                log.info(`OAuth afterCallback: User info extracted successfully - sub="${userInfo.sub}", name="${userInfo.name}", email="${userInfo.email}"`);
                
                // Check if a user already exists and verify subject identifier matches
                if (isUserSaved()) {
                    // User exists, verify the subject identifier matches
                    const isValidUser = openIDEncryption.verifyOpenIDSubjectIdentifier(userInfo.sub);
                    
                    if (isValidUser === false) {
                        log.error('OAuth afterCallback: CRITICAL - Subject identifier mismatch!');
                        log.error('A different user is already configured in Trilium.');
                        log.error(`Current login sub: ${userInfo.sub}`);
                        log.error('This is a single-user system. To use a different OAuth account:');
                        log.error('  1. Clear the existing user data');
                        log.error('  2. Restart Trilium');
                        log.error('  3. Login with the new account');
                        
                        // Don't allow login with mismatched subject
                        // We can't return a Response here, so we throw an error
                        // The error will be handled by the Express error handler
                        throw new Error('OAuth: User mismatch - a different user is already configured');
                    } else if (isValidUser === undefined) {
                        log.error('OAuth afterCallback: Unable to verify subject identifier');
                        log.error('This might indicate database corruption or configuration issues');
                    } else {
                        log.info('OAuth afterCallback: Existing user verified successfully');
                    }
                } else {
                    // No existing user, save the new one
                    const saved = openIDEncryption.saveUser(
                        userInfo.sub,
                        userInfo.name,
                        userInfo.email
                    );
                    
                    if (saved === false) {
                        log.error('OAuth afterCallback: Failed to save user - a user may already exist');
                        log.error('This can happen in a race condition with concurrent logins');
                    } else if (saved === undefined) {
                        log.error('OAuth afterCallback: Critical error saving user - check logs');
                    } else {
                        log.info('OAuth afterCallback: New user saved successfully');
                    }
                }

                // Set session variables for successful authentication
                req.session.loggedIn = true;
                req.session.lastAuthState = {
                    totpEnabled: false,
                    ssoEnabled: true
                };
                
                log.info('OAuth afterCallback: Authentication completed successfully');

            } catch (error) {
                // Log comprehensive error details
                logOAuthError('AfterCallback Processing Error', error, req);
                
                // DO NOT set loggedIn = true on errors - this is a security risk
                try {
                    req.session.loggedIn = false;
                    log.error('OAuth afterCallback: Authentication failed due to error');
                } catch (sessionError) {
                    logOAuthError('AfterCallback Session Error', sessionError, req);
                }
                
                // Re-throw the error to ensure authentication fails
                throw error;
            }

            return session;
        },
    };
    return authConfig;
}

/**
 * Enhanced middleware to log OAuth errors with comprehensive details
 */
function oauthErrorLogger(err: any, req: Request, res: Response, next: NextFunction) {
    if (err) {
        // Use the comprehensive error logging function
        logOAuthError('Middleware Error', err, req);
        
        // Additional middleware-specific handling
        if (err.name === 'InternalOAuthError') {
            // InternalOAuthError is a wrapper used by express-openid-connect
            log.error('OAuth Middleware: InternalOAuthError detected - this usually wraps the actual error');
            
            if (err.cause) {
                log.error('OAuth Middleware: Examining wrapped error...');
                logOAuthError('Wrapped Error', err.cause, req);
            }
        }
        
        // Check for specific middleware states
        if (req.oidc) {
            const isAuth = typeof req.oidc.isAuthenticated === 'function' ? req.oidc.isAuthenticated() : 'N/A';
            log.error(`OAuth Middleware: OIDC state - isAuthenticated=${isAuth}, hasUser=${!!req.oidc.user}, hasIdToken=${!!req.oidc.idToken}, hasAccessToken=${!!req.oidc.accessToken}`);
        }
        
        // Log response headers that might contain error information
        const wwwAuth = res.getHeader('WWW-Authenticate');
        if (wwwAuth) {
            log.error(`OAuth Middleware: WWW-Authenticate header: ${wwwAuth}`);
        }
        
        // Check for redirect_uri mismatch errors specifically
        if (err.message?.includes('redirect_uri_mismatch') || 
            err.error_description?.includes('redirect_uri') || 
            err.error_description?.includes('redirect URI') ||
            err.error_description?.includes('Redirect URI')) {
            
            log.error('');
            log.error('OAuth Error: redirect_uri mismatch detected!');
            log.error('');
            log.error('This error means the redirect URI sent to the OAuth provider does not match what was configured.');
            log.error('');
            log.error('POSSIBLE CAUSES:');
            log.error('  1. If behind a reverse proxy: trustedReverseProxy may not be set');
            log.error('     - The provider expects HTTPS but Trilium might be sending HTTP');
            log.error('  2. The OAuth provider redirect URI configuration is incorrect');
            log.error('  3. The baseURL in Trilium config does not match the actual URL');
            log.error('');
            log.error('Check the diagnostic logs above to see what protocol was detected.');
            log.error('');
            log.error('IF behind a reverse proxy, try setting:');
            log.error('  In config.ini:  trustedReverseProxy=true');
            log.error('  Or environment:  TRILIUM_NETWORK_TRUSTEDREVERSEPROXY=true');
            log.error('');
        }
        // For other token exchange failures, provide general guidance
        else if (err.message?.includes('Failed to obtain access token') || 
            err.message?.includes('Token request failed') ||
            err.error === 'invalid_grant') {
            
            log.error('OAuth Middleware: Token exchange failure detected');
            log.error('Common solutions:');
            log.error('  1. Verify client secret is correct and matches provider configuration');
            log.error('  2. Check if authorization code expired (typically valid for 10 minutes)');
            log.error('  3. Ensure redirect URI matches exactly what is configured in provider');
            log.error('  4. Verify clock synchronization between client and provider (for JWT validation)');
            log.error('  5. Check if the authorization code was already used (codes are single-use)');
            
            // Log timing information if available
            if (req.session) {
                const now = Date.now();
                log.error(`Current time: ${new Date(now).toISOString()}`);
            }
        }
        
        // For state mismatch errors, provide detailed debugging
        if (err.message?.includes('state') || err.checks?.state === false) {
            log.error('OAuth Middleware: State parameter mismatch');
            log.error('Debugging information:');
            if (req.query.state) {
                log.error(`  Received state (first 10 chars): ${String(req.query.state).substring(0, 10)}...`);
            }
            if (req.session?.id) {
                log.error(`  Session ID (first 10 chars): ${req.session.id.substring(0, 10)}...`);
            }
            log.error('This can happen when:');
            log.error('  - User has multiple login tabs open');
            log.error('  - Session expired during login flow');
            log.error('  - Cookies are blocked or not properly configured');
            log.error('  - Load balancer without sticky sessions');
        }
    }
    
    // Pass the error to the next error handler
    next(err);
}

/**
 * Helper function to test OAuth connectivity
 * Useful for debugging network issues between containers
 */
async function testOAuthConnectivity(): Promise<{success: boolean, error?: string}> {
    const issuerUrl = config.MultiFactorAuthentication.oauthIssuerBaseUrl;
    
    if (!issuerUrl) {
        return { success: false, error: 'No issuer URL configured' };
    }
    
    try {
        log.info(`Testing OAuth connectivity to: ${issuerUrl}`);
        
        // Try to fetch the OpenID configuration
        const configUrl = issuerUrl.endsWith('/') 
            ? `${issuerUrl}.well-known/openid-configuration`
            : `${issuerUrl}/.well-known/openid-configuration`;
            
        const response = await fetch(configUrl);
        
        if (response.ok) {
            log.info('OAuth connectivity test successful');
            const config = await response.json();
            log.info(`OAuth provider endpoints discovered: token=${config.token_endpoint ? 'yes' : 'no'}, userinfo=${config.userinfo_endpoint ? 'yes' : 'no'}`);
            return { success: true };
        } else {
            const error = `OAuth provider returned status ${response.status}`;
            log.error(`OAuth connectivity test failed: ${error}`);
            return { success: false, error };
        }
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        log.error(`OAuth connectivity test failed: ${errorMsg}`);
        return { success: false, error: errorMsg };
    }
}

export default {
    generateOAuthConfig,
    getOAuthStatus,
    getSSOIssuerName,
    getSSOIssuerIcon,
    isOpenIDEnabled,
    clearSavedUser,
    isTokenValid,
    isUserSaved,
    oauthErrorLogger,
    testOAuthConnectivity,
};
